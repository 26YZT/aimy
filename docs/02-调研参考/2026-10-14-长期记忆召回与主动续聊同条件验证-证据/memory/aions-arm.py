"""Frozen LM fixtures -> original AionsHome task/SQL/manual leaves; no app imports.
Writes only /tmp/aimy-20261014-memory-ab-lm; model/config/notifications are fake.
"""
import ast,asyncio,copy,hashlib,json,logging,math,os,re,sqlite3,subprocess,sys,time,types,uuid
from pathlib import Path
from datetime import datetime
O=Path('/tmp/aimy-20261014-memory-ab-lm')
R=Path('/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat')
FP=Path('/tmp/aimy-20261014-memory-ab/fixtures.json')
EXPECTED='61b8c0b87067f9d349876f11217adcb82d321df795ddfec6e330e0f9caa14b61'
assert hashlib.sha256(FP.read_bytes()).hexdigest()==EXPECTED,'frozen input changed'
F=json.loads(FP.read_text());BASE=F['clock_epoch']
os.environ['TZ']=F['timezone'];time.tzset()
loaded=[]
class Clock:
 def __init__(self):self.now=BASE
 def time(self):return self.now
class Cursor:
 def __init__(self,c):self.c=c
 async def fetchone(self):return self.c.fetchone()
 async def fetchall(self):return self.c.fetchall()
