import { parse, record, string, unknown } from 'valibot'

/** This report describes file declarations. Runtime response and visual quality require separate checks. */
                                      
                                         
                           
                                                                                                           
                  
                    
               
 

const requiredBones = ['hips', 'spine', 'head', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot']

function emptyReport(bytes        )                      {
  return {
    status: 'invalid',
    version: null,
    bytes,
    capabilities: { humanoid: false, mouth: false, blink: false, emotion: false, lookAt: false, spring: false, mtoon: false },
    errors: [],
    warnings: [],
  }
}

function objectValue(value         )                          {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value                            : {}
}

function arrayValue(value         )            {
  return Array.isArray(value) ? value : []
}

function hasExternalResource(value         )          {
  if (Array.isArray(value))
    return value.some(hasExternalResource)
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, child]) => (key === 'uri' && typeof child === 'string' && !child.startsWith('data:')) || hasExternalResource(child))
  }
  return false
}

function parseContainer(bytes            ) {
  if (bytes.byteLength < 20)
    throw new Error('invalid-container')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== 0x46546C67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength)
    throw new Error('invalid-container')
  let offset = 12
  let json         
  let binaryBytes = 0
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength)
      throw new Error('invalid-container')
    const length = view.getUint32(offset, true)
    const type = view.getUint32(offset + 4, true)
    if (length % 4 !== 0 || offset + 8 + length > bytes.byteLength)
      throw new Error('invalid-container')
    if (type === 0x4E4F534A) {
      if (json !== undefined || offset !== 12 || length > 8 * 1024 * 1024)
        throw new Error('invalid-container')
      json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 8, offset + 8 + length)))
    }
    else if (type === 0x004E4942) {
      if (binaryBytes !== 0)
        throw new Error('invalid-container')
      binaryBytes = length
    }
    offset += 8 + length
  }
  const document = parse(record(string(), unknown()), json)
  const buffers = arrayValue(document.buffers)
  const embedded = buffers.filter(buffer => objectValue(buffer).uri === undefined)
  if (embedded.length > 1 || embedded.some(buffer => typeof objectValue(buffer).byteLength !== 'number' || Number(objectValue(buffer).byteLength) > binaryBytes))
    throw new Error('invalid-container')
  return document
}

function declaredExpression(value         , legacy         ) {
  const expression = objectValue(value)
  return arrayValue(legacy ? expression.binds : expression.morphTargetBinds).length > 0
    || arrayValue(legacy ? expression.materialValues : expression.materialColorBinds).length > 0
}

/**
 * Inspect a local GLB without executing code, loading textures, or changing the asset.
 * Invalid containers and external resource references cannot enter the preview loader.
 */
export function inspectVrm(input                          )                      {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const report = emptyReport(bytes.byteLength)
  try {
    if (bytes.byteLength > 256 * 1024 * 1024) {
      report.errors.push('file-too-large')
      return report
    }
    const document = parseContainer(bytes)
    if (hasExternalResource(document)) {
      report.errors.push('external-resource')
      return report
    }
    const extensions = objectValue(document.extensions)
    const modern = objectValue(extensions.VRMC_vrm)
    const legacy = objectValue(extensions.VRM)
    if (!extensions.VRMC_vrm && !extensions.VRM) {
      report.errors.push('missing-vrm')
      return report
    }
    report.version = extensions.VRMC_vrm ? '1' : '0'
    const vrm = report.version === '1' ? modern : legacy
    const nodes = arrayValue(document.nodes)
    const rawBones = objectValue(vrm.humanoid).humanBones
    const bones = report.version === '1'
      ? objectValue(rawBones)
      : Object.fromEntries(arrayValue(rawBones).map(value => [String(objectValue(value).bone), value]))
    report.capabilities.humanoid = requiredBones.every((name) => {
      const node = objectValue(bones[name]).node
      return typeof node === 'number' && Number.isInteger(node) && node >= 0 && node < nodes.length
    })
    if (!report.capabilities.humanoid)
      report.errors.push('invalid-humanoid')
    const expressions = report.version === '1'
      ? objectValue(objectValue(vrm.expressions).preset)
      : Object.fromEntries(arrayValue(objectValue(vrm.blendShapeMaster).blendShapeGroups).map(value => [String(objectValue(value).presetName), value]))
    const hasExpression = (name        ) => declaredExpression(expressions[name], report.version === '0')
    const mouthNames = report.version === '1' ? ['aa', 'ih', 'ou', 'ee', 'oh'] : ['a', 'i', 'u', 'e', 'o']
    const emotions = report.version === '1' ? ['happy', 'angry', 'sad', 'relaxed', 'surprised'] : ['joy', 'angry', 'sorrow', 'fun']
    report.capabilities.mouth = mouthNames.some(hasExpression)
    report.capabilities.blink = ['blink', 'blinkLeft', 'blinkRight', 'blink_l', 'blink_r'].some(hasExpression)
    report.capabilities.emotion = emotions.some(hasExpression)
    report.capabilities.lookAt = report.version === '1'
      ? ['bone', 'expression'].includes(String(objectValue(vrm.lookAt).type))
      : ['Bone', 'BlendShape'].includes(String(objectValue(vrm.firstPerson).lookAtTypeName))
    report.capabilities.spring = report.version === '1'
      ? arrayValue(objectValue(extensions.VRMC_springBone).springs).some(spring => arrayValue(objectValue(spring).joints).length > 0)
      : arrayValue(objectValue(vrm.secondaryAnimation).boneGroups).some(group => arrayValue(objectValue(group).bones).length > 0)
    report.capabilities.mtoon = report.version === '1'
      ? arrayValue(document.materials).some(material => !!objectValue(objectValue(material).extensions).VRMC_materials_mtoon)
      : arrayValue(vrm.materialProperties).some(material => objectValue(material).shader === 'VRM/MToon')
    for (const [name, present] of Object.entries(report.capabilities)) {
      if (!present && name !== 'humanoid')
        report.warnings.push(`missing-${name}`)
    }
    report.status = report.errors.length ? 'invalid' : report.warnings.length ? 'warning' : 'ready'
  }
  catch {
    report.errors.push('invalid-container')
  }
  return report
}

/** Bound memory use before reading a selected local file. Read failures produce a report, not a preview attempt. */
export async function inspectVrmFile(file      )                               {
  if (file.size > 256 * 1024 * 1024) {
    const report = emptyReport(file.size)
    report.errors.push('file-too-large')
    return report
  }
  try {
    return inspectVrm(await file.arrayBuffer())
  }
  catch {
    const report = emptyReport(file.size)
    report.errors.push('invalid-container')
    return report
  }
}

/** Export the declared capabilities and limitations for the asset author. No asset bytes enter the report. */
export function formatVrmInspectionReport(report                     )         {
  return JSON.stringify({ schemaVersion: 1, evidence: 'local-file-declarations', runtimeAndAppearanceVerified: false, ...report }, null, 2)
}
