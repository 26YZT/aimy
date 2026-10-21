"""Original AST bodies, synthetic SQLite, original caller+broadcast; fixed IO edges only."""
import ast,asyncio,copy,hashlib,json,logging,math,os,random,re,sqlite3,subprocess,sys,time,types
from pathlib import Path
from datetime import datetime,timedelta,timezone
from contextvars import ContextVar
from typing import Any
ROOT=Path('/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat')
OUT=Path('/tmp/aimy-20261014-memory-ab-proactive')
FIX=Path('/tmp/aimy-20261014-memory-ab/fixtures.json')
assert hashlib.sha256(FIX.read_bytes()).hexdigest()=='61b8c0b87067f9d349876f11217adcb82d321df795ddfec6e330e0f9caa14b61'
FIXTURE=json.loads(FIX.read_text()); BASE=float(FIXTURE['clock_epoch']); FIXED_TEXT='刚才的话题还想听你说说。'
os.environ['TZ']='Asia/Shanghai'; time.tzset()
MANIFEST={}
def extract(file,ns,functions=(),assignments=(),classes=None):
 p=ROOT/file; tree=ast.parse(p.read_text()); nodes=[]; selected=[]
 for n in tree.body:
  name=n.name if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef)) else None
  targets=[]
  if isinstance(n,(ast.Assign,ast.AnnAssign)):
   targets=[t.id for t in (n.targets if isinstance(n,ast.Assign) else [n.target]) if isinstance(t,ast.Name)]
  if name in functions or set(targets)&set(assignments): nodes.append(n); selected.append({'name':name or ','.join(targets),'start':n.lineno,'end':n.end_lineno})
  if classes and name in classes:
   new=copy.deepcopy(n); new.body=[f for f in n.body if isinstance(f,(ast.FunctionDef,ast.AsyncFunctionDef)) and f.name in classes[name]]; nodes.append(new)
   selected += [{'name':name+'.'+f.name,'start':f.lineno,'end':f.end_lineno} for f in new.body]
 exec(compile(ast.fix_missing_locations(ast.Module(body=[ast.ImportFrom(module='__future__',names=[ast.alias(name='annotations')],level=0)]+nodes,type_ignores=[])),str(p),'exec'),ns)
 row=MANIFEST.setdefault(str(p),{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'loaded_exact_bodies':[]}); row['loaded_exact_bodies']+=selected
 return ns
class Cursor:
 def __init__(self,c):self.c=c
 @property
 def rowcount(self):return self.c.rowcount
 async def fetchone(self):return self.c.fetchone()
 async def fetchall(self):return self.c.fetchall()
class AsyncDB:
 def __init__(self,path):self.db=sqlite3.connect(path)
 def __await__(self):
  async def one():return self
  return one().__await__()
 @property
 def row_factory(self):return self.db.row_factory
 @row_factory.setter
 def row_factory(self,v):self.db.row_factory=v
 async def __aenter__(self):return self
 async def __aexit__(self,*a):self.db.close()
 async def execute(self,*a):return Cursor(self.db.execute(*a))
 async def commit(self):self.db.commit()
 async def rollback(self):self.db.rollback()
 async def close(self):self.db.close()
async def noop(*a,**k):return None
async def identity(first,*a,**k):return first
class Clock:
 def __init__(self):self.now=BASE;self.seq=0
 def time(self):return self.now
 def time_ns(self):self.seq+=1;return int(self.now*1e9)+self.seq
