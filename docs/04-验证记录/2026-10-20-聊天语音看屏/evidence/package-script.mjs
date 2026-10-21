import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'
import { createRequire } from 'node:module'
const root='/Users/mima1234/Documents/aimy/aimy-app'
const require=createRequire(root+'/package.json')
const asar=require(root+'/node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar')
const source='/Users/mima1234/Applications/Aimy体验版.app/Contents/Resources/app.asar'
const destination='/tmp/aimy-oct20/package/Aimy体验版.app/Contents/Resources/app.asar'
const version='0.12.0-beta.5+aimy.20261020.1'
const hash=b=>crypto.createHash('sha256').update(b).digest('hex')
const raw=asar.getRawHeader(source)
const meta=JSON.parse(asar.extractFile(source,'package.json'))
if(meta.version!=='0.12.0-beta.5+aimy.20261018.5') throw Error('Preview baseline changed')
meta.version=version
const streams=[]
function memoryFile(p,bytes,mode=0o100644){streams.push({path:p,type:'file',unpacked:false,stat:{size:bytes.length,mode},streamGenerator:()=>Readable.from(bytes)})}
function previous(dir,prefix=''){
 for(const [name,entry] of Object.entries(dir.files??{})){
  const p=prefix?`${prefix}/${name}`:name
  if(p==='out'||p==='package.json')continue
  if(entry.files){streams.push({path:p,type:'directory',unpacked:!!entry.unpacked});previous(entry,p)}
  else if(entry.link)streams.push({path:p,type:'link',unpacked:!!entry.unpacked,stat:{size:0,mode:0o120777},symlink:path.relative(path.dirname(p),entry.link),streamGenerator:()=>Readable.from([])})
  else {
   const start=8+raw.headerSize+Number(entry.offset??0)
   streams.push({path:p,type:'file',unpacked:!!entry.unpacked,stat:{size:entry.size,mode:entry.executable?0o100755:0o100644},streamGenerator:()=>entry.unpacked?fs.createReadStream(source+'.unpacked/'+p):entry.size?fs.createReadStream(source,{start,end:start+entry.size-1}):Readable.from([])})
  }
 }
}
previous(raw.header)
memoryFile('package.json',Buffer.from(JSON.stringify(meta,null,2)+'\n'))
const built=root+'/apps/stage-tamagotchi/out'
let mainChange
function addBuilt(dir,relative='out'){
 streams.push({path:relative,type:'directory',unpacked:false})
 for(const item of fs.readdirSync(dir,{withFileTypes:true})){
  const file=path.join(dir,item.name),p=relative+'/'+item.name
  if(item.isDirectory()){addBuilt(file,p);continue}
  if(!item.isFile())throw Error('Unexpected build symlink')
  if(p==='out/main/index.js'){
   const original=fs.readFileSync(file,'utf8')
   const pattern=/(setupAutoUpdater\(\{\s*enabled:)\s*[^,]+,/
   if(!pattern.test(original))throw Error('Updater setting not found')
   const modified=original.replace(pattern,'$1 false,')
   mainChange={source:hash(original),packaged:hash(modified),reason:'Disable upstream updater only in preview compiled copy'}
   memoryFile(p,Buffer.from(modified));continue
  }
  streams.push({path:p,type:'file',unpacked:false,stat:fs.statSync(file),streamGenerator:()=>fs.createReadStream(file)})
 }
}
addBuilt(built)
const output=await asar.createPackageFromStreams(destination,streams)
await finished(output)
asar.uncache(destination)
let checked=0, inherited=0
for(const item of streams){
 if(item.type!=='file')continue
 const info=asar.statFile(destination,item.path)
 if(item.path.startsWith('out/')&&item.path!=='out/main/index.js'){
  if(hash(asar.extractFile(destination,item.path))!==hash(fs.readFileSync(path.join(root,'apps/stage-tamagotchi',item.path))))throw Error('Build mismatch '+item.path)
  checked++
 }else if(item.path!=='package.json'&&item.path!=='out/main/index.js'){
  const prior=asar.statFile(source,item.path)
  if(prior.integrity?.hash && info.integrity?.hash!==prior.integrity.hash)throw Error('Inherited file changed '+item.path)
  inherited++
 }
}
const forbidden=asar.listPackage(destination).filter(p=>/(^|\/)(\.env(?:\..*)?|provider-secrets\.json|credential-binding\.json|memory-ledger\.json)$/.test(p))
if(forbidden.length)throw Error('Forbidden files in package')
const proof={version,checkedBuildFiles:checked,inheritedFiles:inherited,mainChange,forbidden,asarSha256:hash(fs.readFileSync(destination)),baselineSha256:hash(fs.readFileSync(source)),previewIdentityPreserved:asar.extractFile(source,'preview-entry.mjs').equals(asar.extractFile(destination,'preview-entry.mjs'))}
fs.writeFileSync('/tmp/aimy-oct20/package-proof.json',JSON.stringify(proof,null,2));console.log(JSON.stringify(proof))
