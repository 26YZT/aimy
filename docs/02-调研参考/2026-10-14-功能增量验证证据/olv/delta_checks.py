from pathlib import Path
import ast,asyncio,json,re,unicodedata,runpy,hashlib
from types import SimpleNamespace
ROOT=Path('/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber');OUT=Path('/tmp/aimy-20261014-delta-olv')
class Log:
 def __getattr__(self,n):return lambda *a,**k:None
used={}
def load(rel,names,extra=None):
 p=ROOT/rel;b=p.read_bytes();used[str(p)]=hashlib.sha256(b).hexdigest();t=ast.parse(b);nodes=[x for x in t.body if isinstance(x,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef)) and x.name in names];ns={'re':re,'logger':Log(),'unicodedata':unicodedata,**(extra or {})};m=ast.Module(body=[ast.ImportFrom(module='__future__',names=[ast.alias(name='annotations')],level=0),*nodes],type_ignores=[]);exec(compile(ast.fix_missing_locations(m),str(p),'exec'),ns);return ns
ns=load('src/open_llm_vtuber/utils/tts_preprocessor.py',['tts_filter','_filter_nested','remove_special_characters','filter_brackets','filter_parentheses','filter_asterisks','filter_angle_brackets'])
fixtures=[('plain','你好，世界。'),('asterisk','*轻轻挥手*你好'),('nested','你好[轻声(深呼吸)]世界。'),('fullwidth','你好（轻轻挥手）世界。'),('code','变量a<b>c。'),('math','需要 (2+3) 个'),('unclosed','你好[未闭合文字')]
filters=[{'id':i,'input':s,'olv':ns['tts_filter'](s,False,True,True,True,True)}for i,s in fixtures]
async def translation():
 fn=load('src/open_llm_vtuber/conversations/conversation_utils.py',['handle_sentence_output'])['handle_sentence_output'];calls=[]
 class Output:
  def __init__(self,text):self.text=text
  async def __aiter__(self):yield SimpleNamespace(text=self.text,name='fake'),self.text,None
 class Tasks:
  async def speak(self,**kw):calls.append({'display':kw['display_text'].text,'tts':kw['tts_text']})
 class Translate:
  def __init__(self,fail=False):self.calls=0;self.fail=fail
  def translate(self,text):
   self.calls+=1
   if self.fail:raise RuntimeError('synthetic translation failure')
   return {'你好，小米！':'こんにちは、シャオミー！'}[text]
 async def send(x):raise AssertionError('No WS expected')
 tr=Translate();response=await fn(Output('你好，小米！'),None,None,send,Tasks(),tr);assert response=='你好，小米！' and calls[-1]=={'display':'你好，小米！','tts':'こんにちは、シャオミー！'}
 punctuation=Translate();await fn(Output('？！'),None,None,send,Tasks(),punctuation);assert punctuation.calls==0
 fail=Translate(True);before=len(calls)
 try:await fn(Output('你好，小米！'),None,None,send,Tasks(),fail)
 except RuntimeError:failed=True
 else:failed=False
 assert failed and len(calls)==before
 return {'normal':calls[0],'returned_display':response,'punctuation_skipped_translation':True,'translation_error_propagates':failed,'TTS_on_failure':len(calls)-before,'limit':'translator+TTS stub; no real translation quality, latency, API or audio'}
async def main():
 tr=await translation();disable=load('src/open_llm_vtuber/service_context.py',['ServiceContext'])['ServiceContext'].init_translate
 fresh=SimpleNamespace(translate_engine=None);disable(fresh,SimpleNamespace(translate_audio=False));assert fresh.translate_engine is None
 sentinel=object();already=SimpleNamespace(translate_engine=sentinel);disable(already,SimpleNamespace(translate_audio=False));assert already.translate_engine is sentinel
 tr['initial_disabled_no_engine']=True;tr['disable_after_enabled_leaves_existing_engine']=True;tr['disable_check_scope']='exact disabled branch; no provider/network'
 prior=runpy.run_path('/tmp/aimy-20261014-olv-audit/offline_checks.py',run_name='isolated_import');memory=await prior['proactive_memory_check']();assert memory['memory']==[{'role':'assistant','content':'proactive reply'}]
 report={'translation':tr,'filters':filters,'system_trigger_memory':memory,'sourceHashes':used,'network_models_devices_used':False};(OUT/'backend-delta-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))
asyncio.run(main())