class Runner:
 def __init__(self,path,initialize=True):
  self.path=Path(path);self.clock=Clock();self.events=[];self.sent=[];self.claims=[];self.generate_started=asyncio.Event();self.release=asyncio.Event();self.release.set();self.prompts=[]
  if initialize:
   if self.path.exists():self.path.unlink()
   with sqlite3.connect(self.path) as db:
    db.executescript('''CREATE TABLE schedules(id TEXT PRIMARY KEY,type TEXT,trigger_at TEXT,content TEXT,created_at REAL,status TEXT,origin TEXT,origin_room_id TEXT);
CREATE TABLE conversations(id TEXT PRIMARY KEY,title TEXT,model TEXT,created_at REAL,updated_at REAL);
CREATE TABLE messages(id TEXT PRIMARY KEY,conv_id TEXT,role TEXT,content TEXT,created_at REAL,attachments TEXT,reasoning_content TEXT);
CREATE TABLE chatroom_messages(id TEXT PRIMARY KEY,room_id TEXT,sender TEXT,content TEXT,created_at REAL);''')
    db.execute('INSERT INTO conversations VALUES(?,?,?,?,?)',('conv-A','合成会话A','fixed-model',BASE,BASE))
  runner=self
  class FixedDatetime(datetime):
   @classmethod
   def now(cls,tz=None):return datetime.fromtimestamp(runner.clock.now,tz)
  self.ns={'asyncio':asyncio,'copy':copy,'json':json,'logging':logging,'math':math,'random':random,'re':re,'time':self.clock,'datetime':FixedDatetime,'timedelta':timedelta,'ContextVar':ContextVar,'Any':Any,
   'aiosqlite':types.SimpleNamespace(connect=AsyncDB,Row=sqlite3.Row,OperationalError=sqlite3.OperationalError),'DB_PATH':str(self.path),'get_db':lambda:AsyncDB(self.path),'DEFAULT_MODEL':'fixed-model',
   'SETTINGS':{'proactive_companionship_aion_enabled':True},'save_settings':lambda d:None,'load_worldbook':lambda:{'user_name':'合成用户','ai_name':'合成角色'},'log':logging.getLogger('isolated')}
  extract('proactive_companionship.py',self.ns,functions=['_actor_id','is_proactive_enabled','set_proactive_enabled','proactive_ability_text','inject_proactive_ability','extract_next_chat_decision','_message_actor','process_visible_message_event','claim_proactive_timer'],assignments=['PROACTIVE_TYPE','NO_DECISION','_NEXT_CHAT_RE','_SETTING_KEYS'])
  original_claim=self.ns['claim_proactive_timer']
  async def traced_claim(sid):
   result=await original_claim(sid);self.claims.append({'id':sid,'time':self.clock.now,'claimed':result});self.events.append({'stage':'claim','time':self.clock.now,'result':result});return result
  self.ns['claim_proactive_timer']=traced_claim
  extract('autonomy_state.py',self.ns,functions=['normalize_actor','_clamp_minutes','_default_actions','ensure_autonomy_tables','_decode_actions','_config_from_row','get_actor_config','update_actor_config','schedule_actor_wake','refresh_actor_wake_for_user','claim_due_wake','_event_actor','consume_state_block','strip_autonomy_state','process_persona_message_event','autonomy_prompt_text'],assignments=['ACTOR_IDS','MIN_INTERVAL_MINUTES','MAX_INTERVAL_MINUTES','MAX_STATE_CHARS','ACTION_IDS','DEFAULT_OFF_ACTIONS','_STATE_BLOCK_RE','_STATE_OPEN_RE','_STATE_MARKER_RE'])
  pc=types.ModuleType('proactive_companionship');pc.__dict__.update(self.ns)
  async def status_event():return {'type':'proactive_companionship_changed','data':{'synthetic_status_only':True}}
  pc.proactive_status_event=status_event;sys.modules['proactive_companionship']=pc
  st=types.ModuleType('autonomy_state');st.__dict__.update(self.ns);sys.modules['autonomy_state']=st
  # Real generation_event sees the original background path's absent generation scope.
  self.ns['_current']=ContextVar('isolated_generation',default=None)
  extract('generation_control.py',self.ns,functions=['current_generation','generation_event'])
  self.ns.update({'_offer_wechat_mode_event':lambda e:False,'_current_private_ai_name':lambda:'合成角色'})
  extract('ws.py',self.ns,functions=['_with_private_notification_sender'],classes={'ConnectionManager':['broadcast']})
  class Socket:
   async def send_text(sock,text):
    event=json.loads(text);self.sent.append(event)
    if event.get('type')=='msg_created' and event.get('data',{}).get('role')=='assistant' and event['data']['id']!='initial':self.events.append({'stage':'send_recorder','time':self.clock.now,'conv_id':event['data']['conv_id'],'text':event['data']['content']})
  self.manager=self.ns['ConnectionManager']();self.manager.active=[Socket()];self.manager.any_tts_enabled=lambda:False;self.manager.get_aion_last_active=lambda:'private';self.manager.get_connor_last_active=lambda:None
  self.ns['manager']=self.manager
  def mod(name,**attrs):
   m=types.ModuleType(name);m.__dict__.update(attrs);sys.modules[name]=m
  mod('expressive_voice',prepare_message=noop,start_message=lambda *a,**k:None)
  mod('sync_events',is_sync_event_type=lambda t:False,attach_sync_seq=lambda e,s:e,persist_sync_event=noop)
  mod('post_sentinel',observe_message_event=lambda e:None)
  async def acquire(*a,**k):return types.SimpleNamespace(image_result=types.SimpleNamespace(no_image_context='合成隔离环境未采集画面'),prompt_attachment=None,snapshot_attachment=None)
  mod('camera',acquire_prompt_monitor_context=acquire)
  mod('activity',get_monitor_activity_for_prompt=lambda:'',get_user_dynamics_for_prompt=lambda **k:'')
  mod('health_context',build_heart_rate_prompt_block=lambda *a:identity(''))
  async def timeline(*a,**k):return []
  mod('context_builder',fetch_merged_timeline=timeline,render_merged_timeline=lambda *a,**k:[])
  mod('routes');mod('routes.files',export_conversation=noop)
  mod('capabilities',process_pat_commands=identity)
  mod('app_supervision_ai',inject_app_supervision_context=lambda messages:None)
  safe=types.ModuleType('isolated_stream_safety');sys.modules[safe.__name__]=safe;exec(compile((ROOT/'stream_safety.py').read_text(),str(ROOT/'stream_safety.py'),'exec'),safe.__dict__)
  MANIFEST[str(ROOT/'stream_safety.py')]={'sha256':hashlib.sha256((ROOT/'stream_safety.py').read_bytes()).hexdigest(),'loaded_exact_bodies':'complete stdlib-only module loaded; consume_safe_stream/guard executed'}
  class Filter:
   def feed(self,text):return text
   def flush(self):return ''
  async def fixed_stream(messages,*a,**k):
   self.events.append({'stage':'generate_start','time':self.clock.now,'scope':self.ns['current_generation']() is not None});self.prompts.append(copy.deepcopy(messages));self.generate_started.set();await self.release.wait();yield FIXED_TEXT;self.events.append({'stage':'generate_complete','time':self.clock.now})
  async def band_att(msg,atts):return atts
  self.ns.update({'stream_ai':fixed_stream,'CLI_STATUS_PREFIX':'__FIXED_NO_STATUS__','WebCommandStreamFilter':Filter,'consume_safe_stream':safe.consume_safe_stream,'CHAT_STREAM_POLICY':safe.CHAT_STREAM_POLICY,'StreamSafetyResult':safe.StreamSafetyResult,'BACKGROUND_CLI_META':{'synthetic':True},'build_band_note_ability_text':lambda *a,**k:'','MUSIC_CMD_PATTERN':re.compile(r'\[MUSIC:([^]]+)\]'),'_process_background_reply_commands':identity,'with_band_vibration_attachment':band_att})
  extract('schedule.py',self.ns,functions=['proactive_monitor_card_title','_consume_background_stream','_new_background_meta','_broadcast_trigger_debug','_tts_voice_for_target','get_schedule_origin_name','process_schedule_commands','get_active_schedules','build_schedule_prompt'],assignments=['_SCHEDULE_OPEN','_SCHEDULE_CLOSE','_SCHEDULE_COLON','_SCHEDULE_PIPE','_SCHEDULE_FLAGS','ALARM_CMD','REMINDER_CMD','MONITOR_CMD','SCHEDULE_DEL_CMD','SCHEDULE_LIST_CMD'],classes={'ScheduleManager':['__init__','_tick','_resolve_target','_fire_monitor','_save_to_private']})
  self.scheduler=self.ns['ScheduleManager']()
 def rows(self,sql='SELECT * FROM schedules',args=()):
  with sqlite3.connect(self.path) as db:db.row_factory=sqlite3.Row;return [dict(r) for r in db.execute(sql,args)]
 async def plan(self,minutes=2):
  text=f'稍后继续。[NEXT_CHAT:{minutes}]'
  with sqlite3.connect(self.path) as db:db.execute('INSERT INTO messages VALUES(?,?,?,?,?,?,?)',('initial','conv-A','assistant',text,self.clock.now,'[]',''))
  await self.manager.broadcast({'type':'msg_created','data':{'id':'initial','conv_id':'conv-A','role':'assistant','content':text,'created_at':self.clock.now}})
  self.events.append({'stage':'plan','time':self.clock.now,'rows':self.rows()})
 async def user_return(self):
  self.clock.now+=1
  event={'type':'msg_created','data':{'id':'user-return','conv_id':'conv-A','role':'user','content':'我回来了','created_at':self.clock.now}}
  with sqlite3.connect(self.path) as db:db.execute('INSERT INTO messages VALUES(?,?,?,?,?,?,?)',('user-return','conv-A','user','我回来了',self.clock.now,'[]',''))
  await self.manager.broadcast(event);self.events.append({'stage':'cancel_by_user','time':self.clock.now,'remaining':len(self.rows())})
 def disable(self):
  self.ns['set_proactive_enabled']('aion',False);self.events.append({'stage':'disable','time':self.clock.now,'enabled':self.ns['is_proactive_enabled']('aion'),'remaining':len(self.rows())})
 def switch(self):
  with sqlite3.connect(self.path) as db:db.execute('INSERT INTO conversations VALUES(?,?,?,?,?)',('conv-B','合成会话B','fixed-model',self.clock.now+1,self.clock.now+1))
  self.events.append({'stage':'switch_session','time':self.clock.now,'active':'conv-B'})
 async def advance(self):
  # Invoke original poll body at actual 30 second poll boundaries; no sleep/thread.
  for step in (30,60,90,120):self.clock.now=BASE+step;await self.scheduler._tick()
 def summary(self):
  messages=self.rows("SELECT id,conv_id,role,content,created_at FROM messages WHERE role='assistant' AND id!='initial'")
  return {'events':self.events,'claim_attempts':self.claims,'submissions':messages,'recorded_sends':[e for e in self.sent if e.get('type')=='msg_created' and e.get('data',{}).get('role')=='assistant' and e['data'].get('id')!='initial'],'remaining_plans':self.rows(),'fixed_model_inputs':self.prompts,'generation_scope_registered':False}
