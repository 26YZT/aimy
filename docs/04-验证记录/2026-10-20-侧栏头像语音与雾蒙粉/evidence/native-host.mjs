import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
const require = createRequire('/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/package.json')
const { app, session, BrowserWindow, systemPreferences, safeStorage } = require('electron')
app.setName('Aimy UI 检查')
app.setPath('appData', '/Users/mima1234/Library/Caches/Aimy-Build/Rose-20261020/native-package/appdata')
app.setPath('userData', '/Users/mima1234/Library/Caches/Aimy-Build/Rose-20261020/native-package/profile')
process.env.APP_USER_DATA_PATH = '/Users/mima1234/Library/Caches/Aimy-Build/Rose-20261020/native-package/profile'
app.commandLine.appendSwitch('remote-debugging-port', '62720')
app.commandLine.appendSwitch('use-fake-device-for-media-stream')
app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
let secretReads = 0
safeStorage.decryptString = () => { secretReads++; throw new Error('Isolated UI check prohibits decrypting secrets') }
const local = url => { try { const u=new URL(url); return !['http:','https:','ws:','wss:'].includes(u.protocol)||['localhost','127.0.0.1','[::1]'].includes(u.hostname) } catch { return false } }
const blocked = new Set()
function protect(s) { s.webRequest.onBeforeRequest((d,done)=>{if(!local(d.url)){blocked.add(new URL(d.url).origin);done({cancel:true})}else done({cancel:false})}) }
app.on('session-created',protect)
app.whenReady().then(()=>protect(session.defaultSession))
const originalFetch=globalThis.fetch
globalThis.fetch=(input,init)=>{const url=input instanceof Request?input.url:String(input);if(!local(url))return Promise.reject(new Error('External network disabled in isolated check'));return originalFetch(input,init)}
const timer=setInterval(()=>writeFileSync('/Users/mima1234/Library/Caches/Aimy-Build/Rose-20261020/native-package/state.json',JSON.stringify({pid:process.pid,userData:app.getPath('userData'),secretReads,screenPermission:systemPreferences.getMediaAccessStatus('screen'),windows:BrowserWindow.getAllWindows().map(w=>({id:w.id,title:w.getTitle(),url:w.webContents.getURL(),visible:w.isVisible()})),blockedOrigins:[...blocked]},null,2)),1000)
app.on('will-quit',()=>{clearInterval(timer);writeFileSync('/Users/mima1234/Library/Caches/Aimy-Build/Rose-20261020/native-package/quit.json',JSON.stringify({secretReads,normal:true}))})
process.on('SIGINT',()=>app.quit())
await import('file:///Users/mima1234/Library/Caches/Aimy-Build/Rose-20261020/package/Aimy体验版.app/Contents/Resources/app.asar/preview-entry.mjs')
