"""Execute selected AST function bodies only, with stdlib SQLite and synthetic data.
No project imports, source top-level execution, network, real data, or configuration.
"""
import ast,asyncio,copy,json,logging,re,sqlite3,time,types
from pathlib import Path
from datetime import datetime
ROOT=Path('/Users/mima1234/Documents/资料/AionsHome-main/aion-chat')
OUT=Path('/tmp/aimy-four-projects-20261010')
DB_PATH=OUT/'aions-synthetic.db'
if DB_PATH.exists(): DB_PATH.unlink()
class Cursor:
 def __init__(self,c):self.c=c
 @property
 def rowcount(self):return self.c.rowcount
 async def fetchone(self):return self.c.fetchone()
 async def fetchall(self):return self.c.fetchall()
class AsyncDB:
 def __init__(self,path):self.db=sqlite3.connect(path)
 @property
 def row_factory(self):return self.db.row_factory
 @row_factory.setter
 def row_factory(self,v):self.db.row_factory=v
 async def __aenter__(self):return self
 async def __aexit__(self,*args):self.db.close()
 async def execute(self,*args):return Cursor(self.db.execute(*args))
 async def commit(self):self.db.commit()
def extract(path,names,ns):
 tree=ast.parse((ROOT/path).read_text(encoding='utf-8'))
 nodes=[]
 for node in tree.body:
  if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef)) and node.name in names:
   if hasattr(node,'decorator_list'):node.decorator_list=[]
   nodes.append(node)
 assert len(nodes)==len(names),(path,names,[n.name for n in nodes])
 exec(compile(ast.Module(body=nodes,type_ignores=[]),str(ROOT/path),'exec'),ns)
 return ns
class Manager:
 async def broadcast(self,event):pass
async def append_sync(db,event):return 1
base=dict(asyncio=asyncio,copy=copy,json=json,logging=logging,re=re,time=time,datetime=datetime,
          aiosqlite=types.SimpleNamespace(connect=AsyncDB,Row=sqlite3.Row),DB_PATH=DB_PATH,
          get_db=lambda:AsyncDB(DB_PATH),manager=Manager(),append_sync_event=append_sync,
          attach_sync_seq=lambda e,s:e)
with sqlite3.connect(DB_PATH) as db:
 db.executescript('''CREATE TABLE schedules(id TEXT PRIMARY KEY,type TEXT,trigger_at TEXT,content TEXT,created_at REAL,status TEXT,origin TEXT,origin_room_id TEXT);
 CREATE TABLE messages(id TEXT PRIMARY KEY,role TEXT,content TEXT,created_at REAL);
 CREATE TABLE chatroom_rooms(id TEXT PRIMARY KEY,type TEXT);
 CREATE TABLE chatroom_messages(id TEXT PRIMARY KEY,room_id TEXT,sender TEXT,content TEXT,created_at REAL);
 CREATE TABLE memories(id TEXT PRIMARY KEY,content TEXT,source_memory_ids TEXT);
 CREATE TABLE memory_compression_batch_inputs(batch_id TEXT,store TEXT,memory_id TEXT);
 INSERT INTO chatroom_rooms VALUES('private-connor','connor_1v1');
 INSERT INTO chatroom_messages VALUES('secret-connor','private-connor','user','SYNTHETIC PRIVATE CONNOR DATA',100);
 INSERT INTO messages VALUES('reply','assistant','See you [NEXT_CHAT:1]',100);
 INSERT INTO memories VALUES('atom','synthetic fact',NULL);
 INSERT INTO memories VALUES('summary','synthetic fact in summary','["atom"]');
 INSERT INTO memory_compression_batch_inputs VALUES('batch','main','atom');''')
pc=dict(base,SETTINGS={'proactive_companionship_aion_enabled':True},save_settings=lambda d:None,
 PROACTIVE_TYPE='proactive',NO_DECISION=object(),_NEXT_CHAT_RE=re.compile(r'[\[［]\s*NEXT_CHAT\s*[:：]\s*([^\]］]+?)\s*[\]］]',re.I),
 _SETTING_KEYS={'aion':'proactive_companionship_aion_enabled','connor':'proactive_companionship_connor_enabled'})
extract('proactive_companionship.py',{'_actor_id','is_proactive_enabled','set_proactive_enabled','extract_next_chat_decision','_message_actor','process_visible_message_event','claim_proactive_timer'},pc)
legacy=dict(base,_chatroom_sender_name=lambda sender,user,ai:sender)
extract('routes/memories.py',{'_fetch_source_rows_by_ids','delete_memory'},legacy)
async def main():
 await pc['process_visible_message_event']({'type':'msg_created','data':{'id':'reply','role':'assistant','content':'See you [NEXT_CHAT:1]','created_at':100}})
 with sqlite3.connect(DB_PATH) as db:timer_id=db.execute('SELECT id FROM schedules').fetchone()[0]
 pc['set_proactive_enabled']('aion',False)
 with sqlite3.connect(DB_PATH) as db:pending=db.execute('SELECT COUNT(*) FROM schedules').fetchone()[0]
 claimed=await pc['claim_proactive_timer'](timer_id)
 print(json.dumps({'check':'disabled_proactive_timer','enabled_after_disable':pc['is_proactive_enabled']('aion'),'pending_after_disable':pending,'claim_succeeds_after_disable':claimed}))
 rows=await legacy['_fetch_source_rows_by_ids'](['chatroom:secret-connor'],'User','MainAI')
 print(json.dumps({'check':'legacy_main_memory_source_scope','private_connor_source_returned':len(rows)==1,'source_id':rows[0]['id'] if rows else None}))
 await legacy['delete_memory']('atom')
 with sqlite3.connect(DB_PATH) as db:
  child=db.execute('SELECT source_memory_ids FROM memories WHERE id="summary"').fetchone()[0]
  batch=db.execute('SELECT COUNT(*) FROM memory_compression_batch_inputs WHERE memory_id="atom"').fetchone()[0]
 print(json.dumps({'check':'legacy_memory_delete_lineage','deleted_parent_still_referenced':child,'orphan_batch_input_count':batch}))
