import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import * as v from 'valibot'

const sourceSha256 = '37fa26c0f5ea08e4fb6b3c6b9691640c805231af31562f9cf0b036cb7c9e6bdc'
const transitions = [
  'create_fresh_case_profile_and_session',
  'continue_same_session',
  'graceful_quit_wait_for_exit_start_new_process_restore_same_profile_and_session',
  'create_new_empty_session_keep_same_profile_principal_character',
] as const
const digest = v.pipe(v.string(), v.regex(/^[a-f\d]{64}$/))
const integer = v.pipe(v.number(), v.integer(), v.minValue(0))
const schema = v.object({
  frozen: v.boolean(),
  sources: v.object({ user_v2_md: v.object({ path: v.string(), sha256: digest }) }),
  cases: v.pipe(v.array(v.object({
    case_id: v.pipe(v.string(), v.regex(/^USER-V2-0[1-8]$/)),
    fictional: v.literal(true),
    model_input: v.object({ steps: v.array(v.object({
      step_id: v.string(),
      sequence: integer,
      role: v.literal('user'),
      clock: v.object({ instant: v.string(), timezone: v.literal('Asia/Shanghai') }),
      transition_before_input: v.picklist(transitions),
      user_input: v.object({ text: v.pipe(v.string(), v.minLength(1), v.maxLength(8000)), source_span: v.object({
        source_id: v.literal('user_v2_md'),
        utf8_byte_start: integer,
        utf8_byte_end_exclusive: integer,
        sha256: digest,
      }) }),
    })) }),
  })), v.length(8)),
})

export function sha256(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex')
}

/** These are the only dataset fields that enter the renderer driver. */
export interface ScenarioInput { text: string, clock: { now: number, timeZone: 'Asia/Shanghai' } }
export interface AcceptanceStep { stepId: string, transition: typeof transitions[number], input: ScenarioInput, sourceSha256: string }
export interface AcceptanceCase { caseId: string, steps: AcceptanceStep[] }

/** Grading material is deliberately discarded before any browser/model boundary. */
export function projectDataset(input: unknown, source: Uint8Array): { frozen: boolean, cases: AcceptanceCase[] } {
  const parsed = v.parse(schema, input)
  if (parsed.sources.user_v2_md.sha256 !== sourceSha256 || sha256(source) !== sourceSha256)
    throw new Error('DATASET_SOURCE_CHANGED')
  const ids = new Set<string>()
  const cases = parsed.cases.map((item, index) => {
    if (item.case_id !== `USER-V2-0${index + 1}` || ids.has(item.case_id))
      throw new Error('DATASET_CASE_ORDER_CHANGED')
    ids.add(item.case_id)
    return {
      caseId: item.case_id,
      steps: item.model_input.steps.map((step, position) => {
        const span = step.user_input.source_span
        const bytes = source.slice(span.utf8_byte_start, span.utf8_byte_end_exclusive)
        const now = Date.parse(step.clock.instant)
        if (span.utf8_byte_end_exclusive > source.length || span.utf8_byte_start >= span.utf8_byte_end_exclusive
          || sha256(bytes) !== span.sha256 || new TextDecoder('utf-8', { fatal: true }).decode(bytes) !== step.user_input.text
          || step.sequence !== position + 1 || step.step_id !== `${item.case_id}-T${position + 1}`
          || !Number.isSafeInteger(now) || !step.clock.instant.endsWith('+08:00')) {
          throw new Error('DATASET_STEP_CHANGED')
        }
        const expected = position === 0 ? transitions[0] : index === 4 ? transitions[2] : index >= 6 ? transitions[3] : transitions[1]
        if (step.transition_before_input !== expected)
          throw new Error('DATASET_TRANSITION_CHANGED')
        return { stepId: step.step_id, transition: expected, sourceSha256: span.sha256, input: { text: step.user_input.text, clock: { now, timeZone: 'Asia/Shanghai' as const } } }
      }),
    }
  })
  if (cases.some((item, index) => item.steps.length !== ([2, 3].includes(index) ? 3 : 2)))
    throw new Error('DATASET_STEP_COUNT_CHANGED')
  return { frozen: parsed.frozen, cases }
}

export async function loadAcceptanceDataset(path: string, repository: string) {
  const bytes = await readFile(path)
  if (bytes.length > 512 * 1024)
    throw new Error('DATASET_TOO_LARGE')
  const parsed = v.parse(schema, JSON.parse(bytes.toString('utf8')))
  const sourcePath = resolve(repository, parsed.sources.user_v2_md.path)
  const within = relative(repository, sourcePath)
  if (!within || isAbsolute(within) || within === '..' || within.startsWith(`..${sep}`))
    throw new Error('DATASET_SOURCE_OUTSIDE_REPOSITORY')
  return { ...projectDataset(parsed, await readFile(sourcePath)), datasetSha256: sha256(bytes), sourceSha256 }
}