async def case(spec):
 id=spec['id'];r=Runner(OUT/f'{id}.sqlite')
 if id=='PR09':
  # Background recall DTO is not a scheduled plan or a sender. No artificial spark/visible event.
  r.events.append({'stage':'background_memory_context_only','time':BASE,'text':'合成旧记忆浮现','producer_not_executed':True});await r.advance();outcome='inconclusive';reason='空计划下原调度不提交；记忆浮现生产者与其完整接线未在本项执行，不冒称该生产链已验。'
 elif id=='PR05':
  creator=subprocess.run([sys.executable,__file__,'--phase','plan','--db',str(OUT/'PR05-fresh.sqlite')],capture_output=True,text=True,check=True)
  fire=subprocess.run([sys.executable,__file__,'--phase','fire','--db',str(OUT/'PR05-fresh.sqlite')],capture_output=True,text=True,check=True)
  c=json.loads(creator.stdout);f=json.loads(fire.stdout);assert c['pid']!=f['pid']!=os.getpid();assert len(f['submissions'])==1
  return {'id':id,'contract':spec['contract'],'contract_outcome':'pass','reason':'两个独立新 OS 进程同隔离 SQLite；第二进程原 tick/fire/claim/save/broadcast 一次，第二次 fire 领取失败。','observation':{'creator':c,'restarted':f},'evidence_level':'original caller+SQLite+fake model+original broadcast to recorder'}
 else:
  await r.plan(61 if id=='PR10' else 2);planned=r.rows()
  if id=='PR03':await r.user_return()
  if id=='PR04':r.disable()
  if id=='PR06':r.switch()
  if id in ('PR07','PR08'):
   r.release.clear();r.clock.now=BASE+120;task=asyncio.create_task(r.scheduler._tick());await asyncio.wait_for(r.generate_started.wait(),3)
   if id=='PR07':await r.user_return()
   else:r.disable()
   r.release.set();await task
  else:await r.advance()
  if id=='PR02':
   before=len(r.summary()['submissions']);await asyncio.gather(*(r.scheduler._fire_monitor(copy.deepcopy(planned[0])) for _ in range(2)));assert len(r.summary()['submissions'])==before
  s=r.summary();n=len(s['submissions'])
  if id in ('PR01','PR02'):outcome='pass' if n==1 else 'fail';reason='原两分钟计划经原调度、原领取、固定生成、原保存与原 broadcast 进入记录器一次。'
  elif id=='PR03':outcome='pass' if n==0 and not s['remaining_plans'] else 'fail';reason='真实 user msg_created 经原 broadcast hook 删除未领取计划。'
  elif id in ('PR04','PR07','PR08'):outcome='pass' if n==0 else 'fail';reason='关闭/回归后仍有原保存+原 broadcast 发言；完整 caller 未拦住，不只 helper 领取观察。'
  elif id=='PR06':outcome='pass' if not any(m['conv_id']=='conv-B' for m in s['submissions']) else 'fail';reason='原计划未绑定私聊 conv_id；触发时 SELECT 最新会话，原结果发往 conv-B。'
  else:outcome='pass' if n==0 and not planned else 'fail';reason='原 parser 拒绝61且清理标记；没有生成两分钟计划。'
  if id=='PR10':assert n==0 and not planned
  if id in ('PR04','PR07','PR08'):assert n==1,'Counterexample reproduction assertion, contract remains FAIL'
 return {'id':id,'contract':spec['contract'],'contract_outcome':outcome,'reason':reason,'observation':r.summary(),'evidence_level':'original caller+SQLite+fake model+original broadcast to recorder'}
