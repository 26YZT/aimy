import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire('/Users/mima1234/Documents/aimy/aimy-app/package.json')
const asar = require('/Users/mima1234/Documents/aimy/aimy-app/node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar')
const task = fileURLToPath(new URL('.', import.meta.url))
const root = '/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi'
const app = path.join(task, 'output/mac-arm64/Aimy体验版.app')
const archive = path.join(app, 'Contents/Resources/app.asar')
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const files = asar.listPackage(archive)
const meta = JSON.parse(asar.extractFile(archive, 'package.json'))
if (meta.version !== '0.12.0-beta.5+aimy.20261018.2')
  throw Error('Unexpected version')
const expectedMain = fs.readFileSync(path.join(task, 'overlay/out/main/index.js'))
if (hash(asar.extractFile(archive, 'out/main/index.js')) !== hash(expectedMain))
  throw Error('Main overlay differs')
let compared = 0
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full)
      continue
    }
    const relative = path.relative(root, full)
    if (relative === 'out/main/index.js')
      continue
    if (hash(asar.extractFile(archive, relative)) !== hash(fs.readFileSync(full)))
      throw Error('Different build file ' + relative)
    compared++
  }
}
walk(path.join(root, 'out'))
const forbidden = files.filter(file => /(^|\/)(\.env(?:\..*)?|provider-secrets\.json|credential-binding\.json)$/.test(file) || file.includes('橘雪莉'))
if (forbidden.length)
  throw Error('Unexpected private asset or secret path')
let gestureChannel = false
let gestureTitle = false
for (const file of files.filter(file => file.startsWith('/out/') && file.endsWith('.js'))) {
  const bytes = asar.extractFile(archive, file.slice(1))
  gestureChannel ||= bytes.includes(Buffer.from('eventa:model-settings-runtime:vrm-gesture:apply'))
  gestureTitle ||= bytes.includes(Buffer.from('身体动作'))
}
if (!gestureChannel || !gestureTitle)
  throw Error('Missing gesture feature')
const report = {
  app, version: meta.version, comparedBuildFiles: compared, forbidden, gestureChannel, gestureTitle,
  asarSha256: hash(fs.readFileSync(archive)),
  userDataIdentityPreserved: asar.extractFile(archive, 'preview-entry.mjs').includes(Buffer.from('Aimy-Preview')),
}
fs.writeFileSync(path.join(task, 'package-proof.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
const host = fs.readFileSync(path.join(task, 'host.mjs'), 'utf8').replace(
  'file:///Users/mima1234/Applications/Aimy体验版.app/Contents/Resources/app.asar/preview-entry.mjs',
  new URL('file://' + path.join(app, 'Contents/Resources/app.asar/preview-entry.mjs')).href,
)
fs.writeFileSync(path.join(task, 'package-host.mjs'), host)
