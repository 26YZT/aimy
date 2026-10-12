"""Read-only stdlib checks; execute selected already-reviewed methods with stubs.
Never imports the repository or executes any repository module top-level code.
"""
import ast, asyncio, copy, datetime, json, pathlib, queue, threading, types
from concurrent.futures import ThreadPoolExecutor
R=pathlib.Path('/Users/mima1234/Documents/资料/kirara-ai-master')
class Log:
    def __getattr__(self, k): return lambda *a,**kw: None
logger=Log()
def extract(rel, cls, methods, env):
    tree=ast.parse((R/rel).read_text())
    node=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name==cls)
    defs=[copy.deepcopy(n) for n in node.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name in methods]
    for d in defs: d.decorator_list=[]
    module=ast.Module(body=[ast.ImportFrom(module='__future__',names=[ast.alias(name='annotations')],level=0)]+defs,type_ignores=[])
    ast.fix_missing_locations(module)
    ns=dict(env);exec(compile(module,str(R/rel),'exec'),ns)
    return {d.name:ns[d.name] for d in defs}
results={}
# Query isolation and cold clear: exact reviewed methods with fake persistence/scope.
m=extract('kirara_ai/memory/memory_manager.py','MemoryManager',['query','clear_memory'],{})
S=types.SimpleNamespace
entry_a=S(sender='same-user',timestamp=1,content='workflow-A-secret')
entry_b=S(sender='same-user',timestamp=2,content='workflow-B-secret')
scope=S(get_scope_key=lambda sender:'c2c:same-user',is_in_scope=lambda a,b:a==b)
persisted={'A-c2c:same-user':[entry_a],'B-c2c:same-user':[entry_b],'c2c:same-user':[entry_a]}
obj=S(memories={'A-c2c:same-user':[entry_a],'B-c2c:same-user':[entry_b]},persistence=S(load=lambda k:persisted.get(k,[])))
actual=m['query'](obj,scope,'same-user','A')
results['memory_namespace_leak']={'requested':'A','returned':[e.content for e in actual],'reproduced':actual==[entry_a,entry_b]}
obj2=S(memories={},persistence=S(save=lambda k,v:persisted.__setitem__(k,v)),_remove_media_references=lambda *args:None)
m['clear_memory'](obj2,scope,'same-user')
results['cold_clear_keeps_disk_memory']={'reproduced':bool(persisted['c2c:same-user'])}
# Shutdown queue drain: first fake disk save blocked while second is queued.
methods=extract('kirara_ai/memory/persistences/base.py','AsyncMemoryPersistence',['__init__','_worker','save','stop'],{'threading':threading,'Queue':queue.Queue,'Empty':queue.Empty,'logger':logger})
P=type('ExtractedAsyncMemoryPersistence',(),methods)
started=threading.Event(); release=threading.Event(); writes=[]
def save(key, entries):
    if key=='first': started.set(); assert release.wait(2)
    writes.append(key)
p=P(S(save=save,flush=lambda:None));p.save('first',[]);assert started.wait(2);p.save('final-chat',[])
stopping=threading.Thread(target=p.stop);stopping.start()
# stop() sets running=False synchronously before waiting on the worker.
assert not p.running
release.set();stopping.join(2);assert not stopping.is_alive()
results['shutdown_loses_queued_final_chat']={'writes':writes,'pending':p.queue.qsize(),'reproduced':writes==['first'] and p.queue.qsize()==1}
# Conditional/loop methods pass keyword arguments to run_in_executor.
e=extract('kirara_ai/workflow/core/execution/executor.py','WorkflowExecutor',['_execute_conditional_branch','_execute_loop'],{})
async def check_executor():
    o=S(logger=logger,_gather_inputs=lambda b:{'value':1},results={},execution_graph={})
    b=S(name='example',execute=lambda **kwargs:{'condition_result':False,'should_continue':False})
    out={}
    with ThreadPoolExecutor() as pool:
        for key in e:
            try: await e[key](o,b,pool,asyncio.get_running_loop())
            except TypeError as ex:out[key]=str(ex)
    return out
results['branch_loop_keyword_failure']=asyncio.run(check_executor())
# OpenAI adapter sends auto even if the workflow final iteration requested none.
captured={}
class Response:
    def raise_for_status(self): pass
    def json(self): return {'choices':[{'message':{'content':'stub response','role':'assistant'},'finish_reason':'stop'}],'usage':{}}
async def convert(*a):return []
def post(*a,**kw):captured.update(kw['json']);return Response()
env={'asyncio':asyncio,'requests':S(post=post),'logger':logger,'convert_llm_chat_message_to_openai_message':convert,'convert_tools_to_openai_format':lambda t:[],'LLMChatTextContent':lambda **k:S(**k),'LLMChatResponse':lambda **k:S(**k),'Message':lambda **k:S(**k),'Usage':lambda **k:S(**k),'pick_tool_calls':lambda c:[]}
chat=extract('kirara_ai/plugins/llm_preset_adapters/openai_adapter.py','OpenAIAdapterChatBase',['chat'],env)['chat']
req=S(messages=[],model='stub',frequency_penalty=None,max_tokens=None,presence_penalty=None,response_format=None,stop=None,stream=False,stream_options=None,temperature=None,top_p=None,tools=[object()],tool_choice='none',logprobs=None,top_logprobs=None)
chat(S(config=S(api_base='https://unused.invalid',api_key='unused'),media_manager=None),req)
results['tool_choice_cap_ignored']={'requested':req.tool_choice,'sent':captured['tool_choice'],'reproduced':captured['tool_choice']=='auto'}
# Static invariants on HTTP request terminal state and embedding payload keys.
http_tree=ast.parse((R/'kirara_ai/plugins/im_http_legacy_adapter/adapter.py').read_text())
assignments=[(n.lineno,ast.unparse(n)) for n in ast.walk(http_tree) if isinstance(n,(ast.Assign,ast.AnnAssign,ast.AugAssign)) and any(isinstance(x,ast.Attribute) and x.attr=='done' for x in ast.walk(n))]
results['http_v2_done_assignments']=assignments
out=pathlib.Path('/tmp/aimy-four-projects-20261010/kirara-directed-results.json')
out.write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
print(out.read_text())
