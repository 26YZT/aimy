import { defineInvokeEventa } from '@moeru/eventa'

export const BASELINE_CHUNK_BYTES = 64 * 1024
export const BASELINE_RESPONSE_BYTES = 8 * 1024 * 1024

/** Host failures contain no provider payloads, headers, or native error details. */
export type BaselineTransportCode = 'invalid-input' | 'invalid-run' | 'permission-denied' | 'stale-run' | 'cancelled' | 'disposed' | 'request-conflict' | 'request-limit' | 'not-ready' | 'not-found' | 'read-in-progress' | 'stream-too-large' | 'stream-failed' | 'timeout' | 'transport-failed' | 'budget-paused'
export interface BaselineTransportFailure { ok: false, code: BaselineTransportCode, status?: number }
export interface BaselineStartInput { requestId: string, epoch: number, url: string, body: string }
export interface BaselineRequestInput { requestId: string }
export type BaselineStartResult = { ok: true, requestId: string, status: number, contentType: string } | BaselineTransportFailure
export type BaselineReadResult = { ok: true, requestId: string, done: boolean, chunk?: string } | BaselineTransportFailure
export type BaselineCancelResult = { ok: true, requestId: string } | BaselineTransportFailure

export const baselineTransportStart = defineInvokeEventa<BaselineStartResult, BaselineStartInput>('eventa:invoke:aimy:acceptance-baseline:start')
export const baselineTransportRead = defineInvokeEventa<BaselineReadResult, BaselineRequestInput>('eventa:invoke:aimy:acceptance-baseline:read')
export const baselineTransportCancel = defineInvokeEventa<BaselineCancelResult, BaselineRequestInput>('eventa:invoke:aimy:acceptance-baseline:cancel')
