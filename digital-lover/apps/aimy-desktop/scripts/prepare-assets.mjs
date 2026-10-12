import { createHash } from 'node:crypto'
import { readFile, mkdir, copyFile, cp, readdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { createRequire } from 'node:module'

// One source asset in the workspace; public/ is generated for Vite's dev/build delivery.
const source = resolve(import.meta.dirname, '../../../assets/prototype')
const target = resolve(import.meta.dirname, '../public/assets')
const record = JSON.parse(await readFile(resolve(source, 'asset-record.json'), 'utf8'))
const model = resolve(source, 'AvatarSample_A.vrm')
const hash = createHash('sha256').update(await readFile(model)).digest('hex')
if (record.status !== 'prototype-only' || record.sha256 !== hash)
  throw new Error('示例角色资源校验失败，请检查资产清单。')
await mkdir(target, { recursive: true })
await copyFile(model, resolve(target, 'AvatarSample_A.vrm'))
await copyFile(resolve(source, 'asset-record.json'), resolve(target, 'asset-record.json'))

const vadSource = resolve(import.meta.dirname, '../../../assets/vad')
const vadRecord = JSON.parse(await readFile(resolve(vadSource, 'asset-record.json'), 'utf8'))
const vadModel = await readFile(resolve(vadSource, vadRecord.model_path))
if (createHash('sha256').update(vadModel).digest('hex') !== vadRecord.model_sha256)
  throw new Error('本地语音检测模型校验失败。')
const vadTarget = resolve(target, 'vad')
await cp(vadSource, vadTarget, { recursive: true })
const req = createRequire(import.meta.url)
const runtimeEntry = req.resolve('onnxruntime-web', { paths: [dirname(req.resolve('@huggingface/transformers'))] })
const runtimeDirectory = dirname(runtimeEntry)
const runtimeTarget = resolve(vadTarget, 'runtime')
await mkdir(runtimeTarget, { recursive: true })
for (const name of await readdir(runtimeDirectory)) {
  if (/^ort-wasm-simd-threaded(?:\.jsep)?\.(?:mjs|wasm)$/.test(name))
    await copyFile(resolve(runtimeDirectory, name), resolve(runtimeTarget, name))
}
await copyFile(resolve(vadSource, 'LICENSE.onnxruntime'), resolve(runtimeTarget, 'LICENSE.onnxruntime'))
