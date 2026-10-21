import { build, Platform, Arch } from '/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/node_modules/electron-builder/out/index.js'
import original from '/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/electron-builder.config.ts'
const task='/tmp/aimy-preview-package-20261018'
await build({projectDir:'/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi',targets:Platform.MAC.createTarget(['dir'],Arch.arm64),publish:'never',config:{...original,
 appId:'ai.aimy.preview',productName:'Aimy体验版',buildVersion:'2026.10.18',
 directories:{...original.directories,output:task+'/output'},
 electronDist:'/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/node_modules/electron/dist',
 electronVersion:'43.4.1',npmRebuild:false,nodeGypRebuild:false,
 files:[...original.files,'!out/main/index.js','!**/.env','!**/.env.*','!**/provider-secrets.json','!**/credential-binding.json',{from:task+'/overlay',to:'.',filter:['**/*']}],
 extraResources:[],
 extraMetadata:{...original.extraMetadata,main:'preview-entry.mjs',version:'0.12.0-beta.5+aimy.20261018.1',aimyBuild:'2026-10-18-companion'},
 publish:null,
 mac:{...original.mac,publish:null,identity:null,notarize:false,icon:'build/icon.icns',extendInfo:{...original.mac.extendInfo,CFBundleDisplayName:'Aimy体验版',NSMicrophoneUsageDescription:'Aimy体验版需要麦克风权限进行语音交流',NSSpeechRecognitionUsageDescription:'Aimy体验版使用语音识别处理你授权的语音输入'}}
}})
