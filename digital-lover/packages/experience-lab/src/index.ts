#!/usr/bin/env node
import type { ProbeArguments, ProbeResult, ProbeStatus } from './arguments'

import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { parseArguments } from './arguments'

const statuses = new Set<ProbeStatus>(['ok', 'configuration-required', 'input-required', 'invalid-input', 'failed', 'timeout'])

function validMetric(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function collectLiveResult(args: ProbeArguments): Promise<ProbeResult> {
  const startedAt = performance.now()
  return new Promise((resolve) => {
    let settled = false
    const child = fork(fileURLToPath(new URL('./worker.ts', import.meta.url)), [], { silent: true })
    // SDK diagnostics stay inside this process boundary. Failures still produce
    // an explicit status; no global console replacement or raw log forwarding.
    child.stdout?.resume()
    child.stderr?.resume()
    const finish = (result: Omit<ProbeResult, 'durationMs'>) => {
      if (settled)
        return
      settled = true
      clearTimeout(watchdog)
      child.kill('SIGKILL')
      resolve({ ...result, durationMs: Math.round(performance.now() - startedAt) })
    }
    // The worker passes a 30s abort signal. The parent also enforces a 30s
    // wall-clock bound if an SDK/import never acknowledges cancellation.
    const watchdog = setTimeout(() => finish({ capability: args.capability, status: 'timeout' }), 30_000)
    child.on('message', (message: unknown) => {
      if (!message || typeof message !== 'object')
        return
      const candidate = message as Record<string, unknown>
      if (candidate.capability !== args.capability || !statuses.has(candidate.status as ProbeStatus))
        return
      const result: Omit<ProbeResult, 'durationMs'> = { capability: args.capability, status: candidate.status as ProbeStatus }
      if (validMetric(candidate.firstTokenMs))
        result.firstTokenMs = candidate.firstTokenMs
      if (validMetric(candidate.textLength))
        result.textLength = candidate.textLength
      if (validMetric(candidate.audioBytes))
        result.audioBytes = candidate.audioBytes
      finish(result)
    })
    child.on('error', () => finish({ capability: args.capability, status: 'failed' }))
    child.on('exit', () => finish({ capability: args.capability, status: 'failed' }))
    child.send(args, (error) => {
      if (error)
        finish({ capability: args.capability, status: 'failed' })
    })
  })
}

async function main(): Promise<ProbeResult> {
  const startedAt = performance.now()
  const args = parseArguments(process.argv.slice(2))
  if (!args)
    return { capability: null, status: 'invalid-arguments', durationMs: Math.round(performance.now() - startedAt) }
  if (!args.live)
    return { capability: args.capability, status: 'not-run', durationMs: Math.round(performance.now() - startedAt) }
  return collectLiveResult(args)
}

void main().then((result) => {
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exitCode = result.status === 'ok' || result.status === 'not-run'
    ? 0
    : result.status === 'failed' || result.status === 'timeout' ? 1 : 2
}).catch(() => {
  process.stdout.write(`${JSON.stringify({ capability: null, status: 'failed', durationMs: 0 })}\n`)
  process.exitCode = 1
})
