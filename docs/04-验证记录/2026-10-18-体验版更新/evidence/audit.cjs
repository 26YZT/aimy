const asar=require('/Users/mima1234/Documents/aimy/aimy-app/node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar');
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root='/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi',task='/tmp/aimy-preview-package-20261018',app=task+'/output/mac-arm64/Aimy体验版.app',archive=app+'/Contents/Resources/app.asar';
const list=asar.listPackage(archive),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const forbidden=list.filter(f=>/(^|\/)(\.env(?:\..*)?|provider-secrets\.json|credential-binding\.json|ledger\.json|acceptance-driver[^/]*)$/.test(f));
if(forbidden.length)throw Error('Forbidden package files');
let checked=0;
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,e.name);if(e.isDirectory())walk(full);else{const rel=path.relative(root,full);if(rel==='out/main/index.js')continue;if(sha(asar.extractFile(archive,rel))!==sha(fs.readFileSync(full)))throw Error('Build mismatch '+rel);checked++;}}}
walk(root+'/out');
const textFiles=list.filter(f=>f.startsWith('/out/renderer/assets/')&&f.endsWith('.js'));
const features={};for(const marker of ['companion-settings','COMPANION_SETTINGS_NOT_READY','local:companion/followup/v1','local:companion/review/v1','unsupported-stream','file-too-large']){const hits=textFiles.filter(f=>asar.extractFile(archive,f.slice(1)).includes(Buffer.from(marker)));features[marker]=hits;if(!hits.length)throw Error('Missing marker '+marker);}
const meta=JSON.parse(asar.extractFile(archive,'package.json').toString());const main=asar.extractFile(archive,'out/main/index.js');
if(sha(main)!==sha(fs.readFileSync(task+'/overlay/out/main/index.js')))throw Error('main overlay mismatch');
if(!main.includes(Buffer.from('build: ({ dependsOn }) => setupAutoUpdater({\n\t\t\tenabled: false,')))throw Error('updater remains enabled');
const entry=asar.extractFile(archive,'preview-entry.mjs');if(sha(entry)!==sha(fs.readFileSync(task+'/overlay/preview-entry.mjs')))throw Error('entry changed');
for(const f of ['THIRD_PARTY_NOTICES.md','licenses/AionsHome-MIT.txt','licenses/Ryza-MIT.txt','licenses/Open-LLM-VTuber-backend-MIT.txt','licenses/Apache-2.0.txt'])if(!list.includes('/'+f))throw Error('Missing notice '+f);
const report={app,files:list.length,comparedBuildFiles:checked,forbiddenFiles:forbidden,features,main:meta.main,version:meta.version,profileIsolated:entry.includes(Buffer.from('Aimy-Preview')),updaterDisabled:true,asarSha256:sha(fs.readFileSync(archive)),rendererMatchesBuild:true};fs.writeFileSync(task+'/package-audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify({files:report.files,comparedBuildFiles:checked,version:meta.version,features:Object.keys(features),forbiddenFiles:forbidden}));
