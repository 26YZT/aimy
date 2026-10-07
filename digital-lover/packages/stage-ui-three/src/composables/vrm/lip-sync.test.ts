import type { VRMCore } from '@pixiv/three-vrm-core'
import type { WLipSyncAudioNode } from '@proj-airi/model-driver-lipsync/shared/wlipsync'
import type { EffectScope } from 'vue'

import { effectScope, nextTick, shallowRef } from 'vue'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { nodes } = vi.hoisted(() => {
  const nodes: Array<{ context: AudioContext; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = []
  class FakeAudioWorkletNode {
    context: AudioContext
    port = { onmessage: null }
    parameters = new Map([['blockSize', { value: 512, setValueAtTime: vi.fn() }]])
    connect = vi.fn((destination: unknown) => destination)
    disconnect = vi.fn()
    constructor(context: AudioContext & { processorReady?: boolean }, name: string) {
      if (!context.processorReady || name !== 'wlipsync-processor')
        throw new Error('The local processor must be registered before node construction')
      this.context = context
      nodes.push(this)
    }
  }
  // Use the real wLipSync factory, wrapper, profile and vowel driver. Only the
  // native AudioWorkletNode/AudioContext graph is replaced in this Node test.
  vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode)
  return { nodes }
})

import { useVRMLipSync } from './lip-sync'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function contextFixture(loading = Promise.resolve()) {
  const newSink = () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() })
  const sink = newSink()
  const sinks: ReturnType<typeof newSink>[] = []
  const context = {
    state: 'running' as AudioContextState,
    processorReady: false,
    destination: { name: 'destination' },
    createGain: vi.fn(() => {
      const next = sinks.length ? newSink() : sink
      sinks.push(next)
      return next
    }),
    audioWorklet: {
      addModule: vi.fn(async (url: string) => {
        expect(url.startsWith('data:')).toBe(false)
        expect(url).toContain('audio-processor')
        await loading
        context.processorReady = true
      }),
    },
  }
  return { context, sink, sinks, value: context as unknown as AudioContext }
}

function sourceFixture() {
  const source = { connect: vi.fn(), disconnect: vi.fn() }
  return { source, value: source as unknown as AudioBufferSourceNode }
}

function modelFixture() {
  const values = new Map<string, number>()
  const model = { expressionManager: { setValue: vi.fn((name: string, weight: number) => values.set(name, weight)) } } as unknown as VRMCore
  return { model, values }
}

const scopes: EffectScope[] = []
function ownedLipSync(context: AudioContext | undefined, source?: AudioBufferSourceNode) {
  const contextRef = shallowRef(context)
  const sourceRef = shallowRef(source)
  const scope = effectScope()
  scopes.push(scope)
  const lipSync = scope.run(() => useVRMLipSync(contextRef, sourceRef))!
  return { contextRef, sourceRef, scope, lipSync }
}

async function settle() {
  for (let tick = 0; tick < 4; tick++) {
    await Promise.resolve()
    await nextTick()
  }
}

beforeEach(() => { nodes.length = 0 })
afterEach(() => { for (const scope of scopes.splice(0)) scope.stop() })
afterAll(() => { vi.unstubAllGlobals() })

