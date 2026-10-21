const {createPushStream,createSpeechPipeline,nanoid,errorFromCause,errorMessageFromValue}=globalThis.__deps;
export class SpeechStream {
    response;
    purpose;
    output;
    abort = new AbortController();
    completion = Promise.withResolvers();
    intent;
    text;
    outputReader;
    started = false;
    sealed = false;
    settled = false;
    timer;
    signal = this.abort.signal;
    done = this.completion.promise;
    constructor(response, purpose, output){
        this.response = response;
        this.purpose = purpose;
        this.output = output;
    }
    start(previous, deadlineMs) {
        if (this.started) throw new Error('Speech stream already started');
        this.started = true;
        try {
            this.startProvider(previous, deadlineMs);
        } catch (cause) {
            this.fail(errorFromCause(cause, 'Speech stream setup failed'));
        }
    }
    startProvider(previous, deadlineMs) {
        if (deadlineMs !== undefined) this.timer = setTimeout(()=>this.cancel('Speech deadline ended'), deadlineMs);
        const { output, response } = this;
        if ('stream' in output) {
            this.text = createPushStream();
            void this.playStream(previous, output.stream);
            return;
        }
        const listeners = {
            start: new Set(),
            end: new Set(),
            interrupt: new Set()
        };
        const pending = new Set();
        const pipeline = createSpeechPipeline({
            tts: async (request, signal)=>{
                try {
                    const audio = await output.synthesize(request, AbortSignal.any([
                        signal,
                        this.signal,
                        response.signal
                    ]));
                    return this.signal.aborted || response.signal.aborted ? null : audio;
                } catch (cause) {
                    this.fail(errorFromCause(cause, 'Speech synthesis failed'));
                    return null;
                }
            },
            playback: {
                schedule: (item)=>{
                    pending.add(item);
                    const clip = {
                        id: item.segmentId,
                        text: item.text
                    };
                    let started = false;
                    void Promise.race([
                        previous,
                        this.done
                    ]).then(async ()=>{
                        if (this.signal.aborted || response.signal.aborted) return 'stopped';
                        return response.playback.enqueue({
                            id: item.id,
                            audio: item.audio,
                            signal: this.signal,
                            onStart: ()=>{
                                started = true;
                                listeners.start.forEach((listener)=>listener({
                                        item,
                                        startedAt: Date.now()
                                    }));
                                output.onPlaybackStart?.(clip);
                            }
                        });
                    }).then((result)=>{
                        if (started) output.onPlaybackEnd?.(clip, this.clipEnd(result));
                        if (!pending.delete(item)) return;
                        if (result === 'ended') listeners.end.forEach((listener)=>listener({
                                item,
                                endedAt: Date.now()
                            }));
                        else listeners.interrupt.forEach((listener)=>listener({
                                item,
                                interruptedAt: Date.now(),
                                reason: result
                            }));
                        if (result === 'failed') this.fail(new Error('Speech playback failed'));
                    }, (cause)=>this.fail(errorFromCause(cause, 'Speech playback failed')));
                },
                stopByIntent: (_id, reason)=>{
                    for (const item of pending)listeners.interrupt.forEach((listener)=>listener({
                            item,
                            interruptedAt: Date.now(),
                            reason
                        }));
                    pending.clear();
                },
                stopAll: (reason)=>this.cancel(reason),
                stopByOwner: (_id, reason)=>this.cancel(reason),
                onStart: (listener)=>{
                    listeners.start.add(listener);
                },
                onEnd: (listener)=>{
                    listeners.end.add(listener);
                },
                onInterrupt: (listener)=>{
                    listeners.interrupt.add(listener);
                },
                onReject: ()=>{}
            }
        });
        pipeline.on('onSpecial', (segment)=>segment.special && output.onSpecial?.(segment.special));
        pipeline.on('onIntentEnd', ()=>this.settle({
                status: 'finished'
            }));
        this.intent = pipeline.openIntent({
            turnId: response.turn.turnId,
            ownerId: response.turn.sessionId
        });
    }
    async playStream(previous, synthesize) {
        try {
            const audio = await synthesize(this.text.stream, AbortSignal.any([
                this.signal,
                this.response.signal
            ]));
            await Promise.race([
                previous,
                this.done
            ]);
            if (this.signal.aborted || this.response.signal.aborted) {
                await audio.cancel('Speech producer closed');
                return;
            }
            this.outputReader = audio.getReader();
            const playing = [];
            while(!this.signal.aborted && !this.response.signal.aborted){
                const result = await this.outputReader.read();
                if (result.done) break;
                const part = result.value;
                const clip = {
                    id: nanoid(),
                    text: part.text ?? ''
                };
                let started = false;
                playing.push(this.response.playback.enqueue({
                    id: clip.id,
                    audio: part.audio,
                    signal: this.signal,
                    onStart: ()=>{
                        started = true;
                        this.output.onPlaybackStart?.(clip);
                    }
                }).then((status)=>{
                    if (started) this.output.onPlaybackEnd?.(clip, this.clipEnd(status));
                    if (status === 'failed') this.fail(new Error('Speech playback failed'));
                }));
            }
            if (!this.sealed) throw new Error('Speech provider completed before text input ended');
            await Promise.all(playing);
            this.settle({
                status: 'finished'
            });
        } catch (cause) {
            this.fail(errorFromCause(cause, 'Streaming speech failed'));
        } finally{
            this.outputReader?.releaseLock();
            this.outputReader = undefined;
        }
    }
    clipEnd(status) {
        if (status === 'ended') return {
            status
        };
        const signal = this.signal.aborted ? this.signal : this.response.signal;
        return signal.aborted ? {
            status,
            reason: errorMessageFromValue(signal.reason)
        } : {
            status
        };
    }
    special(value) {
        if (this.sealed || this.response.signal.aborted) return;
        if (this.intent) this.intent.writeSpecial(value);
        else this.output.onSpecial?.(value);
    }
    flush() {
        if (!this.sealed) this.intent?.writeFlush();
    }
    write(text) {
        if (this.sealed || this.response.signal.aborted) return {
            status: 'closed'
        };
        if (this.text) this.text.write(text);
        else this.intent.writeLiteral(text);
        return {
            status: 'accepted'
        };
    }
    end() {
        if (this.sealed) return;
        this.sealed = true;
        this.text?.close();
        this.intent?.end();
    }
    cancel(reason) {
        if (this.settled) return;
        this.abort.abort(reason);
        this.text?.close();
        void this.outputReader?.cancel('Speech producer closed').catch(()=>{});
        this.intent?.cancel(reason);
        this.settle({
            status: 'cancelled',
            reason
        });
    }
    fail(error) {
        if (this.settled) return;
        this.abort.abort(error);
        this.text?.close();
        void this.outputReader?.cancel('Speech producer closed').catch(()=>{});
        this.intent?.cancel(error.message);
        this.settle({
            status: 'failed',
            error
        });
    }
    settle(outcome) {
        if (this.settled) return;
        this.sealed = true;
        this.settled = true;
        clearTimeout(this.timer);
        this.completion.resolve(outcome);
    }
}
export class VoiceResponse {
    output;
    onClosed;
    abort = new AbortController();
    streams = [];
    ordered = Promise.resolve();
    sealed = false;
    outcome;
    finishing;
    silence;
    signal = this.abort.signal;
    playback;
    turn;
    constructor(turn, output, onClosed){
        this.output = output;
        this.onClosed = onClosed;
        this.turn = Object.freeze({
            ...turn
        });
        this.playback = output.playback.openGroup(`${turn.sessionId}:${turn.turnId}`);
    }
    get closed() {
        return this.outcome !== undefined;
    }
    openSpeech(settings) {
        if (this.sealed) throw new Error('Response is closed to new speech');
        if (settings.deadlineMs !== undefined && (!Number.isFinite(settings.deadlineMs) || settings.deadlineMs < 0)) throw new Error('Speech deadline must be finite and nonnegative');
        const previous = this.ordered;
        const stream = new SpeechStream(this, settings.purpose, this.output);
        this.ordered = Promise.all([
            previous,
            stream.done
        ]);
        this.streams.push(stream);
        stream.start(previous, settings.deadlineMs);
        return stream;
    }
    finish() {
        if (this.finishing) return this.finishing;
        this.sealed = true;
        this.streams.forEach((stream)=>stream.end());
        this.finishing = (async ()=>{
            const results = await Promise.all(this.streams.map((stream)=>stream.done));
            const receipt = await (this.silence ?? this.playback.finish());
            this.outcome ??= receipt.status === 'failed' || results.some((result)=>result.status === 'failed') ? 'failed' : 'finished';
            return this.outcome;
        })();
        void this.finishing.then(this.onClosed, this.onClosed);
        return this.finishing;
    }
    cancel(reason) {
        if (this.closed) return;
        this.outcome = 'cancelled';
        this.stop(reason, 0);
        void this.finish().catch(()=>{});
    }
    interrupt(cause, fadeMs) {
        if (!this.closed) {
            this.outcome = 'interrupted';
            this.stop(cause, fadeMs);
            void this.finish().catch(()=>{});
        }
        return this.silence ?? this.playback.finish();
    }
    stop(reason, fadeMs) {
        this.sealed = true;
        this.silence = this.playback.stop({
            fadeMs
        });
        this.abort.abort(reason);
        this.streams.forEach((stream)=>stream.cancel(reason));
    }
}
