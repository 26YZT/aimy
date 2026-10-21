/* Local design preview only. No network, devices, persistence, or real model. */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const state = { mic: false, screen: false };
let toastTimer;
function toast(text) { $('#toast').textContent = text; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').textContent = ''; }, 3500); }
function revealPrototype() {
  const reduced=document.documentElement.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('.prototype').scrollIntoView({behavior:reduced?'instant':'smooth',block:'center'});
}
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('#theme-toggle').setAttribute('aria-pressed', String(theme === 'dark'));
  $('#theme-toggle').setAttribute('aria-label', theme === 'dark' ? '切换为浅色主题' : '切换为夜间主题');
  $('#theme-toggle use').setAttribute('href', `assets/ui-icons.svg#i-${theme === 'dark' ? 'sun' : 'moon'}`);
  $$('[data-theme-option]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeOption === theme)));
  document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim();
  renderSwatches();
}
$('#theme-toggle').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
$$('[data-theme-option]').forEach(b => b.addEventListener('click', () => setTheme(b.dataset.themeOption)));
function panel(name, focus = false) {
  $$('[data-panel]').forEach(b => { b.setAttribute('aria-selected',String(b.dataset.panel === name)); b.tabIndex = b.dataset.panel === name ? 0 : -1; });
  $$('[role="tabpanel"]').forEach(p => { p.hidden = p.id !== `panel-${name}`; });
  if (focus) $(`#tab-${name}`).focus();
}
$$('[data-panel]').forEach((b,index,buttons) => {
  b.addEventListener('click', () => panel(b.dataset.panel));
  b.addEventListener('keydown', e => {
    let i;
    if (e.key === 'ArrowRight') i = (index + 1) % buttons.length;
    else if (e.key === 'ArrowLeft') i = (index - 1 + buttons.length) % buttons.length;
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = buttons.length-1;
    else return;
    e.preventDefault(); panel(buttons[i].dataset.panel, true);
  });
});
function permissionRender() {
  ['mic','screen'].forEach(key => {
    $(`#${key}-switch`).setAttribute('aria-checked', String(state[key]));
    $(`#${key}-label`).textContent = state[key] ? '已开启（预览）' : '已关闭';
    $(`#${key}-label`).className = state[key] ? 'badge success' : 'badge';
  });
  $('#permission-summary').textContent = `麦克风${state.mic ? '开启（预览）' : '关闭'} · 看屏${state.screen ? '开启（预览）' : '关闭'}`;
  $('#mic-shortcut').classList.toggle('active',state.mic);
  $('#mic-shortcut use').setAttribute('href',`assets/ui-icons.svg#i-${state.mic ? 'mic' : 'mic-off'}`);
  $('#screen-shortcut').classList.toggle('active',state.screen);
  $('#preview-state').innerHTML = `<span class="dot"></span>${state.mic ? '语音状态预览' : '文字陪伴'}`;
}
let pendingAction = null;
let dialogTrigger = null;
function dialog({title,copy,confirm,cancel='先不开启',action,trigger}) {
  $('#dialog-title').textContent=title; $('#dialog-copy').textContent=copy;
  $('#dialog-confirm').textContent=confirm; $('#dialog-cancel').textContent=cancel;
  $('#dialog-confirm').className=title.startsWith('删除')?'btn danger':'btn';
  pendingAction=action; dialogTrigger=trigger; $('#demo-dialog').showModal(); $('#dialog-cancel').focus();
}
$('#dialog-cancel').addEventListener('click', () => $('#demo-dialog').close());
$('#dialog-confirm').addEventListener('click', () => { const fn=pendingAction; pendingAction=null; $('#demo-dialog').close(); if(fn) fn(); });
$('#demo-dialog').addEventListener('close', () => { pendingAction=null; if(dialogTrigger?.isConnected) dialogTrigger.focus(); });
$$('.permission-switch').forEach(b => b.addEventListener('click', () => {
  const key=b.dataset.permission;
  if(state[key]) { state[key]=false; permissionRender(); toast('已关闭预览状态。'); return; }
  dialog({title:key==='mic'?'开启麦克风？':'开启看屏？',copy:key==='mic'?'开启后，Aimy 才会开始听你说话。你可以随时关闭。':'开启后，Aimy 才会查看你选择的屏幕。截图默认不长期保存，你可以随时停止。',confirm:'开启预览状态',trigger:b,action:()=>{state[key]=true;permissionRender();toast('已开启示例状态。没有访问设备。');}});
}));
function openPrivacy() { panel('privacy'); revealPrototype(); $('#tab-privacy').focus(); }
$('#mic-shortcut').addEventListener('click',openPrivacy);$('#screen-shortcut').addEventListener('click',openPrivacy);
$('#stage-mic').addEventListener('click',openPrivacy);
$('#stage-chat').addEventListener('click',()=>{panel('chat');revealPrototype();$('#message-input').focus({preventScroll:true});});
$$('[data-demo]').forEach(b=>b.addEventListener('click',()=>toast(b.dataset.demo)));
$('#reduce-motion').addEventListener('click',e=>{
  const b=e.currentTarget, on=b.getAttribute('aria-checked')!=='true'; b.setAttribute('aria-checked',String(on));
  document.documentElement.classList.toggle('reduce-motion',on); toast(on?'已减少界面动态效果。':'已恢复正常过渡。');
});
function message(text,role) {
  const row=document.createElement('div');row.className=`message ${role==='user'?'user':''}`;
  if(role==='aimy'){const label=document.createElement('div');label.className='message-label';label.textContent='Aimy · 示例回复';row.append(label);}
  const bubble=document.createElement('div');bubble.className=`bubble ${role}`;bubble.textContent=text;row.append(bubble);
  $('#chat-messages').append(row);$('#chat-messages').scrollTop=$('#chat-messages').scrollHeight;
}
$('#message-input').addEventListener('input',()=>{$('#send').disabled=!$('#message-input').value.trim();});
$('#message-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('#chat-form').requestSubmit();}});
$('#chat-form').addEventListener('submit',e=>{
  e.preventDefault();const text=$('#message-input').value.trim();if(!text)return;
  message(text,'user');$('#message-input').value='';$('#send').disabled=true;
  message('我在这里，慢慢说。\n（这是界面样例回复，未调用模型。）','aimy');
});
$('#hello-demo').addEventListener('click',()=>{panel('chat');$('#message-input').value='嗨，Aimy。';$('#send').disabled=false;revealPrototype();$('#message-input').focus({preventScroll:true});});
$('#connection-demo').addEventListener('click',e=>{const b=e.currentTarget;b.disabled=true;b.textContent='测试中…';setTimeout(()=>{b.disabled=false;b.textContent='测试连接样式';toast('连接成功状态示例。未发起真实连接。');},900);});
$('#loading-demo').addEventListener('click',e=>{const b=e.currentTarget,old=b.innerHTML;b.disabled=true;b.innerHTML='<span class="spinner" aria-hidden="true"></span>处理中';setTimeout(()=>{b.innerHTML=old;b.disabled=false;toast('加载状态演示完成。');},1400);});
$('#delete-demo').addEventListener('click',e=>dialog({title:'删除这段记录？',copy:'删除后将无法恢复。正式产品中，聊天记录与已确认记忆需要分别清楚管理。',confirm:'删除示例',cancel:'保留记录',trigger:e.currentTarget,action:()=>toast('删除样式演示完成。没有实际记录被删除。')}));
const glyphs=['chat','mic','mic-off','screen','image','volume','settings','shield','key','heart','memory','arrow','plus','close','check','moon','sun','download','pause','refresh','expand','move','warning','chevron','back'];
$('#glyphs').innerHTML=glyphs.map(k=>`<svg class="icon" aria-hidden="true"><use href="assets/ui-icons.svg#i-${k}"/></svg>`).join('');
const swatches=[['canvas','雾白 / 背景'],['primary-soft','浅樱 / 选中底'],['primary','莓粉 / 主操作'],['text','梅灰 / 正文'],['text-secondary','柔灰 / 辅助'],['success','鼠尾草 / 成功']];
function renderSwatches(){const style=getComputedStyle(document.documentElement);$('#color-grid').innerHTML=swatches.map(([key,name])=>{const value=style.getPropertyValue(`--${key}`).trim();return `<div class="swatch"><div class="swatch-color" style="background:var(--${key})"></div><div class="swatch-body"><strong>${name}</strong><code>${value.toUpperCase()}</code></div></div>`;}).join('');}
renderSwatches();