describe('VRM lip-sync audio lifecycle', () => {
  it('opens the mouth from a real vowel driver, then releases every vowel when the source stops despite stale analysis weights', async () => {
    const context = contextFixture()
    const source = sourceFixture()
    const owned = ownedLipSync(context.value, source.value)
    const { model, values } = modelFixture()
    await settle()
    expect(nodes).toHaveLength(1)
    const node = nodes[0] as unknown as WLipSyncAudioNode
    node.volume = 1
    node.weights.A = 1
    owned.lipSync.update(model, 0.1)
    expect(values.get('aa')).toBeGreaterThan(0.4)
    expect(owned.lipSync.isLipSyncActive.value).toBe(true)

    owned.sourceRef.value = undefined
    await settle()
    expect(source.source.disconnect).toHaveBeenCalledWith(node)
    for (let frame = 0; frame < 20; frame++)
      owned.lipSync.update(model, 0.016)
    expect(node.volume).toBe(1)
    expect(node.weights.A).toBe(1)
    expect(Object.fromEntries(values)).toEqual({ aa: 0, ee: 0, ih: 0, oh: 0, ou: 0 })
    expect(owned.lipSync.isLipSyncActive.value).toBe(false)
  })

  it('connects analysis through a zero-gain destination and disconnects only its owned branches on disposal', async () => {
    const context = contextFixture()
    const source = sourceFixture()
    const owned = ownedLipSync(context.value, source.value)
    await settle()
    expect(nodes).toHaveLength(1)
    const node = nodes[0]
    expect(context.sink.gain.value).toBe(0)
    expect(node.connect).toHaveBeenCalledExactlyOnceWith(context.sink)
    expect(context.sink.connect).toHaveBeenCalledExactlyOnceWith(context.context.destination)
    expect(source.source.connect).toHaveBeenCalledExactlyOnceWith(node)
    expect(context.context.audioWorklet.addModule).toHaveBeenCalledTimes(1)
    owned.scope.stop()
    expect(source.source.disconnect).toHaveBeenCalledExactlyOnceWith(node)
    expect(node.disconnect).toHaveBeenCalledTimes(1)
    expect(context.sink.disconnect).toHaveBeenCalledTimes(1)
  })

  it('uses one local processor registration per context while separate consumers retain separate graph cleanup', async () => {
    const context = contextFixture()
    const first = sourceFixture()
    const second = sourceFixture()
    const firstOwner = ownedLipSync(context.value, first.value)
    const secondOwner = ownedLipSync(context.value, second.value)
    await settle()
    expect(nodes).toHaveLength(2)
    expect(context.context.audioWorklet.addModule).toHaveBeenCalledTimes(1)
    expect(context.sinks).toHaveLength(2)
    firstOwner.scope.stop()
    expect(first.source.disconnect).toHaveBeenCalled()
    expect(second.source.disconnect).not.toHaveBeenCalled()
    expect(context.sinks[0].disconnect).toHaveBeenCalledTimes(1)
    expect(context.sinks[1].disconnect).not.toHaveBeenCalled()
    secondOwner.scope.stop()
    expect(second.source.disconnect).toHaveBeenCalled()
    expect(context.sinks[1].disconnect).toHaveBeenCalledTimes(1)
  })

  it('never attaches a late node after its consumer has been disposed', async () => {
    const loading = deferred()
    const context = contextFixture(loading.promise)
    const source = sourceFixture()
    const owned = ownedLipSync(context.value, source.value)
    owned.scope.stop()
    loading.resolve()
    await settle()
    expect(nodes).toHaveLength(1)
    expect(nodes[0].disconnect).toHaveBeenCalledTimes(1)
    expect(nodes[0].connect).not.toHaveBeenCalled()
    expect(context.context.createGain).not.toHaveBeenCalled()
    expect(source.source.connect).not.toHaveBeenCalled()
  })

  it('does not create or connect a node when the context closes during processor loading', async () => {
    const loading = deferred()
    const context = contextFixture(loading.promise)
    const source = sourceFixture()
    ownedLipSync(context.value, source.value)
    context.context.state = 'closed'
    loading.resolve()
    await settle()
    expect(nodes).toHaveLength(0)
    expect(context.context.createGain).not.toHaveBeenCalled()
    expect(source.source.connect).not.toHaveBeenCalled()
  })

  it('keeps a replaced context isolated when its old node resolves after the new graph is active', async () => {
    const firstLoading = deferred()
    const first = contextFixture(firstLoading.promise)
    const second = contextFixture()
    const source = sourceFixture()
    const owned = ownedLipSync(first.value, source.value)
    owned.contextRef.value = second.value
    await settle()
    expect(nodes).toHaveLength(1)
    const current = nodes[0]
    expect(current.context).toBe(second.value)
    expect(source.source.connect).toHaveBeenCalledExactlyOnceWith(current)

    firstLoading.resolve()
    await settle()
    expect(nodes).toHaveLength(2)
    const expired = nodes[1]
    expect(expired.context).toBe(first.value)
    expect(expired.disconnect).toHaveBeenCalledTimes(1)
    expect(expired.connect).not.toHaveBeenCalled()
    expect(first.context.createGain).not.toHaveBeenCalled()
    expect(source.source.connect).toHaveBeenCalledExactlyOnceWith(current)
    expect(current.disconnect).not.toHaveBeenCalled()
  })
})
