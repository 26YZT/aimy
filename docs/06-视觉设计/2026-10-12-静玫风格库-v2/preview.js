/* Standalone UI reference: no models, devices, network calls, or persistence. */
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const names={overview:'产品界面',foundations:'品牌与基础',components:'组件规范',windows:'窗口范式',states:'状态与动效',handoff:'开发交接'};
const permissions={mic:false,screen:false};let voiceActive=false,toastTimer,pendingAction,dialogTrigger;
function icon(name){return `<svg class="a-icon" aria-hidden="true"><use href="assets/ui-icons.svg#i-${name}"/></svg>`;}
function decorate(root=document){root.querySelectorAll('[data-icon]').forEach(el=>{el.outerHTML=icon(el.dataset.icon);});}
decorate();
function toast(text){$('#toast').textContent=text;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('#toast').textContent='';},3400);}
function route(){const key=location.hash.slice(1);const page=Object.hasOwn(names,key)?key:'overview';$$('.view').forEach(v=>{v.hidden=v.id!==`view-${page}`;});$$('[data-view]').forEach(a=>{if(a.dataset.view===page)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});$('#current-title').textContent=names[page];window.scrollTo({top:0,behavior:'instant'});}
addEventListener('hashchange',route);route();
$$('[data-go]').forEach(b=>b.addEventListener('click',()=>{location.hash=b.dataset.go;}));
function updateSymbols(){const dark=document.documentElement.dataset.theme==='dark';$$('img[src="assets/aimy-symbol.svg"],img[src="assets/aimy-symbol-dark.svg"]').forEach(img=>{if(!img.closest('.theme-dark'))img.src=`assets/aimy-symbol${dark?'-dark':''}.svg`;});}
function theme(value){const root=document.documentElement;root.classList.add('changing-theme');root.dataset.theme=value;$$('[data-theme-value]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.themeValue===value)));$('meta[name="theme-color"]').content=getComputedStyle(root).getPropertyValue('--canvas').trim();$('#chat-theme-spec').textContent=`${value.toUpperCase()} · PREF. 520 W`;renderPalette();updateSymbols();void root.offsetWidth;requestAnimationFrame(()=>root.classList.remove('changing-theme'));}
$$('[data-theme-value]').forEach(b=>b.addEventListener('click',()=>theme(b.dataset.themeValue)));
function renderPalette(){const styles=getComputedStyle(document.documentElement);const colors=[['canvas','冷白 / 画布'],['surface','纯白 / 面板'],['action','石墨 / 操作'],['accent','雾玫 / 身份'],['accent-soft','薄玫 / 选中'],['text-secondary','灰阶 / 辅助']];$('#palette').innerHTML=colors.map(([key,label])=>{const hex=styles.getPropertyValue(`--${key}`).trim();return `<div><div class="palette-color" style="background:var(--${key})"></div><div class="palette-meta">${label}<code>${hex.toUpperCase()}</code></div></div>`;}).join('');}
renderPalette();
function renderPermissions(){
  $$('[data-permission]').forEach(b=>b.setAttribute('aria-checked',String(permissions[b.dataset.permission])));
  $('#mic-status').textContent=permissions.mic?'开启（演示）':'已关闭';$('#screen-status').textContent=permissions.screen?'开启（演示）':'已关闭';
  $('#chat-privacy-summary').textContent=`麦克风${permissions.mic?'开启（演示）':'关闭'} · 看屏${permissions.screen?'开启（演示）':'关闭'}`;
  $('#composer-mic').classList.toggle('active',permissions.mic);$('#composer-mic').innerHTML=icon(permissions.mic?'mic':'mic-off');
  $('#composer-screen').classList.toggle('active',permissions.screen);
  if(!permissions.mic)voiceActive=false;renderVoice();
}
function renderVoice(){
  $('#voice-title').textContent=voiceActive?'正在聆听（演示）':'我在，慢慢说。';
  $('#voice-description').textContent=voiceActive?'你随时可以停止。未调用麦克风。':permissions.mic?'麦克风示例已开启；语音预览未开始':'麦克风尚未开启';
  $('#voice-start').innerHTML=icon('mic')+(voiceActive?'预览进行中':'开始语音预览');$('#voice-start').disabled=voiceActive;
  $('#voice-stop').hidden=!voiceActive;$('#voice-indicator').classList.toggle('active',voiceActive);
}
function modal({title,copy,confirm='开启预览状态',cancel='先不开启',trigger,action,danger=false}){
  $('#dialog-title').textContent=title;$('#dialog-copy').textContent=copy;$('#dialog-confirm').textContent=confirm;$('#dialog-cancel').textContent=cancel;
  $('#dialog-confirm').className=danger?'a-button danger':'a-button';pendingAction=action;dialogTrigger=trigger;$('#permission-dialog').showModal();$('#dialog-cancel').focus();
}
$('#dialog-cancel').addEventListener('click',()=>$('#permission-dialog').close());
$('#dialog-confirm').addEventListener('click',()=>{const action=pendingAction;pendingAction=null;$('#permission-dialog').close();if(action)action();});
$('#permission-dialog').addEventListener('close',()=>{pendingAction=null;if(dialogTrigger?.isConnected)dialogTrigger.focus();});
function requestPermission(key,trigger,after){
  modal({title:key==='mic'?'开启麦克风？':'开启看屏？',copy:key==='mic'?'开启后，Aimy 才会开始听你说话。你可以随时关闭，停止已有聆听。':'开启后，Aimy 才会查看你选择的屏幕。原始截图默认不长期保存，随时可以停止。',trigger,action:()=>{permissions[key]=true;renderPermissions();if(after)after();toast('已切换示例状态。没有访问设备。');}});
}
$$('[data-permission]').forEach(b=>b.addEventListener('click',()=>{const key=b.dataset.permission;if(permissions[key]){permissions[key]=false;renderPermissions();toast('已关闭示例状态。');}else requestPermission(key,b);}));
$('#voice-start').addEventListener('click',e=>{const start=()=>{voiceActive=true;renderVoice();};if(!permissions.mic)requestPermission('mic',e.currentTarget,start);else start();});
$('#voice-stop').addEventListener('click',()=>{voiceActive=false;renderVoice();toast('已停止语音预览。');});
function openPrivacy(){location.hash='windows';setting('privacy');}
$('#composer-screen').addEventListener('click',openPrivacy);$('#composer-mic').addEventListener('click',openPrivacy);
$$('[data-demo]').forEach(b=>b.addEventListener('click',()=>toast(b.dataset.demo)));
function appendMessage(text,role){const row=document.createElement('div');row.className=`msg ${role}`;if(role==='aimy'){const label=document.createElement('div');label.className='msg-meta';label.textContent='Aimy · 样例回复';row.append(label);}const bubble=document.createElement('div');bubble.className='msg-bubble';bubble.textContent=text;row.append(bubble);$('#chat-feed').append(row);$('#chat-feed').scrollTop=$('#chat-feed').scrollHeight;}
$('#chat-input').addEventListener('input',()=>{$('#send-button').disabled=!$('#chat-input').value.trim();});
$('#chat-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('#chat-form').requestSubmit();}});
$('#chat-form').addEventListener('submit',e=>{e.preventDefault();const text=$('#chat-input').value.trim();if(!text)return;appendMessage(text,'user');$('#chat-input').value='';$('#send-button').disabled=true;appendMessage('我在这里，慢慢说。\n（样例回复，未调用模型。）','aimy');});
$('#hello-button').addEventListener('click',()=>{location.hash='overview';$('#chat-input').value='嗨，Aimy。';$('#send-button').disabled=false;setTimeout(()=>$('#chat-input').focus({preventScroll:true}),0);});
function setting(key,focus=false){$$('[data-setting]').forEach(b=>{const active=b.dataset.setting===key;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;});$$('.settings-content').forEach(p=>{p.hidden=p.id!==`setting-${key}`;});if(focus)$(`#setting-tab-${key}`).focus();}
$$('[data-setting]').forEach((b,index,list)=>{b.addEventListener('click',()=>setting(b.dataset.setting));b.addEventListener('keydown',e=>{let i;if(['ArrowDown','ArrowRight'].includes(e.key))i=(index+1)%list.length;else if(['ArrowUp','ArrowLeft'].includes(e.key))i=(index-1+list.length)%list.length;else if(e.key==='Home')i=0;else if(e.key==='End')i=list.length-1;else return;e.preventDefault();setting(list[i].dataset.setting,true);});});
$('#motion-switch').addEventListener('click',e=>{const b=e.currentTarget,on=b.getAttribute('aria-checked')!=='true';b.setAttribute('aria-checked',String(on));document.documentElement.classList.toggle('reduce-motion',on);toast(on?'已减少动态效果。':'已恢复标准过渡。');});
$('#sample-switch').addEventListener('click',e=>{const b=e.currentTarget,on=b.getAttribute('aria-checked')!=='true';b.setAttribute('aria-checked',String(on));$('#sample-switch-label').textContent=on?'开启（样式）':'关闭';});
$('#connection-form').addEventListener('submit',e=>{e.preventDefault();const b=$('#connection-test');b.disabled=true;b.innerHTML='<span class="a-spinner" aria-hidden="true"></span>测试中';$('#connection-feedback').textContent='仅演示加载状态…';setTimeout(()=>{b.disabled=false;b.textContent='测试连接样式';$('#connection-feedback').textContent='成功状态示例；未发起真实连接。';},1000);});
$('#loading-button').addEventListener('click',e=>{const b=e.currentTarget;b.disabled=true;b.innerHTML='<span class="a-spinner" aria-hidden="true"></span>重试中';setTimeout(()=>{b.disabled=false;b.innerHTML=icon('refresh')+'重试';toast('加载状态示例完成。');},1200);});
$('#delete-button').addEventListener('click',e=>modal({title:'删除这段记录？',copy:'删除后将无法恢复。聊天记录与已确认记忆需要分别清楚管理。',confirm:'删除示例',cancel:'保留记录',trigger:e.currentTarget,danger:true,action:()=>toast('删除交互演示完成。没有实际数据被删除。')}));
const glyphs=['chat','mic','mic-off','screen','image','volume','settings','shield','key','heart','memory','arrow','plus','close','check','moon','sun','download','pause','refresh','expand','move','warning','chevron','back','link'];
$('#icon-grid').innerHTML=glyphs.map(icon).join('');
const states={
 idle:{title:'先不急着说话。',copy:'待机保持安静；麦克风与看屏默认关闭。',trigger:'打开聊天或语音页面。',action:'开始对话，或单独开启权限。',motion:'无持续动画。',label:'待机',body:'今天，想从哪里聊起？'},
 listening:{title:'你说，我在听。',copy:'只有获得麦克风权限并开始聆听，才显示此状态。',trigger:'用户明确开启聆听。',action:'随时停止，不强迫用户继续。',motion:'低幅波形；减少动态时静止。',label:'正在聆听（样式）',body:'说完之后，我会接着回应。'},
 thinking:{title:'正在想怎么回应你。',copy:'等待有稳定位置，不移动已有消息；用户可以取消。',trigger:'用户消息已发送。',action:'显示取消入口，保留用户草稿。',motion:'小型加载指示，不做全屏遮罩。',label:'正在思考（样式）',body:'稍等一下…'},
 speaking:{title:'听得见，也能随时插话。',copy:'说话和聆听分开表达。打断按钮保持可见，不隐藏在菜单里。',trigger:'语音输出开始。',action:'插话或点击停止，立即结束旧声音。',motion:'仅与音频状态同步，禁止假声波。',label:'正在说话（样式）',body:'那今晚就选一部轻松的电影。'},
 interrupted:{title:'好，听你说。',copy:'明确结束旧输出，再衔接新的上下文。状态样式不代表音频取消已经实现。',trigger:'用户插话或点击停止。',action:'停止旧音频，丢弃旧结果。',motion:'160 ms 收起输出指示。',label:'已打断（样式）',body:'刚刚的输出已经停止。'},
 error:{title:'这次没有连接上。',copy:'具体说明可恢复的原因，保留用户输入，提供重试；不把系统故障写成情绪回应。',trigger:'网络、服务或设备返回错误。',action:'检查设置 / 重试。',motion:'无持续加载；错误留在原位置。',label:'连接失败（样式）',body:'请检查服务地址后重试。'}
};
function setState(key){const s=states[key];$$('[data-state]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.state===key)));$('#state-token').textContent=key;$('#state-title').textContent=s.title;$('#state-copy').textContent=s.copy;$('#state-trigger').textContent=s.trigger;$('#state-action').textContent=s.action;$('#state-motion').textContent=s.motion;$('#state-conversation').innerHTML=`<div class="identity"><span class="avatar"><img src="assets/aimy-symbol.svg" alt=""></span><div><h3>Aimy</h3><p>${s.label}</p></div></div><div class="${key==='error'?'a-alert danger':'a-alert'}">${key==='thinking'?'<span class="a-spinner" aria-hidden="true"></span>':icon(key==='error'?'warning':'chat')}<span>${s.body}</span></div>`;$('#interrupt-demo').disabled=key==='interrupted';updateSymbols();}
$$('[data-state]').forEach(b=>b.addEventListener('click',()=>setState(b.dataset.state)));$('#interrupt-demo').addEventListener('click',()=>setState('interrupted'));setState('idle');
$('#copy-tokens').addEventListener('click',async()=>{const text='.primary-action { background: var(--action); color: var(--on-action); border-radius: var(--radius-control); }\n.selected-item { color: var(--accent); background: var(--accent-soft); }';try{await navigator.clipboard.writeText(text);toast('已复制示例变量片段。');}catch{toast('浏览器未允许复制，请从规范文件复制。');}});
