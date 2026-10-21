import { readFile } from 'node:fs/promises'

import { describe, expect, it, vi } from 'vitest'

import { formatVrmInspectionReport, inspectVrm, inspectVrmFile } from './vrm-inspection'

const fixtures = new URL('../../../../../docs/02-调研参考/2026-10-14-其余项目对照证据/charakuru/', import.meta.url)

async function fixture(name: string) {
  return new Uint8Array(await readFile(new URL(name, fixtures)))
}

function changeJson(bytes: Uint8Array, change: (value: Record<string, unknown>) => void) {
  const original = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const jsonLength = original.getUint32(12, true)
  const document: Record<string, unknown> = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)))
  change(document)
  const encoded = new TextEncoder().encode(JSON.stringify(document))
  const padded = Math.ceil(encoded.length / 4) * 4
  const suffix = bytes.subarray(20 + jsonLength)
  const next = new Uint8Array(20 + padded + suffix.length)
  next.set(bytes.subarray(0, 20))
  next.fill(32, 20, 20 + padded)
  next.set(encoded, 20)
  next.set(suffix, 20 + padded)
  const header = new DataView(next.buffer)
  header.setUint32(8, next.length, true)
  header.setUint32(12, padded, true)
  return next
}

describe('local VRM inspection', () => {
  it('rejects an oversized file before reading its bytes', async () => {
    const file = new Blob(['small fixture'])
    const size = vi.spyOn(file, 'size', 'get').mockReturnValue(256 * 1024 * 1024 + 1)
    const read = vi.spyOn(file, 'arrayBuffer')
    try {
      const report = await inspectVrmFile(file)
      expect(report.status).toBe('invalid')
      expect(report.errors).toEqual(['file-too-large'])
      expect(read).not.toHaveBeenCalled()
    }
    finally {
      read.mockRestore()
      size.mockRestore()
    }
  })

  it('reports missing optional capabilities without rejecting a valid minimal avatar', async () => {
    const report = inspectVrm(await fixture('minimal-no-face.vrm'))
    expect(report.status).toBe('warning')
    expect(report.errors).toEqual([])
    expect(report.capabilities.humanoid).toBe(true)
    expect(report.capabilities.mouth).toBe(false)
    expect(report.warnings).toContain('missing-mouth')
  })
  it('recognizes the authored capabilities fixture without treating it as appearance validation', async () => {
    const bytes = await fixture('authored-capabilities.vrm')
    const report = await inspectVrmFile(new Blob([bytes]))
    expect(report.status).toBe('ready')
    expect(Object.values(report.capabilities).every(Boolean)).toBe(true)
    const handoff = JSON.parse(formatVrmInspectionReport(report))
    expect(handoff.runtimeAndAppearanceVerified).toBe(false)
    expect(handoff.evidence).toBe('local-file-declarations')
  })
  it.each(['https://example.invalid/a.png', '../texture.png', 'file:///private/a.png'])('blocks external URI %s without attempting a load', async (uri) => {
    const bytes = changeJson(await fixture('minimal-no-face.vrm'), doc => doc.images = [{ uri }])
    expect(inspectVrm(bytes).errors).toEqual(['external-resource'])
  })
  it('allows self-contained data URIs', async () => {
    const bytes = changeJson(await fixture('minimal-no-face.vrm'), doc => doc.images = [{ uri: 'data:image/png;base64,AAAA' }])
    expect(inspectVrm(bytes).errors).toEqual([])
  })
  it('rejects truncated and mismatched containers', async () => {
    const bytes = await fixture('minimal-no-face.vrm')
    expect(inspectVrm(bytes.subarray(0, 10)).errors).toEqual(['invalid-container'])
    expect(inspectVrm(bytes.subarray(0, bytes.length - 1)).errors).toEqual(['invalid-container'])
    new DataView(bytes.buffer).setUint32(12, bytes.length + 100, true)
    expect(inspectVrm(bytes).errors).toEqual(['invalid-container'])
  })
  it('rejects a plain GLB without VRM metadata', async () => {
    const bytes = changeJson(await fixture('minimal-no-face.vrm'), doc => delete doc.extensions)
    expect(inspectVrm(bytes).errors).toEqual(['missing-vrm'])
  })
  it('rejects invalid humanoid node indices', async () => {
    const bytes = changeJson(await fixture('minimal-no-face.vrm'), (doc) => {
      doc.extensions = { VRMC_vrm: { humanoid: { humanBones: { hips: { node: 99999 } } } } }
    })
    expect(inspectVrm(bytes).errors).toEqual(['invalid-humanoid'])
  })
  it('supports VRM 0 humanoid, blendshape, and spring declarations', async () => {
    const bytes = changeJson(await fixture('minimal-no-face.vrm'), (doc) => {
      const original = doc.extensions as { VRMC_vrm: { humanoid: { humanBones: Record<string, { node: number }> } } }
      doc.extensions = { VRM: {
        humanoid: { humanBones: Object.entries(original.VRMC_vrm.humanoid.humanBones).map(([bone, value]) => ({ bone, ...value })) },
        blendShapeMaster: { blendShapeGroups: ['a', 'blink', 'joy'].map(presetName => ({ presetName, binds: [{ mesh: 0, index: 0, weight: 100 }] })) },
        firstPerson: { lookAtTypeName: 'Bone' },
        secondaryAnimation: { boneGroups: [{ bones: [1] }] },
        materialProperties: [{ shader: 'VRM/MToon' }],
      } }
    })
    const report = inspectVrm(bytes)
    expect(report.version).toBe('0')
    expect(report.status).toBe('ready')
  })
  it('does not infer capabilities from empty expression names', async () => {
    const bytes = changeJson(await fixture('minimal-no-face.vrm'), (doc) => {
      const extensions = doc.extensions as { VRMC_vrm: Record<string, unknown> }
      extensions.VRMC_vrm.expressions = { preset: { aa: {}, blink: {}, happy: {} } }
    })
    expect(inspectVrm(bytes).capabilities.mouth).toBe(false)
    expect(inspectVrm(bytes).capabilities.blink).toBe(false)
  })
})
