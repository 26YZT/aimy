"""REMAIN-KI: current-source AST bodies; real stdlib execution, explicit fake IO/DTO.
No project import, dependencies, network, source writes, user DB or devices.
"""
import ast, asyncio, copy, functools, hashlib, inspect, json, logging, re, sys, types, warnings
from pathlib import Path
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from typing import *
from abc import ABC, abstractmethod

R=Path('/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master')
O=Path('/tmp/aimy-20261014-remaining-kirara')
loaded=[]; rows=[]
def load(rel,names,env,methods=None):
 p=R/rel; tree=ast.parse(p.read_text()); nodes=[]
 for n in tree.body:
  if isinstance(n,(ast.ClassDef,ast.FunctionDef,ast.AsyncFunctionDef)) and n.name in names:
   n=copy.deepcopy(n)
   if isinstance(n,ast.ClassDef):
    if methods: n.body=[v for v in n.body if isinstance(v,(ast.FunctionDef,ast.AsyncFunctionDef)) and v.name in methods]
    for v in n.body:
     if isinstance(v,(ast.FunctionDef,ast.AsyncFunctionDef)):
      v.decorator_list=[d for d in v.decorator_list if not isinstance(d,ast.Call)]
   else: n.decorator_list=[]
   nodes.append(n);loaded.append(dict(path=str(p),symbol=n.name,start=n.lineno,end=n.end_lineno,sha256=hashlib.sha256(p.read_bytes()).hexdigest(),method_subset=methods))
 assert len(nodes)==len(names),(rel,names)
 exec(compile(ast.Module(nodes,[]),str(p),'exec'),env)

class DTO:
 """Fake Pydantic boundary: copies typed known inputs/defaults, NO validation claimed."""
 def __init__(self,**kw):
  for cls in reversed(type(self).__mro__):
   for k in getattr(cls,'__annotations__',{}):
    if hasattr(cls,k): setattr(self,k,copy.deepcopy(getattr(cls,k)))
  self.__dict__.update(kw)
 def model_dump(self):return self.__dict__
class FakeContainer:
 def __init__(self,store=None):self.store={} if store is None else store
 def resolve(self,key):return self.store[key]
 def register(self,key,val):self.store[key]=val
 def scoped(self):return FakeContainer(self.store.copy())
 def __enter__(self):return self
 def __exit__(self,*a):pass
class Events:
 def __init__(self):self.events=[]
 def post(self,e):self.events.append(type(e).__name__)
class Begin:
 def __init__(self,*a):pass
class End(Begin):pass
fakeevents=types.ModuleType('kirara_ai.events');fakeevents.WorkflowExecutionBegin=Begin;fakeevents.WorkflowExecutionEnd=End
sys.modules['kirara_ai.events']=fakeevents
L=logging.getLogger('ki-offline');L.addHandler(logging.NullHandler());L.opt=lambda **kw:L
E=dict(globals(),DependencyContainer=FakeContainer,EventBus=Events,BaseModel=DTO,Field=lambda **kw:None,get_logger=lambda *a:L,Parameter=inspect.Parameter,signature=inspect.signature)
load('kirara_ai/workflow/core/block/input_output.py',{'Input','Output'},E)
load('kirara_ai/workflow/core/block/base.py',{'Block','ConditionBlock','LoopBlock','LoopEndBlock'},E)
E['T']=TypeVar('T');E['OptionsProvider']=Callable[[FakeContainer,E['Block']],List[E['T']]]
load('kirara_ai/workflow/core/block/param.py',{'ParamMeta'},E)
load('kirara_ai/workflow/core/block/schema.py',{'BlockInput','BlockOutput','BlockConfig'},E)
load('kirara_ai/workflow/core/block/type_system.py',{'TypeSystem'},E)
load('kirara_ai/workflow/core/block/registry.py',{'extract_block_param','BlockRegistry'},E)
load('kirara_ai/workflow/core/workflow/base.py',{'WorkflowConfig','Workflow','Wire'},E)
load('kirara_ai/workflow/core/execution/exceptions.py',{'BlockExecutionFailedException','WorkflowExecutionTimeoutException'},E)
load('kirara_ai/workflow/core/execution/executor.py',{'WorkflowExecutor'},E)
load('kirara_ai/workflow/implementations/blocks/system/basic.py',{'TextBlock','TextConcatBlock','TextReplaceBlock','TextExtractByRegexBlock'},E)
globals().update({k:E[k] for k in ['Input','Output','Block','ConditionBlock','LoopBlock','BlockRegistry','Workflow','Wire','WorkflowExecutor','TextBlock','TextConcatBlock','ParamMeta','TextReplaceBlock']})
def row(id,kind,got,expected,unit):
 ok=got==expected; rows.append(dict(id=id,kind=kind,observed=got,expected=expected,assertion_passed=ok,original_unit=unit));assert ok,(id,got,expected)

