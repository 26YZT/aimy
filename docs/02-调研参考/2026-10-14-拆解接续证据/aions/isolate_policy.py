import ast,json,math,re,time,uuid,asyncio,sqlite3,types,copy
from pathlib import Path
ROOT=Path('/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat')
OUT=Path('/tmp/aimy-20261014-aions-audit')
policy={}
exec(compile((ROOT/'user_profile_policy.py').read_text(),str(ROOT/'user_profile_policy.py'),'exec'),policy)
ns=dict(policy,uuid=uuid,KEY_RE=re.compile(r'^[a-zA-Z0-9_.-]{1,100}$'),_profile_user_name=lambda:'Synthetic User')
tree=ast.parse((ROOT/'post_sentinel.py').read_text())
names={'_entry','_profile_refs','_apply_analysis'}
nodes=[n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name in names]
exec(compile(ast.Module(body=nodes,type_ignores=[]),str(ROOT/'post_sentinel.py'),'exec'),ns)
base={'version':2,'entries':{'f':{'key':'f','category':'profile','topic':'likes','content':'new fact','source_ts':200,'sources':['private:u2'],'deleted':False,'kind':'context','status':'active'}}}
old=copy.deepcopy(base)
changed=ns['_apply_analysis'](old,{'updates':[{'ref':'P1','category':'profile','topic':'likes','content':'older fact','sources':['U1']}]},{'U1':'private:u1'},{'source_ts':100,'_source_times':{'U1':100}})
print(json.dumps({'check':'post_sentinel_old_confirmation_rejected','real_source_executed':sorted(names),'changed':changed,'retained_content':old['entries']['f']['content']}))
deleted=copy.deepcopy(base);deleted['entries']['f']['deleted']=True
changed=ns['_apply_analysis'](deleted,{'updates':[{'ref':'P1','category':'profile','topic':'likes','content':'resurrect fact','sources':['U1']}]},{'U1':'private:u3'},{'source_ts':300,'_source_times':{'U1':300}})
print(json.dumps({'check':'post_sentinel_deleted_entry_rejected','changed':changed,'deleted':deleted['entries']['f']['deleted']}))
print(json.dumps({'check':'overdue_task_not_completed','real_source_executed':'user_profile_policy.lifecycle','status':policy['lifecycle']({'kind':'task','category':'recent','status':'active','due_at':100,'source_ts':1},200)}))
# Final-transaction epoch guard of real run_pending_once, with deterministic model and source boundaries.
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
 async def __aexit__(self,*a):self.db.close()
 async def execute(self,*a):return Cursor(self.db.execute(*a))
 async def commit(self):self.db.commit()
P=OUT/'epoch-synthetic.db'
if P.exists():P.unlink()
with sqlite3.connect(P) as db:
 db.executescript('CREATE TABLE post_sentinel_document(id INTEGER PRIMARY KEY,payload TEXT,revision INTEGER,epoch INTEGER,updated_at REAL,last_checked_at REAL,last_error TEXT);CREATE TABLE post_sentinel_jobs(source_id TEXT PRIMARY KEY,scope TEXT,parent_id TEXT,message_id TEXT,source_ts REAL,content TEXT,status TEXT,epoch INTEGER,error TEXT,attempts INTEGER,next_attempt_at REAL,model_output TEXT);')
 db.execute('INSERT INTO post_sentinel_document VALUES(1,?,0,0,0,0,\'\')',(json.dumps({'entries':{}}),))
 db.execute("INSERT INTO post_sentinel_jobs VALUES('private:u1','private','c1','u1',100,'synthetic','pending',0,'',0,0,'')")
async def context(job):return ([{'speaker':'user','text':'synthetic'}],{'U1':'private:u1'})
async def call(prompt):
 with sqlite3.connect(P) as db:db.execute('UPDATE post_sentinel_document SET epoch=epoch+1')
 return {'updates':[]}
def apply(doc,*a):doc['entries']['candidate']={'content':'would be stale'};return True
async def notify():pass
rns={'asyncio':asyncio,'time':time,'json':json,'aiosqlite':types.SimpleNamespace(Row=sqlite3.Row),'get_db':lambda:AsyncDB(P),'enabled':lambda:True,
 '_context_for_job':context,'_analysis_prompt':lambda *a:'synthetic','_call_model':call,'_apply_analysis':apply,'_notify_changed':notify,
 'log':types.SimpleNamespace(warning=lambda *a:None)}
selected=[n for n in tree.body if isinstance(n,ast.AsyncFunctionDef) and n.name in {'_read','run_pending_once'}]
exec(compile(ast.Module(body=selected,type_ignores=[]),str(ROOT/'post_sentinel.py'),'exec'),rns)
asyncio.run(rns['run_pending_once']())
with sqlite3.connect(P) as db:
 payload,epoch=db.execute('SELECT payload,epoch FROM post_sentinel_document').fetchone()
 status=db.execute('SELECT status FROM post_sentinel_jobs').fetchone()[0]
print(json.dumps({'check':'post_sentinel_epoch_changes_during_model','real_source_executed':['_read','run_pending_once'],'epoch':epoch,'job_status':status,'payload':json.loads(payload),'limits':'Model, source collection and fact application stubbed; real final SQLite transaction executed.'}))