async def idle_cases():
 results=[]
 for mode in ['disabled_before_claim','user_before_claim','disable_during_generation','user_during_generation']:
  r=Runner(OUT/f'idle-{mode}.sqlite');ns=r.ns
  async def append_event(*a,**k):return {'id':'synthetic-idle-event','metadata':k.get('metadata',{})}
  async def ask(*a,**k):
   r.events.append({'stage':'idle_select_generation_start','time':r.clock.now});r.generate_started.set();await r.release.wait();return {'action':'private_chat','reason':'固定模型控制变量','message':FIXED_TEXT}
  async def empty_list(*a,**k):return []
  ns.update({'_AUTONOMY_WAKE_INTERNAL':ContextVar('idle_internal',default=False),'_AUTONOMY_WAKE_MONITOR_CONTEXT':ContextVar('idle_monitor',default=None),'_actor_label':lambda a:'合成角色' if a=='aion' else '合成用户','_ask_actor_json':ask,'recent_niche_index':empty_list,'append_idle_event':append_event,'_capture_autonomy_monitor_context':lambda a:identity(None),'_save_autonomy_monitor_card':noop,'_with_link_previews':lambda text,atts:identity(atts),'strip_urls_for_message':lambda t:t})
  extract('autonomy.py',ns,functions=['_idle_duration_text','_select_action','_run_actor_once','_run_private_chat','_save_private_message','_save_aion_private_message','_latest_conversation','_latest_user_message_ts'],assignments=['ACTION_DEFS'],classes={'IdleAutonomyManager':['__init__','run_actor_once']})
  cfg=await ns['update_actor_config']('aion',enabled=True,min_interval_minutes=5,max_interval_minutes=5,actions={a:a=='private_chat' for a in ns['ACTION_IDS']})
  assert cfg['next_wake_at']==BASE+300
  r.clock.now=BASE+300
  idle=ns['IdleAutonomyManager']()
  if mode=='disabled_before_claim':await ns['update_actor_config']('aion',enabled=False);ret=await idle.run_actor_once('aion')
  elif mode=='user_before_claim':await r.user_return();ret=await idle.run_actor_once('aion')
  else:
   r.release.clear();task=asyncio.create_task(idle.run_actor_once('aion'));await asyncio.wait_for(r.generate_started.wait(),3)
   if mode=='disable_during_generation':await ns['update_actor_config']('aion',enabled=False)
   else:await r.user_return()
   r.release.set();ret=await task
  n=len(r.summary()['submissions']);expected=0;assert n==(0 if mode in ('disabled_before_claim','user_before_claim') else 1),(mode,ret,r.summary())
  results.append({'id':'IDLE-'+mode,'contract_outcome':'pass' if n==expected else 'fail','native_minimum_minutes':5,'same_PR_two_minute_plan_supported':False,'return':ret,'observation':r.summary(),'boundary':'独立 autonomy_actor_configs 开关，非 NEXT_CHAT 开关；原 manager/select/save/broadcast 运行，固定JSON选择；未调用外部动作。'})
 return results