asyncio.run(main())

# Compression's asynchronous model boundary is replaced by a deterministic
# deletion of the selected atom; then its original transaction logic runs.
COMP_DB=OUT/'aions-compression-synthetic.db'
if COMP_DB.exists(): COMP_DB.unlink()
with sqlite3.connect(COMP_DB) as db:
 db.executescript('''
 CREATE TABLE memories(id TEXT PRIMARY KEY, content TEXT,type TEXT,created_at REAL,source_conv TEXT,embedding BLOB,keywords TEXT,importance REAL,source_start_ts REAL,source_end_ts REAL,unresolved INTEGER,source_msg_id TEXT,compression_stage INTEGER,evidence_summary TEXT,evidence_detail_level TEXT,archive_state TEXT,period_kind TEXT,period_start_ts REAL,period_end_ts REAL,compression_batch_id TEXT,source_memory_ids TEXT,archived_at REAL);
 CREATE TABLE memory_compression_batches(id TEXT PRIMARY KEY,target TEXT,level TEXT,model_key TEXT,status TEXT,period_start_ts REAL,period_end_ts REAL,input_count INTEGER,output_count INTEGER,created_at REAL,reflection TEXT,actor_name TEXT,durable_output_count INTEGER,completed_at REAL);
 CREATE TABLE memory_compression_batch_inputs(batch_id TEXT,store TEXT,memory_id TEXT);
 CREATE TABLE memory_compression_batch_outputs(batch_id TEXT,store TEXT,memory_id TEXT);
 INSERT INTO memories(id,content,archive_state) VALUES('delete-during-call','a secret fact that the user deleted','active');
 ''')
period={'label':'synthetic-day','memory_ids':['delete-during-call'],'period_start_ts':100.,'period_end_ts':200.}
async def preview(*args,**kwargs):return {'can_run':True,'periods':[period],'estimated_calls':1,'memory_count':1}
async def candidates(*args):
 with sqlite3.connect(COMP_DB) as db:
  db.row_factory=sqlite3.Row
  return [dict(r) for r in db.execute('SELECT * FROM memories')]
async def call_model(*args):
 with sqlite3.connect(COMP_DB) as db:db.execute('DELETE FROM memories WHERE id=?',('delete-during-call',))
 return {'synthetic':True}
async def empty_embedding(*args):return None
async def notify(*args):pass
comp=dict(base,get_db=lambda:AsyncDB(COMP_DB),LEVELS={'daily':{'periods_per_call':7,'output_stage':1,'output_period_kind':'day'}},
 MODELS={'synthetic-model':{}},is_model_deprecated=lambda k:False,compression_preview=preview,_candidate_rows=candidates,
 _compression_actor_context=lambda t:{'name':'Synthetic AI'},_chunks=lambda items,size:[items],
 _source_reference_map=lambda p:{'M1':'delete-during-call'},_period_prompt=lambda *a:'synthetic prompt',
 _call_compression_model=call_model,_normalize_outputs=lambda *a:({'synthetic-day':[{'content':'deleted secret fact','keywords':[],'importance':.5,'source_memory_ids':['M1']}]},[]),
 _compression_budget=lambda *a:{'max_output_count':1,'max_content_chars':1000},_content_chars=lambda contents:sum(map(len,contents)),
 _embedding_for_content=empty_embedding,_optional_reflection=lambda x:'',_notify_compression_completed=notify,
 _pack_embedding=lambda x:b'')
extract('memory_compression.py',{'_run_calendar_compression'},comp)
tree=ast.parse((ROOT/'memory_compression.py').read_text())
insert=next(n for n in tree.body if isinstance(n,ast.AsyncFunctionDef) and n.name=='_insert_output')
insert.body=[n for n in insert.body if not(isinstance(n,ast.ImportFrom) and n.module=='memory')]
exec(compile(ast.Module(body=[insert],type_ignores=[]),str(ROOT/'memory_compression.py'),'exec'),comp)
async def compression_case():
 result=await comp['_run_calendar_compression']('main','daily','synthetic-model')
 with sqlite3.connect(COMP_DB) as db:
  rows=[dict(zip(['content','archive_state','source_memory_ids'],r)) for r in db.execute('SELECT content,archive_state,source_memory_ids FROM memories')]
 print(json.dumps({'check':'delete_during_compression_model_call','compression_result_ok':result['ok'],'persisted_memories_after_deletion':rows}))
asyncio.run(compression_case())
