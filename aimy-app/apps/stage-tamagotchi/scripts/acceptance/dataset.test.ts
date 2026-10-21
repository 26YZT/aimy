import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { loadAcceptanceDataset, projectDataset } from './dataset'

const repository = fileURLToPath(new URL('../../../../../', import.meta.url))
const path = resolve(repository, 'docs/04-验证记录/2026-10-15-首批增量开发/acceptance/cases.json')

describe('approved fictional dataset boundary', () => {
  it('preserves all 18 exact utterances and required process/session transitions', async () => {
    const result = await loadAcceptanceDataset(path, repository)
    expect(result.cases.flatMap(item => item.steps)).toHaveLength(18)
    expect(result.cases[4].steps[1].transition).toContain('new_process')
    expect(result.cases[6].steps[1].transition).toContain('empty_session')
    expect(result.cases[7].steps[1].transition).toContain('empty_session')
    expect(result.frozen).toBe(false)
  })

  it('drops grading, reference answers, titles and additional model input properties', async () => {
    const input = JSON.parse(await readFile(path, 'utf8'))
    const source = await readFile(resolve(repository, input.sources.user_v2_md.path))
    input.cases[0].grader_only = { secret: 'GRADER_CANARY' }
    input.cases[0].title = 'TITLE_CANARY'
    input.cases[0].model_input.steps[0].injected = 'INPUT_CANARY'
    const output = projectDataset(input, source)
    expect(JSON.stringify(output)).not.toContain('CANARY')
    expect(Object.keys(output.cases[0].steps[0].input).sort()).toEqual(['clock', 'text'])
  })

  it.each(['text', 'transition', 'source'] as const)('rejects modified %s before launching a process', async (change) => {
    const input = JSON.parse(await readFile(path, 'utf8'))
    const source = await readFile(resolve(repository, input.sources.user_v2_md.path))
    if (change === 'text')
      input.cases[0].model_input.steps[0].user_input.text += 'extra'
    if (change === 'transition')
      input.cases[4].model_input.steps[1].transition_before_input = 'continue_same_session'
    if (change === 'source')
      source[0] ^= 1
    expect(() => projectDataset(input, source)).toThrow()
  })
})
