import type { loadVrm } from '@proj-airi/stage-ui-three/composables/vrm'

import { useVRMLoader } from '@proj-airi/stage-ui-three/composables/vrm'
import { describe, expect, it } from 'vitest'

import fixtureUrl from '../../../../../docs/02-调研参考/2026-10-14-其余项目对照证据/charakuru/authored-capabilities.vrm?url'

import { inspectVrm } from './vrm-inspection'

describe('vRM report against the AIRI loader', () => {
  it('loads the authored fixture and drives its actual mouth and emotion targets', async () => {
    const bytes = new Uint8Array(await (await fetch(fixtureUrl)).arrayBuffer())
    const report = inspectVrm(bytes)
    expect(report.status).toBe('ready')
    const gltf = await useVRMLoader().parseAsync(bytes.buffer, '')
    const vrm = gltf.userData.vrm as NonNullable<Awaited<ReturnType<typeof loadVrm>>>['_vrm']
    expect(vrm).toBeDefined()
    expect(vrm.expressionManager?.getExpression('aa')).toBeDefined()
    vrm.expressionManager?.setValue('aa', 1)
    vrm.expressionManager?.update()
    const mesh = vrm.scene.getObjectByName('HairMesh') as { morphTargetInfluences?: number[] } | undefined
    expect(mesh?.morphTargetInfluences?.[1]).toBe(1)
    vrm.expressionManager?.resetValues()
    vrm.expressionManager?.setValue('happy', 1)
    vrm.expressionManager?.update()
    expect(mesh?.morphTargetInfluences?.[0]).toBe(1)
    expect(vrm.springBoneManager?.joints.size).toBeGreaterThan(0)
  })
})