class AsyncDB:
 """Only async protocol shim, actual sqlite3 SQL/transactions/files."""
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
async def noop(*a,**k):pass
def extract(names,ns):
 p=R/'post_sentinel.py';tree=ast.parse(p.read_text());nodes=[n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef)) and n.name in names]
 assert len(nodes)==len(names)
 for n in nodes:loaded.append({'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'symbol':n.name,'start':n.lineno,'end':n.end_lineno,'scope':'original AST class/function body, unchanged'})
 future=ast.ImportFrom('__future__',[ast.alias('annotations')],0);future.lineno=1;future.col_offset=0
 exec(compile(ast.fix_missing_locations(ast.Module([future]+nodes,[])),str(p),'exec'),ns)
class Runner:
 def __init__(self,p,initialize=True):
  self.p=Path(p);self.clock=Clock();self.calls=[];self.before_model=None;self.response={'updates':[],'state':None}
  policy={};p0=R/'user_profile_policy.py';exec(compile(p0.read_text(),str(p0),'exec'),policy);policy['time']=self.clock
  loaded.append({'path':str(p0),'sha256':hashlib.sha256(p0.read_bytes()).hexdigest(),'symbol':'whole pure policy module','start':1,'end':len(p0.read_text().splitlines()),'scope':'original pure module, time boundary replaced after loading'})
  self.ns=dict(policy,asyncio=asyncio,uuid=uuid,json=json,math=math,re=re,time=self.clock,datetime=datetime,aiosqlite=types.SimpleNamespace(Row=sqlite3.Row),get_db=lambda:AsyncDB(self.p),load_worldbook=lambda:{'user_name':'用户'},get_sentinel_config=lambda:{'model':F['model']},enabled=lambda:True,_notify_changed=noop,KEY_RE=re.compile(r'^[a-zA-Z0-9_.-]{1,100}$'),_wake=None,log=logging.getLogger('controlled-LM'))
  extract({'_Analysis','_profile_user_name','ensure_schema','_read','snapshot','_entry','_check_budget','save_manual','invalidate_pending','enqueue_event','_context_for_job','_analysis_prompt','_profile_refs','_apply_analysis','run_pending_once','build_context'},self.ns)
  async def model(prompt):
   self.calls.append({'at':self.clock.now,'fixed_return':copy.deepcopy(self.response),'prompt_chars':len(prompt)})
   await asyncio.sleep(0)
   if self.before_model:
    action=self.before_model;self.before_model=None;await action()
   return self.ns['_Analysis'](copy.deepcopy(self.response))
  self.ns['_call_model']=model
  if initialize:
   self.p.parent.mkdir(parents=True,exist_ok=True)
   if self.p.exists():self.p.unlink()
   with sqlite3.connect(self.p) as db:db.executescript('CREATE TABLE messages(id TEXT PRIMARY KEY,conv_id TEXT,role TEXT,content TEXT,created_at REAL);CREATE TABLE chatroom_messages(id TEXT PRIMARY KEY,room_id TEXT,sender TEXT,content TEXT,created_at REAL);')
 async def setup(self,case):
  await self.ns['ensure_schema']()
  with sqlite3.connect(self.p) as db:
   for m in case['messages']:db.execute('INSERT INTO messages VALUES(?,?,?,?,?)',(m['id'],'fixture-session','user',m['text'],BASE+m['turn']-1))
 async def enqueue(self,m):
  await self.ns['enqueue_event']({'type':'msg_created','data':{'id':m['id'],'conv_id':'fixture-session','role':'user','content':m['text'],'created_at':BASE+m['turn']-1}})
 def response_for(self,candidate,ref=None):
  value={'category':'profile',**copy.deepcopy(candidate)}
  if ref:value['ref']=ref
  self.response={'updates':[value],'state':None}
 async def run(self):return await self.ns['run_pending_once']()
 def document(self):
  with sqlite3.connect(self.p) as db:
   db.row_factory=sqlite3.Row;row=dict(db.execute('SELECT * FROM post_sentinel_document').fetchone());row['document']=json.loads(row.pop('payload'));return row
 def jobs(self):
  with sqlite3.connect(self.p) as db:db.row_factory=sqlite3.Row;return [dict(r) for r in db.execute('SELECT * FROM post_sentinel_jobs ORDER BY source_ts')]
 async def state(self):
  snap=await self.ns['snapshot']();return {'snapshot':snap,'document_row':self.document(),'jobs':self.jobs(),'native_context':await self.ns['build_context'](now=self.clock.now),'clock':self.clock.now}
 async def manual_baseline(self,candidate):
  snap=await self.ns['snapshot']()
  return await self.ns['save_manual']({'entries':[{'key':'fixture.fact','category':'profile','topic':candidate['topic'],'content':candidate['content']}],'current_state':None},snap['revision'])
 async def delete_all_single_fact(self):
  snap=await self.ns['snapshot']();return await self.ns['save_manual']({'entries':[],'current_state':None},snap['revision'])

async def restore(p):
 x=Runner(p,False);s=await x.state();return {'pid':os.getpid(),'database':str(x.p),'seeded_or_written_in_child':False,'model_calls':len(x.calls),'state':s}
if len(sys.argv)>1 and sys.argv[1]=='--restore':
 print(json.dumps(asyncio.run(restore(sys.argv[2])),ensure_ascii=False));sys.exit(0)

async def main():
 results=[]
 async def automatic_source_probe(case,renamed):
  """A separate leaf replay validates identical *persisted* source lineage.
  No job resurrection or after-delete SQL commit is invented by this probe.
  """
  z=Runner(O/'synthetic'/f'{case["id"]}-source-probe.sqlite');await z.setup(case);await z.enqueue(case['messages'][0]);z.response_for(case['fixed_candidates'][0]);await z.run()
  auto_before=await z.state();delete_receipt=await z.delete_all_single_fact();doc=z.document()['document'];tombstones=copy.deepcopy(doc['entries']);job=z.jobs()[0];messages,sources=await z.ns['_context_for_job'](job)
  item={'category':'profile',**copy.deepcopy(case['fixed_candidates'][1 if renamed else 0])}
  if not renamed:item['ref']='P1'
  changed=z.ns['_apply_analysis'](doc,{'updates':[item],'state':None},sources,job)
  return {'layer':'native task baseline + native manual delete + original pure _apply_analysis replay; no after-delete SQL commit or native job requeue','auto_before':auto_before,'delete_receipt':delete_receipt,'deleted_entry_sources':{k:v.get('sources') for k,v in tombstones.items()},'native_context_sources':sources,'replayed_candidate':item,'changed':changed,'raw_replayed_document':doc,'active_after_pure_replay':[v for v in doc['entries'].values() if not v.get('deleted')],'model_calls_for_auto_baseline':z.calls,'persisted_after_probe':await z.state()}
 for case in F['memory_cases']:
  cid=case['id'];x=Runner(O/'synthetic'/f'{cid}.sqlite');await x.setup(case);cand=case['fixed_candidates'];trace=[];observed={};outcome='inconclusive'
  if cid=='LM01':
   await x.enqueue(case['messages'][0]);x.response_for(cand[0]);await x.run();observed['before_restart']=await x.state()
   child=subprocess.run([sys.executable,'-B',str(Path(__file__)),'--restore',str(x.p)],check=True,capture_output=True,text=True);restored=json.loads(child.stdout);assert restored['pid']!=os.getpid();observed['fresh_os_process']=restored
   outcome='pass' if [e['content'] for e in restored['state']['snapshot']['entries']]==[cand[0]['content']] else 'fail'
   trace=['original ensure_schema/enqueue_event/run_pending_once/_apply_analysis SQL commit','new Python OS process, same synthetic SQLite, original snapshot/build_context; no child writes']
  elif cid=='LM02':
   m=case['messages'][0];await x.enqueue(m);x.response_for(cand[0]);await x.run();observed['first']=await x.state();await x.enqueue(m);observed['duplicate_job_processed']=await x.run()
   doc=x.document()['document'];job={'source_ts':BASE,'_source_times':{'U1':BASE}};observed['original_repeated_apply_changed']=x.ns['_apply_analysis'](doc,copy.deepcopy(x.response),{'U1':'private:U1'},job);observed['repeated_apply_document']=doc
   observed['final']=await x.state();outcome='pass' if len(observed['final']['snapshot']['entries'])==1 and len([v for v in doc['entries'].values() if not v.get('deleted')])==1 else 'fail'
   trace=['same fixture message ID enqueued twice through native INSERT OR IGNORE','same candidate applied twice with original _apply_analysis, no extra dedupe added']
  elif cid=='LM03':
   for m,c in zip(case['messages'],cand):await x.enqueue(m);x.response_for(c);await x.run();trace.append(await x.state())
   observed['states_in_input_order']=trace;observed['final']=await x.state();outcome='pass' if [e['content'] for e in observed['final']['snapshot']['entries']]==[cand[-1]['content']] else 'fail'
  elif cid=='LM04':
   for i in [1,0]:await x.enqueue(case['messages'][i]);x.response_for(cand[i]);await x.run();trace.append(await x.state())
   observed['states_new_then_old']=trace;observed['final']=await x.state();outcome='pass' if [e['content'] for e in observed['final']['snapshot']['entries']]==[cand[-1]['content']] else 'fail'
  elif cid in ['LM05','LM06','LM09','LM10']:
   m=case['messages'][0];await x.enqueue(m);x.response_for(cand[0])
   if cid=='LM06':
    async def edit():
     with sqlite3.connect(x.p) as db:db.execute('UPDATE messages SET content=? WHERE id=?',(m['text']+'（已编辑）',m['id']))
    x.before_model=edit
   await x.run();observed['final']=await x.state();contents=[e['content'] for e in observed['final']['snapshot']['entries']]
   if cid=='LM05':outcome='pass' if not contents else 'fail'
   elif cid=='LM06':outcome='pass' if not contents and observed['final']['jobs'][0]['status']=='skipped' else 'fail'
   elif cid=='LM09':outcome='fail' if cand[0]['content'] in contents else 'pass'
   else:
    observed['fixed_candidate_characters']=len(cand[0]['content']);observed['native_context_characters']=len(observed['final']['native_context'])
    snap=await x.ns['snapshot']()
    try:await x.ns['save_manual']({'entries':[{'key':'long.manual','category':'profile','topic':cand[0]['topic'],'content':cand[0]['content']}]},snap['revision']);observed['manual_original_validation']={'accepted':True}
    except ValueError as e:observed['manual_original_validation']={'accepted':False,'type':type(e).__name__,'error':str(e)}
    outcome='pass' if len(observed['final']['native_context'])<=F['context_char_budget'] and not contents and observed['final']['jobs'][0]['error'] else 'fail'
   trace=['original queued task consumes fixed _call_model result','LM06 real SQL body edit occurs while original run_pending_once awaits fake model'] if cid=='LM06' else ['original queued task consumes fixed _call_model result']
  elif cid=='LM07':
   # One identical current fact established via the real manual API, not direct DB patch.
   await x.enqueue(case['messages'][0]);observed['baseline_manual']=await x.manual_baseline(cand[0]);x.response_for(cand[0],'P1')
   async def delete_during_await():observed['manual_delete_receipt']=await x.delete_all_single_fact()
   x.before_model=delete_during_await;await x.run();observed['after_first_await']=await x.state()
   x.clock.now=BASE+31;observed['native_retry_processed']=await x.run();observed['after_native_retry']=await x.state()
   observed['automatic_same_source_leaf_probe']=await automatic_source_probe(case,False)
   outcome='pass' if not observed['after_first_await']['snapshot']['entries'] and not observed['after_native_retry']['snapshot']['entries'] and not observed['automatic_same_source_leaf_probe']['active_after_pure_replay'] else 'fail'
   trace=['native save_manual baseline key fixture.fact, source_ts same fixed initial clock','same candidate gets native existing-ref P1 field mapping','native manual delete during fake model await changes revision; original task requeues','advance logical clock +31s beyond native 30s retry; original deleted-ref check refuses restoration']
  elif cid=='LM08':
   await x.enqueue(case['messages'][0]);observed['baseline_manual']=await x.manual_baseline(cand[0]);observed['manual_delete_receipt']=await x.delete_all_single_fact();x.response_for(cand[1]);await x.run();observed['final']=await x.state()
   observed['automatic_same_source_leaf_probe']=await automatic_source_probe(case,True)
   outcome='fail' if any(e['content']==cand[1]['content'] for e in observed['final']['snapshot']['entries']) or observed['automatic_same_source_leaf_probe']['active_after_pure_replay'] else 'pass'
   trace=['same single current fact via native manual API','native manual delete before pending job model call; no source or epoch invalidation added','fixed second candidate same content/source but renamed topic, no existing ref']
  results.append({'case_id':cid,'arm':'AionsHome.post_sentinel','contract':case['contract'],'contract_outcome':outcome,'observed':observed,'model_calls':x.calls,'native_sequence':trace,'true_code':['post_sentinel AST original functions and original SQL','user_profile_policy original module','sqlite3 file/transactions; asyncio await'],'fake_boundaries':['fixed model output, not original _call_model or a model/API request','synthetic user_name 用户/config/notification sink','async protocol adapter over sqlite3; not third-party aiosqlite library'],'field_mapping':{'candidate':'unchanged topic/content/sources + native category=profile; state=null','source_IDs':'fixture U labels to original private:<message-id> through native _context_for_job','message_timestamps':'clock_epoch + turn - 1 seconds','manual_initial_state_for_LM07_08':'real save_manual, key fixture.fact, identical candidate content/topic; sources manual as native API requires','LM07_ref':'P1 determined by one native existing fact; no content changes','LM06_edit':'same fixture message text plus （已编辑） in synthetic messages table'},'limitations':['not full FastAPI/observer startup or native aiosqlite concurrency','exact literal topic matching only, no tested semantic equivalence','fixed erroneous model output only tests deterministic defenses; no extraction quality measurement','LM01 fresh Python process restores this SQLite document, not AIRI or whole application restore']})
  print(cid,outcome,flush=True)
 (O/'aions-results.json').write_text(json.dumps({'fixture_sha256':EXPECTED,'initial_clock':F['clock_iso'],'runtime':sys.version,'cases':results},ensure_ascii=False,indent=2))
 unique={(r['path'],r['symbol']):r for r in loaded};(O/'aions-manifest.json').write_text(json.dumps(list(unique.values()),ensure_ascii=False,indent=2))
 assert hashlib.sha256(FP.read_bytes()).hexdigest()==EXPECTED
asyncio.run(main())
