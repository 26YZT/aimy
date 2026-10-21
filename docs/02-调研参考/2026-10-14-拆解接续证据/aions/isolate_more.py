"""Execute current source AST orchestration, stubbing only side-effect boundaries."""
import ast,asyncio,contextvars,json,math,time
from pathlib import Path
ROOT=Path('/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat')
state={'enabled':True}; saved=[];events=[]; calls=[]
async def config(actor):return {'enabled':state['enabled'],'next_wake_at':1,'actions':{'private_chat':True}}
async def latest():return 1
async def no_refresh(*a,**k):return False
async def claim(*a,**k):return {'next_wake_at':1}
async def capture(*a,**k):return None
async def no_op(*a,**k):pass
async def niche(*a,**k):return []
async def model(actor,instruction):
 state['enabled']=False
 calls.append({'phase':'model-return','enabled':state['enabled']})
 return {'action':'private_chat','reason':'synthetic','message':'synthetic stale autonomous reply'}
async def save(actor,text):
 saved.append({'actor':actor,'text':text,'enabled_at_save':state['enabled']})
 return {'id':'synthetic-message','content':text}
async def event(*a,**k):
 events.append({'action':a[1]})
 return {'id':'event'}
ns={'asyncio':asyncio,'time':time,'json':json,'ACTOR_IDS':('aion','connor'),'ACTION_DEFS':{'private_chat':'主动说话'},
 'get_actor_config':config,'_latest_user_message_ts':latest,'refresh_actor_wake_for_user':no_refresh,'claim_due_wake':claim,
 '_capture_autonomy_monitor_context':capture,'_save_autonomy_monitor_card':no_op,
 '_AUTONOMY_WAKE_MONITOR_CONTEXT':contextvars.ContextVar('synthetic_monitor'),'_AUTONOMY_WAKE_INTERNAL':contextvars.ContextVar('synthetic_wake'),
 'schedule_actor_wake':no_op,'append_idle_event':event,'_actor_label':lambda a:a,'recent_niche_index':niche,'_idle_duration_text':lambda m:str(m),
 '_ask_actor_json':model,'_save_private_message':save}
tree=ast.parse((ROOT/'autonomy.py').read_text())
names={'IdleAutonomyManager','_run_actor_once','_select_action','_run_private_chat'}
nodes=[n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef)) and n.name in names]
assert len(nodes)==len(names)
exec(compile(ast.Module(body=nodes,type_ignores=[]),str(ROOT/'autonomy.py'),'exec'),ns)
async def run():
 manager=ns['IdleAutonomyManager']()
 result=await manager.run_actor_once('aion')
 print(json.dumps({'check':'autonomy_disable_during_action_selection','real_source_executed':sorted(names),'result_ok':result['ok'],'saved_messages':saved,'limits':'Config, camera, model, and persistence are deterministic boundary stubs. No service or device was started.'}))
asyncio.run(run())
# The actual dimension mismatch branch is a deterministic leaf and needs no provider.
tree=ast.parse((ROOT/'memory.py').read_text())
node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='cosine_similarity')
leaf={'math':math}
exec(compile(ast.Module(body=[node],type_ignores=[]),str(ROOT/'memory.py'),'exec'),leaf)
print(json.dumps({'check':'embedding_dimension_mismatch','real_source_executed':'memory.cosine_similarity','value':leaf['cosine_similarity']([1.0,2.0],[1.0])}))
