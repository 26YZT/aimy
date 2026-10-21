import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire("/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/package.json");
const {app,session,BrowserWindow} = require('electron');
app.setPath('appData', '/tmp/aimy-preview-package-20261018/smoke/appdata');
app.commandLine.appendSwitch('remote-debugging-port','62686');
const blocked = new Map();
const local = value => { try { const u = new URL(value);return !['http:','https:','ws:','wss:'].includes(u.protocol) || ['localhost','127.0.0.1','[::1]'].includes(u.hostname); }catch{return false} };
function protect(s){s.webRequest.onBeforeRequest((details,done)=>{const allow=local(details.url);if(!allow){const origin=new URL(details.url).origin;blocked.set(origin,(blocked.get(origin)||0)+1)}done({cancel:!allow})});}
app.on('session-created',protect);
app.whenReady().then(()=>protect(session.defaultSession));
const nativeFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{const url=input instanceof Request?input.url:String(input);if(!local(url))return Promise.reject(new Error('Native smoke blocks external requests'));return nativeFetch(input,init)};
const timer=setInterval(()=>{writeFileSync("/tmp/aimy-preview-package-20261018/smoke/state.json",JSON.stringify({pid:process.pid,ready:app.isReady(),userData:app.getPath('userData'),windows:BrowserWindow.getAllWindows().map(w=>({id:w.id,title:w.getTitle(),url:w.webContents.getURL(),visible:w.isVisible(),destroyed:w.isDestroyed()})),blockedOrigins:[...blocked]},null,2));},1000);
app.on('will-quit',()=>{clearInterval(timer);writeFileSync("/tmp/aimy-preview-package-20261018/smoke/will-quit.json",JSON.stringify({pid:process.pid,at:Date.now(),blockedOrigins:[...blocked]}));});
process.on('SIGINT',()=>app.quit());
await import("file:///tmp/aimy-preview-package-20261018/output/mac-arm64/Aimy体验版.app/Contents/Resources/app.asar/preview-entry.mjs");