async def main():
 if '--phase' in sys.argv:
  phase=sys.argv[sys.argv.index('--phase')+1];path=sys.argv[sys.argv.index('--db')+1];r=Runner(path,initialize=phase=='plan')
  if phase=='plan':await r.plan()
  else:
   prior=r.rows();await r.advance();await asyncio.gather(*(r.scheduler._fire_monitor(copy.deepcopy(prior[0])) for _ in range(2)))
  print(json.dumps({'pid':os.getpid(),**r.summary()},ensure_ascii=False));return
 rows=[await case(s) for s in FIXTURE['proactive_cases']];idle=await idle_cases()
 report={'fixture_sha256':hashlib.sha256(FIX.read_bytes()).hexdigest(),'project':'AionsHome','model_output':FIXED_TEXT,'cases':rows,'idle_caller_supplement':idle,'limits':['非真实UI接收/显示或TTS/听感验收','原 broadcast 路径连接假WebSocket记录器，摄像头/健康/活动/context-builder/导出/所有命令副作用关闭或替身','只执行aion私聊分支，不泛化Connor/群聊','SQLite真正持久化；async适配器基于stdlib同步sqlite，未做多线程/崩溃注入','背景主动未进入 user-triggered generation scope；原generation_event运行，故不能借普通chat显式取消机制推定本链已受保护']}
 (OUT/'aions-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
 (OUT/'aions-source-manifest.json').write_text(json.dumps(MANIFEST,ensure_ascii=False,indent=2))
 print(json.dumps({'cases':[{k:x[k] for k in ('id','contract_outcome','reason')} for x in rows],'idle':[{k:x[k] for k in ('id','contract_outcome')} for x in idle]},ensure_ascii=False,indent=2))
if __name__=='__main__':asyncio.run(main())