def makewf(text1='你好',text2='世界'):
 a=TextBlock(text1);a.name='a';b=TextBlock(text2);b.name='b';c=TextConcatBlock();c.name='concat'
 registry=BlockRegistry()
 for klass in [TextBlock,TextConcatBlock]:registry.register(klass.__name__,'test',klass)
 wf=Workflow('same-two-strings',[a,b,c],[Wire(a,'text',c,'text1'),Wire(b,'text',c,'text2')])
 return wf,registry
async def main():
 wf,reg=makewf(); ev=Events(); ex=WorkflowExecutor(FakeContainer(),wf,reg,ev)
 result=await ex.run()
 row('KI-P01','positive',result['concat']['text'],'你好世界','WorkflowExecutor.run/_execute_normal_block + original TextBlock/TextConcatBlock')
 row('KI-P02','positive',ev.events,['Begin','End'],'WorkflowExecutor.run fake event sink')
 wf,reg=makewf();wf.blocks[0].outputs={'text':Output('text','错误类型',int,'synthetic wrong declared type')}
 try:WorkflowExecutor(FakeContainer(),wf,reg,Events());got='accepted'
 except TypeError:got='TypeError'
 row('KI-N01','rejection',got,'TypeError','_build_execution_graph / TypeSystem.is_compatible')
 # Wrong actual output with correct declared str is not checked after execution.
 wf,reg=makewf();wf.blocks[0].text=17
 ex=WorkflowExecutor(FakeContainer(),wf,reg,Events())
 try:await ex.run();got='accepted'
 except E['BlockExecutionFailedException']:got='concat-failed-after-bad-producer'
 row('KI-C01','counterexample',got,'concat-failed-after-bad-producer','_execute_normal_block: output DTO validate not called')
 row('KI-C02','counterexample',ex.results['a']['text'],17,'bad runtime value stored despite declared str')
 # Real original condition branch with kwargs reproduces old defect.
 cb=ConditionBlock(lambda ctx:True,{'value':Input('value','值',str,'值')});cb.name='condition';ex._gather_inputs=lambda b:{'value':'same'}
 try:
  with ThreadPoolExecutor() as pool:await ex._execute_conditional_branch(cb,pool,asyncio.get_running_loop())
  got='accepted'
 except TypeError as er:got='unexpected keyword argument' in str(er)
 row('KI-C03','counterexample',got,True,'_execute_conditional_branch original asyncio.run_in_executor kwargs')

 # Source metadata extraction: actual functions/type system, fake DTO serialization only.
 meta=reg.extract_block_info(TextBlock)[2]['text']
 row('KI-P03','positive',[meta.type,meta.label,meta.description,meta.required],['str','文本','要输出的文本',True],'extract_block_info/extract_block_param + TextBlock Annotated ParamMeta')
 class ConfigProbe(Block):
  def __init__(self,webSearch:Annotated[bool,ParamMeta(label='联网搜索',description='允许搜索')]=False,apiKey:Annotated[str,ParamMeta(label='API密钥',description='仅合成输入')]=''):
   pass
 configs=reg.extract_block_info(ConfigProbe)[2]
 row('KI-P04','positive',[configs['webSearch'].type,configs['webSearch'].default,configs['webSearch'].label],['bool',False,'联网搜索'],'original metadata extraction same field probe as AIRI webSearch')
 row('KI-C04','counterexample',configs['webSearch'].required,True,'TypeSystem.extract_type_info marks defaulted bool required; metadata not value validation')

 # Rules: original constructor/match/from_config, fake already-typed config DTO.
 E.update(IMMessage=type('IMMessage',(),{}),IMAdapter=type('IMAdapter',(),{}),WorkflowRegistry=type('WorkflowRegistry',(),{}),DispatchRuleRegistry=type('DispatchRuleRegistryToken',(),{}),RuleConfig=DTO)
 load('kirara_ai/workflow/core/dispatch/rules/base.py',{'DispatchRule'},E)
 for name in ['PrefixRuleConfig','KeywordRuleConfig','RegexRuleConfig','ChatSenderMatchRuleConfig'] :E[name]=DTO
 class ChatType:
  GROUP='group';C2C='c2c'
  @classmethod
  def from_str(cls,s):return cls.GROUP if s=='群聊' else cls.C2C
 E['ChatType']=ChatType;E['ChatTypeMatchRuleConfig']=DTO
 class TextMessage:
  def __init__(self,text):self.text=text
 E['TextMessage']=TextMessage
 load('kirara_ai/workflow/core/dispatch/rules/message_rules.py',{'PrefixMatchRule','KeywordMatchRule','RegexMatchRule'},E)
 load('kirara_ai/workflow/core/dispatch/rules/sender_rules.py',{'ChatTypeMatchRule','ChatSenderMatchRule'},E)
 for n in ['PrefixMatchRule','KeywordMatchRule','RegexMatchRule','ChatTypeMatchRule','ChatSenderMatchRule']:E['DispatchRule'].register_rule_type(E[n])
 # Keep original relative import inside CombinedDispatchRule.match.
 modname='kirara_ai.workflow.core.dispatch.rules.base';m=types.ModuleType(modname);m.DispatchRule=E['DispatchRule'];sys.modules[modname]=m
 E['__package__']='kirara_ai.workflow.core.dispatch.models'
 load('kirara_ai/workflow/core/dispatch/models/dispatch_rules.py',{'SimpleDispatchRule','RuleGroup','CombinedDispatchRule'},E)
 load('kirara_ai/workflow/core/dispatch/registry.py',{'DispatchRuleRegistry'},E,methods=['__init__','register','get_active_rules'])
 DR=E['DispatchRuleRegistry'];E['DispatchRuleRegistry']=DR
 def group(operator,rules):return E['RuleGroup'](operator=operator,rules=[E['SimpleDispatchRule'](type=t,config=c) for t,c in rules])
 def combined(id,groups,priority=5,enabled=True):return E['CombinedDispatchRule'](rule_id=id,name=id,workflow_id=id,priority=priority,enabled=enabled,rule_groups=groups)
 g=group('and',[('prefix',{'prefix':'!'}),('chat_type',{'chat_type':'群聊'})]); rule=combined('specific',[g],10)
 msg=lambda text,kind='group':types.SimpleNamespace(content=text,message_elements=[TextMessage(text)],sender=types.SimpleNamespace(chat_type=kind,group_id='g1',user_id='u1'))
 row('KI-P05','positive',rule.match(msg('!你好'),None,None),True,'CombinedDispatchRule.match AND + original prefix/chat type')
 row('KI-N02','rejection',rule.match(msg('你好'),None,None),False,'same rules non-prefix')
 row('KI-N03','rejection',rule.match(msg('!你好','c2c'),None,None),False,'same rules wrong chat type')
 disabled=combined('disabled',[g],20,False)
 row('KI-N04','rejection',disabled.match(msg('!你好'),None,None),False,'CombinedDispatchRule.enabled')
 # Empty group must not bypass a later false AND group, but original returns True.
 empty=combined('empty-first',[group('and',[]),g])
 row('KI-C05','counterexample',empty.match(msg('你好'),None,None),True,'CombinedDispatchRule empty group returns early; later AND ignored')
 wfreg=types.SimpleNamespace(get_workflow=lambda id,c:types.SimpleNamespace(name=id))
 token=E['WorkflowRegistry'];container=FakeContainer({token:wfreg})
 dr=DR(container)
 fallback=combined('fallback',[group('or',[('keyword',{'keywords':['你好']})])],1)
 for r in [fallback,rule,disabled]:dr.register(r)
 container.register(DR,dr)
 called=[]
 class FakeExecutor:
  def __init__(self,c):self.workflow=c.resolve(E['Workflow']);called.append(self.workflow.name)
  async def run(self):return {'selected':self.workflow.name}
 E['WorkflowExecutor']=FakeExecutor
 load('kirara_ai/workflow/core/dispatch/exceptions.py',{'WorkflowNotFoundException'},E)
 load('kirara_ai/workflow/core/dispatch/dispatcher.py',{'WorkflowDispatcher'},E)
 dispatcher=E['WorkflowDispatcher'](container)
 row('KI-P06','positive',await dispatcher.dispatch(object(),msg('!你好')),{'selected':'specific'},'original dispatcher/scoped registry/first match; fake executor records selection')
 row('KI-P07','positive',called,['specific'],'first matching workflow only')
 row('KI-N05','rejection',await dispatcher.dispatch(object(),msg('unmatched')),None,'original no-match path')

 # Scope original predicates and MemoryManager query. No real history DB.
 E.update(MemoryScope=object,ChatSender=object)
 load('kirara_ai/memory/scopes/builtin_scopes.py',{'MemberScope','GroupScope','GlobalScope'},E)
 s1=msg('',ChatType.GROUP).sender;s2=types.SimpleNamespace(chat_type=ChatType.GROUP,group_id='g1',user_id='u2');s3=types.SimpleNamespace(chat_type=ChatType.GROUP,group_id='g2',user_id='u1')
 scope=E['MemberScope']();gs=E['GroupScope']()
 row('KI-P08','positive',[scope.is_in_scope(s1,s1),gs.is_in_scope(s1,s2)],[True,True],'MemberScope/GroupScope actual predicate')
 row('KI-N06','rejection',[scope.is_in_scope(s1,s2),gs.is_in_scope(s1,s3)],[False,False],'member and group isolation same IDs')
 # Extract only query into standalone object: original code, fake in-memory persistence.
 p=R/'kirara_ai/memory/memory_manager.py';tree=ast.parse(p.read_text());cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='MemoryManager');n=copy.deepcopy(next(n for n in cls.body if isinstance(n,ast.FunctionDef) and n.name=='query'))
 exenv=dict(E,MemoryEntry=object);exec(compile(ast.Module([n],[]),str(p),'exec'),exenv)
 loaded.append(dict(path=str(p),symbol='MemoryManager.query',start=n.lineno,end=n.end_lineno,sha256=hashlib.sha256(p.read_bytes()).hexdigest(),method_subset=['query']))
 ent=lambda text,ts:types.SimpleNamespace(sender=s1,timestamp=ts,text=text)
 mm=types.SimpleNamespace(memories={'A-member:g1:u1':[ent('A',1)],'B-member:g1:u1':[ent('B',2)]},persistence=types.SimpleNamespace(load=lambda k:[]))
 row('KI-C06','counterexample',[e.text for e in exenv['query'](mm,scope,s1,'A')],['A','B'],'MemoryManager.query ignores extra_identifier after preload; cross namespace leak')

asyncio.run(main())
(O/'kirara-results.json').write_text(json.dumps({'runtime':sys.version,'fake_boundaries':['Pydantic DTO/config constructors (no validation)','logger','dependency container/scoped objects','event DTO/sink','dispatcher workflow execution sink','memory persistence map'],'real':['original extracted classes/functions listed separately','asyncio.timeout','ThreadPoolExecutor','typing/inspect/re','in-memory dictionaries only'],'observations':rows},ensure_ascii=False,indent=2))
(O/'executed-kirara.json').write_text(json.dumps(loaded,ensure_ascii=False,indent=2))
print(json.dumps({'observations':len(rows),'positive':sum(x['kind']=='positive' for x in rows),'rejection':sum(x['kind']=='rejection' for x in rows),'counterexample':sum(x['kind']=='counterexample' for x in rows),'all_assertions_passed':all(x['assertion_passed'] for x in rows)},ensure_ascii=False))
