"""Current-source isolated memory checks; stdlib SQLite adapter, fake model/config/notify only."""
import ast,asyncio,copy,hashlib,json,logging,math,os,re,sqlite3,subprocess,sys,time,types,uuid
from pathlib import Path
from datetime import datetime,timedelta
from dataclasses import dataclass,field
from typing import Literal,Sequence
from collections import Counter
os.environ['TZ']='Asia/Shanghai'
if hasattr(time,'tzset'):time.tzset()
R=Path('/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat');O=Path('/tmp/aimy-20261014-delta-memory')
loaded=[]
def extract(name,names,ns):
 p=R/name;t=ast.parse(p.read_text());nodes=[]
 for n in t.body:
  if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef)) and n.name in names:
   
   if not isinstance(n,ast.ClassDef):n.decorator_list=[]
   nodes.append(n);loaded.append({'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'symbol':n.name,'start':n.lineno,'end':n.end_lineno})
 assert len(nodes)==len(names),(name,names,[n.name for n in nodes])
 exec(compile(ast.Module(body=nodes,type_ignores=[]),str(p),'exec'),ns)
class Cursor:
 def __init__(self,c):self.c=c
 @property
 def rowcount(self):return self.c.rowcount
 async def fetchone(self):return self.c.fetchone()
 async def fetchall(self):return self.c.fetchall()
class AsyncDB:
 def __init__(self,p):self.db=sqlite3.connect(p)
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
policy={};exec(compile((R/'user_profile_policy.py').read_text(),str(R/'user_profile_policy.py'),'exec'),policy)
async def noop(*a,**k):pass
class Runner:
 def __init__(self,p,initialize=True):
  self.p=p;self.enabled=True;self.before_model=None;self.response={'updates':[{'category':'profile','topic':'游戏偏好','content':'合成用户喜欢星露谷物语','sources':['U1']}]};self.calls=0
  self.ns=dict(policy,asyncio=asyncio,contextvars=__import__('contextvars'),uuid=uuid,json=json,math=math,re=re,time=time,datetime=datetime,aiosqlite=types.SimpleNamespace(Row=sqlite3.Row),get_db=lambda:AsyncDB(self.p),load_worldbook=lambda:{'user_name':'合成用户'},get_sentinel_config=lambda:{'model':'FAKE_BOUNDARY'},enabled=lambda:self.enabled,_notify_changed=noop,KEY_RE=re.compile(r'^[a-zA-Z0-9_.-]{1,100}$'),_wake=None,log=logging.getLogger('delta-offline'))
  names={'_profile_user_name','ensure_schema','_read','snapshot','_entry','_check_budget','save_manual','invalidate_pending','enqueue_event','_context_for_job','_analysis_prompt','_profile_refs','_apply_analysis','run_pending_once'}
  extract('post_sentinel.py',names,self.ns)
  async def model(prompt):
   self.calls+=1
   if self.before_model:await self.before_model()
   return copy.deepcopy(self.response)
  self.ns['_call_model']=model
  if initialize:
   if p.exists():p.unlink()
   with sqlite3.connect(p) as db:db.executescript('CREATE TABLE messages(id TEXT PRIMARY KEY,conv_id TEXT,role TEXT,content TEXT,created_at REAL);CREATE TABLE chatroom_messages(id TEXT PRIMARY KEY,room_id TEXT,sender TEXT,content TEXT,created_at REAL);')
 async def seed(self,text='我喜欢玩星露谷物语',id='u1',ts=1000):
  await self.ns['ensure_schema']()
  with sqlite3.connect(self.p) as db:db.execute('INSERT INTO messages VALUES(?,?,?,?,?)',(id,'c1','user',text,ts))
  await self.ns['enqueue_event']({'type':'msg_created','data':{'id':id,'conv_id':'c1','role':'user','content':text,'created_at':ts}})
 async def run(self):return await self.ns['run_pending_once']()
 def doc(self):
  with sqlite3.connect(self.p) as db:return json.loads(db.execute('SELECT payload FROM post_sentinel_document').fetchone()[0])
 def status(self):
  with sqlite3.connect(self.p) as db:return db.execute('SELECT status FROM post_sentinel_jobs ORDER BY source_ts LIMIT 1').fetchone()[0]
 def visible(self):return [x for x in self.doc()['entries'].values() if not x.get('deleted')]

if len(sys.argv)>1 and sys.argv[1]=='read':
 x=Runner(Path(sys.argv[2]),False);snapshot=asyncio.run(x.ns['snapshot']());print(json.dumps({'visible':snapshot['entries'],'status':x.status()},ensure_ascii=False));sys.exit(0)
if len(sys.argv)>1 and sys.argv[1]=='claim_timer':
 pc={'aiosqlite':types.SimpleNamespace(connect=AsyncDB),'DB_PATH':Path(sys.argv[2]),'PROACTIVE_TYPE':'proactive'}
 extract('proactive_companionship.py',{'claim_proactive_timer'},pc)
 print(json.dumps({'claimed':asyncio.run(pc['claim_proactive_timer'](sys.argv[3]))}));sys.exit(0)
results=[]
def emit(id,slice,kind,description,observed,targets):results.append({'test_id':id,'slice':slice,'kind':kind,'description':description,'observed':observed,'real_source_targets':targets})
async def main():
 x=Runner(O/'positive.db');await x.seed();await x.run();assert len(x.visible())==1 and x.status()=='done'
 emit('DM-P01','MEM-F01','positive','真实任务/SQL保存有来源画像',{'facts':len(x.visible()),'sources':x.visible()[0]['sources'],'job':x.status(),'model_calls':x.calls},['post_sentinel.enqueue_event','_context_for_job','_apply_analysis','run_pending_once'])
 child=subprocess.run([sys.executable,'-B',str(Path(__file__)),'read',str(x.p)],check=True,capture_output=True,text=True);rd=json.loads(child.stdout);assert len(rd['visible'])==1
 emit('DM-P02','MEM-F01','positive','新Python进程读取同合成SQLite',{'facts':len(rd['visible']),'job':rd['status'],'limits':'不是启动完整FastAPI或AIRI IndexedDB'},['post_sentinel._read','snapshot data storage shape'])
 x=Runner(O/'bad-source.db');await x.seed();x.response['updates'][0]['sources']=['U999'];await x.run();assert not x.visible() and x.status()=='pending'
 emit('DM-N01','MEM-F01','negative_blocked','模型引用非白名单source拒写',{'facts':0,'job':x.status()},['post_sentinel._apply_analysis','run_pending_once'])
 for action,id in [('edit','DM-N02'),('delete','DM-N03')]:
  x=Runner(O/f'source-{action}.db');await x.seed()
  async def mutate(action=action,x=x):
   with sqlite3.connect(x.p) as db:
    if action=='edit':db.execute("UPDATE messages SET content='这是修改后的不同事实' WHERE id='u1'")
    else:db.execute("DELETE FROM messages WHERE id='u1'")
  x.before_model=mutate;await x.run();assert not x.visible() and x.status()=='skipped'
  emit(id,'MEM-F01','negative_blocked','模型await期间原文'+action+'后旧结果拒写',{'facts':0,'job':x.status()},['post_sentinel._context_for_job','run_pending_once'])
 x=Runner(O/'manual-revision.db');await x.seed()
 async def manual():
  await x.ns['save_manual']({'entries':[{'key':'manual.name','category':'profile','content':'合成用户的新称呼是米米','topic':'称呼'}]},0)
 x.before_model=manual;await x.run();assert len(x.visible())==1 and '米米' in x.visible()[0]['content'] and x.status()=='pending'
 emit('DM-N04','MEM-F01','negative_blocked','模型await期间手动revision更新不被旧结果覆盖',{'retained':x.visible()[0]['content'],'job':x.status()},['post_sentinel.save_manual','run_pending_once'])
 x=Runner(O/'epoch.db');await x.seed()
 async def disable():
  x.enabled=False;await x.ns['invalidate_pending']();x.enabled=True
 x.before_model=disable;await x.run();assert not x.visible() and x.status()=='skipped'
 emit('DM-N05','MEM-F01','negative_blocked','关闭再开但epoch改变，旧模型拒写',{'facts':0,'job':x.status()},['post_sentinel.invalidate_pending','run_pending_once'])
 x=Runner(O/'forget.db');await x.seed();await x.run();snap=await x.ns['snapshot']();await x.ns['save_manual']({'entries':[]},snap['revision']);doc=x.doc();assert not x.visible()
 key=next(iter(doc['entries']));same={'updates':[{'ref':'P1','category':'profile','topic':'游戏偏好','content':'合成用户喜欢星露谷物语','sources':['U1']}]};changed=x.ns['_apply_analysis'](doc,same,{'U1':'private:u1'},{'source_ts':2000,'_source_times':{'U1':2000}});assert not changed
 emit('DM-N06','MEM-F01','negative_blocked','手动删画像后同ref不能重建',{'deleted_key':key,'changed':changed},['post_sentinel.save_manual','_apply_analysis'])
 different={'updates':[{'category':'profile','topic':'周末消遣','content':'合成用户喜欢星露谷物语','sources':['U1']}]};changed=x.ns['_apply_analysis'](doc,different,{'U1':'private:u1'},{'source_ts':2000,'_source_times':{'U1':2000}});assert changed and any(not v.get('deleted') for v in doc['entries'].values())
 emit('DM-C01','MEM-F01','counterexample','删除同ref屏障不能保证另topic同义事实不重建',{'new_fact_created':True,'same_source':'private:u1','limits':'真实_apply_analysis接受边界输出；不是实际模型一定这样输出'},['post_sentinel._apply_analysis'])
 x=Runner(O/'quoted-counter.db');await x.seed('写作示例里的人叫张三，我本人不叫张三。');x.response={'updates':[{'category':'profile','topic':'称呼','content':'合成用户叫张三','sources':['U1']}]};await x.run();assert len(x.visible())==1
 emit('DM-C02','MEM-F01','counterexample','有效source ID不等于模型理解本人/否定正确',{'wrong_candidate_with_valid_source_accepted':True,'limits':'故意假模型错误候选；检测确定性校验边界，不评真实模型精确率'},['post_sentinel._apply_analysis','run_pending_once'])
 # Deterministic time-state and bounded context functions, no model.
 now=1800000000;D=86400
 t={'key':'task','category':'recent','kind':'task','status':'active','due_at':now-1,'source_ts':now-D,'content':'合成待办'};status=policy['lifecycle'](t,now);assert status=='unknown'
 emit('DM-P03','MEM-F02','positive','任务过截止是unknown而非done',{'status':status},['user_profile_policy.lifecycle'])
 project={'category':'recent','kind':'project','status':'active','source_ts':now-20*D,'sustained':False};assert policy['lifecycle'](project,now)=='stale';project['sustained']=True;assert policy['lifecycle'](project,now)=='active'
 emit('DM-P04','MEM-F02','positive','持续项目与临时项目采用不同老化规则',{'temporary_20days':'stale','sustained_20days':'active','limits':'这些天数是原项目政策，不证明Aimy用户偏好'},['user_profile_policy.lifecycle'])
 entries={f'f{i}':{'key':f'f{i}','category':'profile','kind':'context','status':'active','topic':str(i),'content':'合成事实'+str(i)+'甲'*180,'source_ts':now,'deleted':False} for i in range(30)}
 text,included=policy['render_context']({'entries':entries,'current_state':None},'合成用户',now);assert len(text)<=1200 and included
 emit('DM-P05','MEM-F02','positive','共享画像输出1200字符内并保持整条事实',{'chars':len(text),'included':len(included),'total':30},['user_profile_policy.render_context'])
 # Actual active search pure leaves.
 module=types.ModuleType('delta_search');sys.modules[module.__name__]=module;ns=module.__dict__;ns.update(asyncio=asyncio,json=json,math=math,re=re,Counter=Counter,dataclass=dataclass,field=field,datetime=datetime,timedelta=timedelta,Literal=Literal,Sequence=Sequence)
 extract('memory.py',{'_coerce_ts','_format_ts_label','_memory_time_payload'},ns)
 t=ast.parse((R/'active_memory_search.py').read_text());assign=[n for n in t.body if isinstance(n,ast.Assign) and all(isinstance(v,ast.Name) and (v.id.startswith('MAX_') or v.id in {'SUMMARY_LIMIT','SOURCE_LIMIT','SUMMARY_SOFT_LIMIT','NORMAL_BLOCK_LIMIT','HARD_BLOCK_LIMIT','_COMMAND_RE','_CSV_SPLIT_RE','_SPACE_RE'}) for v in n.targets)];exec(compile(ast.Module(body=assign,type_ignores=[]),str(R/'active_memory_search.py'),'exec'),ns)
 names={'MemorySearchRequest','MemorySearchResult','_clean_query','extract_memory_search_requests','parse_memory_keywords','_logical_day_start','_parse_date','resolve_memory_time_window','_norm','rank_memory_rows','_format_time','format_memory_search_context'};extract('active_memory_search.py',names,ns)
 clean,reqs=ns['extract_memory_search_requests']('看看昨天 [MEMORY_SEARCH:面试|date=昨天|detail]');anchor=datetime(2026,10,14,10).astimezone();start,end=ns['resolve_memory_time_window'](reqs[0],anchor)
 rows=[{'id':'m1','content':'合成用户昨天参加面试','keywords':'["面试"]','source_start_ts':start+60,'created_at':start+60,'importance':.5},{'id':'m2','content':'合成用户前天参加面试','keywords':'["面试"]','source_start_ts':start-D+60,'created_at':start-D+60,'importance':.5}]
 ranked=ns['rank_memory_rows'](rows,reqs,actor='aion',vector_scores={},now=anchor);assert [r.memory_id for r in ranked]==['m1']
 block=ns['format_memory_search_context'](ranked,'合成问题');assert 'memory:m1' in block and '以下仅为历史证据' in block
 emit('DM-P06','MEM-F02','positive','无向量分数时关键词+日期取正确事件并带source回执',{'ids':[r.memory_id for r in ranked],'source_receipt':True,'limits':'只验证rank/format原函数，不是端到端真实embedding质量'},['active_memory_search.extract_memory_search_requests','resolve_memory_time_window','rank_memory_rows','format_memory_search_context'])
 irrelevant=ns['rank_memory_rows'](rows,[ns['MemorySearchRequest']('火星不存在的词')],actor='aion',vector_scores={},now=anchor);assert not irrelevant
 emit('DM-N07','MEM-F02','negative_blocked','无时间窗口无关键词命中时不硬召回',{'results':0},['active_memory_search.rank_memory_rows'])
 try:ns['resolve_memory_time_window'](ns['MemorySearchRequest']('面试',date_text='2月31日'),anchor)
 except ValueError:emit('DM-C03','MEM-F02','counterexample','中文非法月日未归一化为拒绝结果，会抛ValueError',{'raised':'ValueError','limits':'真实纯函数边界；上层可能另有异常处理，不能称完整服务崩溃'},['active_memory_search._parse_date','resolve_memory_time_window'])
 else:raise AssertionError('Expected invalid date counterexample')
 # Proactive source functions with same SQLite protocol and fake settings only.
 pcpath=O/'proactive.db'
 if pcpath.exists():pcpath.unlink()
 with sqlite3.connect(pcpath) as db:db.executescript("CREATE TABLE schedules(id TEXT PRIMARY KEY,type TEXT,trigger_at TEXT,content TEXT,created_at REAL,status TEXT,origin TEXT,origin_room_id TEXT);CREATE TABLE messages(id TEXT PRIMARY KEY,role TEXT,content TEXT,created_at REAL);INSERT INTO messages VALUES('r1','assistant','合成续聊 [NEXT_CHAT:2]',1000);")
 pc=dict(copy=copy,re=re,time=time,datetime=datetime,aiosqlite=types.SimpleNamespace(connect=AsyncDB),DB_PATH=pcpath,SETTINGS={'proactive_companionship_aion_enabled':True},save_settings=lambda d:None,PROACTIVE_TYPE='proactive',NO_DECISION=object(),_NEXT_CHAT_RE=re.compile(r'[\[［]\s*NEXT_CHAT\s*[:：]\s*([^\]］]+?)\s*[\]］]',re.I),_SETTING_KEYS={'aion':'proactive_companionship_aion_enabled','connor':'proactive_companionship_connor_enabled'})
 extract('proactive_companionship.py',{'_actor_id','is_proactive_enabled','set_proactive_enabled','extract_next_chat_decision','_message_actor','process_visible_message_event','claim_proactive_timer'},pc)
 clean,decision=pc['extract_next_chat_decision']('合成话[NEXT_CHAT:2]');assert decision==2 and clean=='合成话';assert pc['extract_next_chat_decision']('[NEXT_CHAT:61]')[1] is pc['NO_DECISION']
 emit('DM-P07','PRO-F01','positive','NEXT_CHAT限定1–60并剥离可见标签',{'valid_minutes':2,'61_rejected':True},['proactive_companionship.extract_next_chat_decision'])
 await pc['process_visible_message_event']({'type':'msg_created','data':{'id':'r1','role':'assistant','content':'合成续聊 [NEXT_CHAT:2]','created_at':1000}})
 with sqlite3.connect(pcpath) as db:timer=db.execute('SELECT id FROM schedules').fetchone()[0]
 child=subprocess.run([sys.executable,'-B',str(Path(__file__)),'claim_timer',str(pcpath),timer],check=True,capture_output=True,text=True);assert json.loads(child.stdout)['claimed'];assert not await pc['claim_proactive_timer'](timer)
 emit('DM-P08','PRO-F01','positive','timer落SQLite，新Python进程只领取一次',{'first_claim':True,'second_claim':False,'limits':'新进程执行claim原函数；没有启动真实ScheduleManager/_fire_monitor/模型/设备'},['proactive_companionship.process_visible_message_event','claim_proactive_timer'])
 await pc['process_visible_message_event']({'type':'msg_created','data':{'id':'r1','role':'assistant','content':'合成续聊 [NEXT_CHAT:2]','created_at':1000}});await pc['process_visible_message_event']({'type':'msg_created','data':{'id':'u2','role':'user','content':'我回来啦','created_at':1001}})
 with sqlite3.connect(pcpath) as db:count=db.execute('SELECT COUNT(*) FROM schedules').fetchone()[0]
 assert count==0;emit('DM-N08','PRO-F01','negative_blocked','新用户可见消息撤销待领取timer',{'remaining':count},['proactive_companionship.process_visible_message_event'])
 await pc['process_visible_message_event']({'type':'msg_created','data':{'id':'r1','role':'assistant','content':'合成续聊 [NEXT_CHAT:2]','created_at':1000}})
 with sqlite3.connect(pcpath) as db:timer=db.execute('SELECT id FROM schedules').fetchone()[0]
 pc['set_proactive_enabled']('aion',False);claimed=await pc['claim_proactive_timer'](timer);assert claimed
 emit('DM-C04','PRO-F01','counterexample','禁用后已有timer仍可领取，整套不能称正确可用增强',{'enabled':False,'claim_after_disable':True},['proactive_companionship.set_proactive_enabled','claim_proactive_timer'])
 # Original memory_library CRUD functions, real SQL and deliberately fake DTO/embedding/WS boundaries.
 lp=O/'library.db'
 if lp.exists():lp.unlink()
 with sqlite3.connect(lp) as db:db.executescript("CREATE TABLE memories(id TEXT PRIMARY KEY,content TEXT,keywords TEXT,importance REAL,created_at REAL,source_start_ts REAL,source_end_ts REAL,source_msg_id TEXT,unresolved INTEGER,evidence_summary TEXT,evidence_detail_level TEXT DEFAULT 'summary',archive_state TEXT DEFAULT 'active',compression_stage INTEGER DEFAULT 0,compression_batch_id TEXT DEFAULT '',source_memory_ids TEXT,period_kind TEXT,type TEXT,source_conv TEXT,embedding BLOB);CREATE TABLE memory_compression_batch_inputs(batch_id TEXT,store TEXT,memory_id TEXT);")
 class HttpError(Exception):
  def __init__(self,status_code,detail):self.status_code=status_code;self.detail=detail
 async def no_embedding(text):return None
 ln=dict(ns,OCCURRED='COALESCE(source_end_ts,source_start_ts,created_at)',uuid=uuid,time=time,aiosqlite=types.SimpleNamespace(Row=sqlite3.Row),get_db=lambda:AsyncDB(lp),HTTPException=HttpError,Store=Literal['main','chatroom'],MemoryWrite=types.SimpleNamespace,_broadcast=noop,get_embedding=no_embedding,struct=__import__('struct'),SUMMARY_MEMORY_TYPES={'digest','seeky_digest','seeky_compressed','daily'},LONG_TERM_MEMORY_TYPE='important',FIELDS='id,content,keywords,importance,created_at,source_start_ts,source_end_ts,source_msg_id,unresolved,evidence_summary,evidence_detail_level,archive_state,compression_stage,compression_batch_id,source_memory_ids,period_kind')
 extract('memory.py',{'memory_kind_for_type','_pack_embedding'},ln)
 extract('routes/memory_library.py',{'_table','_scope','_fields','_list','_item','_get','_related','create_memory','update_memory','delete_memory'},ln)
 body=types.SimpleNamespace(content='合成原子记忆',memory_kind='long_term',keywords='合成',importance=.5,unresolved=False,evidence_summary='',date=None)
 created=await ln['create_memory']('main',body);mid=created['id']
 with sqlite3.connect(lp) as db:row=db.execute('SELECT content,source_msg_id FROM memories WHERE id=?',(mid,)).fetchone();db.execute('UPDATE memories SET embedding=? WHERE id=?',(b'old-vector',mid))
 assert row[0]=='合成原子记忆'
 emit('DM-P09','MEM-F01','positive','原memory_library创建与读取合成原子记录',{'stored':row[0],'source_selection':row[1],'limits':'手动CRUD路径，非自动_digest；DTO/embedding/WS边界假实现'},['routes.memory_library.create_memory','_get'])
 body.content='合成更正后的事实';await ln['update_memory']('main',mid,body)
 with sqlite3.connect(lp) as db:row=db.execute('SELECT content,embedding FROM memories WHERE id=?',(mid,)).fetchone()
 assert row[0]=='合成更正后的事实' and row[1] is None
 emit('DM-P10','MEM-F01','positive','更正内容且embedding失败时不挂旧向量',{'content':row[0],'embedding':row[1]},['routes.memory_library.update_memory'])
 with sqlite3.connect(lp) as db:db.execute("INSERT INTO memories(id,content,created_at,type,source_memory_ids,compression_stage,compression_batch_id) VALUES('child','合成派生仍保留原事实',1000,'daily',?,1,'b1')",(json.dumps([mid]),));db.execute('INSERT INTO memory_compression_batch_inputs VALUES(?,?,?)',('b1','main',mid))
 try:await ln['delete_memory']('main',mid)
 except HttpError as e:assert e.status_code==409
 else:raise AssertionError('Expected related-delete confirmation')
 emit('DM-N09','MEM-F01','negative_blocked','有关联派生时不确认则409',{'status_code':409},['routes.memory_library.delete_memory','_related'])
 await ln['delete_memory']('main',mid,True)
 with sqlite3.connect(lp) as db:parent=db.execute('SELECT COUNT(*) FROM memories WHERE id=?',(mid,)).fetchone()[0];child=db.execute("SELECT content,source_memory_ids FROM memories WHERE id='child'").fetchone()
 assert parent==0 and child[0]=='合成派生仍保留原事实' and child[1]=='[]'
 emit('DM-C05','MEM-F01','counterexample','确认删记录会去父引用但保留派生正文，不等于忘记事实',{'parent_rows':parent,'child_content_remains':True,'child_sources':child[1],'limits':'这是源码和UI声明的删除语义，不冒称意外bug'},['routes.memory_library.delete_memory'])
asyncio.run(main())
# Attach current source hashes per observation; loaded AST symbols are not all necessarily exercised branches.
policy_ast=ast.parse((R/'user_profile_policy.py').read_text())
policy_targets={n.name:{'path':str(R/'user_profile_policy.py'),'sha256':hashlib.sha256((R/'user_profile_policy.py').read_bytes()).hexdigest(),'symbol':n.name,'start':n.lineno,'end':n.end_lineno} for n in policy_ast.body if isinstance(n,ast.FunctionDef)}
for observation in results:
 refs={}
 for label in observation['real_source_targets']:
  symbol=label.split('.')[-1]
  candidates=([policy_targets[symbol]] if label.startswith('user_profile_policy.') and symbol in policy_targets else [e for e in loaded if e['symbol']==symbol])
  for e in candidates:refs[(e['path'],e['symbol'])]=e
 observation['source_evidence']=list(refs.values())
 assert observation['source_evidence'],observation['test_id']
(O/'results.json').write_text(json.dumps({'date':'2026-10-14','scope':'Actual AST-extracted current source bodies with original SQLite SQL; stdlib async SQLite shim; model/config/notify are deterministic boundaries. No source top-level import, credentials, network, model or device. Fresh subprocess reads synthetic SQLite, not a running FastAPI/AIRI app.','observations':results,'counts':dict(Counter(x['kind'] for x in results))},ensure_ascii=False,indent=2))
(O/'executed-targets.json').write_text(json.dumps(loaded,ensure_ascii=False,indent=2))
print(json.dumps({'observations':len(results),'counts':dict(Counter(x['kind'] for x in results)),'ids':[r['test_id'] for r in results]},ensure_ascii=False))
