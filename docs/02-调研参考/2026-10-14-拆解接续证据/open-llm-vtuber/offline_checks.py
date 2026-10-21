"""Execute exact source AST definitions with stubbed external edges. No product imports/network/devices."""
from pathlib import Path
from types import SimpleNamespace
from dataclasses import dataclass,asdict
from enum import Enum
from collections import defaultdict
from datetime import datetime
import ast,asyncio,json,hashlib,re,uuid,unicodedata,sys
ROOT=Path('/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber')
OUT=Path('/tmp/aimy-20261014-olv-audit')
MANIFEST={r['relative_path']:r for r in json.loads((OUT/'source-manifest.json').read_text())}
class QuietLog:
 def __getattr__(self,name):return lambda *args,**kwargs:None
logger=QuietLog()
used={}
def load(rel,names,ns=None,assignments=False):
 path=ROOT/rel;b=path.read_bytes();actual=hashlib.sha256(b).hexdigest();assert actual==MANIFEST[rel]['sha256'];used[rel]=actual
 ns={'__name__':'__main__','asyncio':asyncio,'json':json,'re':re,'uuid':uuid,'datetime':datetime,'logger':logger,'SimpleNamespace':SimpleNamespace,'dataclass':dataclass,'asdict':asdict,'Enum':Enum,'defaultdict':defaultdict,'unicodedata':unicodedata,**(ns or {})}
 tree=ast.parse(b);nodes=[n for n in tree.body if (isinstance(n,(ast.ClassDef,ast.FunctionDef,ast.AsyncFunctionDef)) and n.name in names) or (assignments and isinstance(n,ast.Assign))]
 module=ast.Module(body=[ast.ImportFrom(module='__future__',names=[ast.alias(name='annotations')],level=0),*nodes],type_ignores=[])
 exec(compile(ast.fix_missing_locations(module),str(path),'exec'),ns);return ns

def manager_ns():
 return load('src/open_llm_vtuber/conversations/tts_manager.py',['TTSTaskManager'],{'prepare_audio_payload':lambda **kw:{'type':'audio','text':kw['display_text'].text,'silent':kw['audio_path'] is None}})
async def stop_manager(m):
 sender=m._sender_task;m.clear()
 if sender:await sender

async def clear_check():
 M=manager_ns()['TTSTaskManager'];m=M();started=asyncio.Event();release=asyncio.Event();sent=[]
 class FakeTTS:
  async def async_generate_audio(self,**kw):started.set();await release.wait();return None
  def remove_file(self,path):raise AssertionError('No file IO expected')
 async def send(msg):sent.append(json.loads(msg))
 await m.speak('test words',SimpleNamespace(name='fake',text='first'),None,None,FakeTTS(),send);await started.wait();synthesis=m.task_list[0];sender=m._sender_task;m.clear();await asyncio.sleep(0)
 live=not synthesis.done();release.set();await synthesis;await sender
 assert live and not m.task_list and m._payload_queue.qsize()==1 and not sent
 return {'name':'clear_does_not_cancel_inflight_tts','pending_after_clear':live,'tracked_after_clear':len(m.task_list),'late_payloads_new_queue':m._payload_queue.qsize(),'sent_after_clear':len(sent)}
async def order_check():
 M=manager_ns()['TTSTaskManager'];m=M();release={t:asyncio.Event() for t in ['first','second']};sent=[]
 class FakeTTS:
  async def async_generate_audio(self,text,**kw):await release[text].wait();return None
 async def send(msg):sent.append(json.loads(msg)['text'])
 for text in ['first','second']:await m.speak(text,SimpleNamespace(name='fake',text=text),None,None,FakeTTS(),send)
 release['second'].set();await m.task_list[1];await m._payload_queue.join();assert sent==[]
 release['first'].set();await m.task_list[0];await m._payload_queue.join();assert sent==['first','second'];await stop_manager(m)
 return {'name':'parallel_tts_ordered_send','send_order':sent,'real_audio':False}
async def failure_check():
 M=manager_ns()['TTSTaskManager'];m=M();sent=[]
 class FakeTTS:
  async def async_generate_audio(self,**kw):raise RuntimeError('fake generation error')
 async def send(msg):sent.append(json.loads(msg))
 await m.speak('failing',SimpleNamespace(name='fake',text='shown'),None,None,FakeTTS(),send);await asyncio.gather(*m.task_list);await m._payload_queue.join();assert len(sent)==1 and sent[0]['silent'];await stop_manager(m)
 return {'name':'tts_failure_sends_silent_display','sent':sent}
async def overlap_check():
 release=asyncio.Event();launched=[]
 async def fake_process(**kw):launched.append(kw);await release.wait()
 ns=load('src/open_llm_vtuber/conversations/conversation_handler.py',['handle_conversation_trigger'],{'np':SimpleNamespace(random=SimpleNamespace(choice=lambda xs:xs[0])),'EMOJI_LIST':['fake'],'process_single_conversation':fake_process})
 trigger=ns['handle_conversation_trigger'];tasks={}
 async def send(msg):pass
 args=dict(msg_type='text-input',client_uid='fake',context=SimpleNamespace(),websocket=SimpleNamespace(send_text=send),client_contexts={},client_connections={},chat_group_manager=SimpleNamespace(get_client_group=lambda uid:None),received_data_buffers={},current_conversation_tasks=tasks,broadcast_to_group=None)
 await trigger(data={'text':'first'},**args);first=tasks['fake'];await asyncio.sleep(0);await trigger(data={'text':'second'},**args);second=tasks['fake'];await asyncio.sleep(0)
 both=not first.done() and not second.done();assert both and tasks['fake'] is second and first is not second
 for t in [first,second]:t.cancel()
 await asyncio.gather(first,second,return_exceptions=True)
 return {'name':'same_client_task_overwrite','both_tasks_pending':both,'tracked_only_second':True,'inputs':[kw['user_input'] for kw in launched]}
async def proactive_memory_check():
 ns=load('src/open_llm_vtuber/agent/input_types.py',['TextSource'])
 identity=lambda *a,**kw:lambda fn:fn
 ns=load('src/open_llm_vtuber/agent/agents/basic_memory_agent.py',['BasicMemoryAgent'],{'AgentInterface':object,'TextSource':ns['TextSource'],'tts_filter':identity,'display_processor':identity,'actions_extractor':identity,'sentence_divider':identity})
 B=ns['BasicMemoryAgent'];b=B.__new__(B);b._memory=[];b._live2d_model=None;b._tts_preprocessor_config=None;b._faster_first_response=True;b._segment_method='regex';b._use_mcpp=False;b._tool_manager=None;b._system='test';
 class FakeLLM:
  async def chat_completion(self,messages,system):yield 'proactive reply'
 b._llm=FakeLLM();data=SimpleNamespace(texts=[SimpleNamespace(source=ns['TextSource'].INPUT,content='synthetic trigger')],images=None,metadata={'skip_memory':True,'skip_history':True,'proactive_speak':True})
 chunks=[s async for s in b._chat_function_factory()(data)];assert b._memory==[{'role':'assistant','content':'proactive reply'}]
 return {'name':'proactive_skips_input_but_keeps_assistant','chunks':chunks,'memory':b._memory,'decorator_edges':'stubbed_identity; actual _to_messages/_add_message/simple-chat path'}
async def ack_checks():
 C=load('src/open_llm_vtuber/message_handler.py',['MessageHandler'])['MessageHandler'];h=C();h.handle_message('fake',{'type':'frontend-playback-complete'});early=await h.wait_for_response('fake','frontend-playback-complete',timeout=.01);assert early is None
 a=asyncio.create_task(h.wait_for_response('fake','frontend-playback-complete',timeout=.03));await asyncio.sleep(0);b=asyncio.create_task(h.wait_for_response('fake','frontend-playback-complete',timeout=.03));await asyncio.sleep(0);h.handle_message('fake',{'type':'frontend-playback-complete'});ra,rb=await asyncio.gather(a,b);assert ra is None and rb is not None
 return {'name':'ack_early_loss_and_same_key_collision','early_receipt_retained':False,'first_waiter_result':ra,'second_waiter_result':rb,'timeout_in_harness_only':True,'caller_default_timeout':None}
async def disconnect_check():
 async def fake_disconnect(**kw):pass
 clean=[];closed=[]
 ns=load('src/open_llm_vtuber/websocket_handler.py',['WebSocketHandler'],{'message_handler':SimpleNamespace(cleanup_client=lambda uid:clean.append(uid)),'handle_client_disconnect':fake_disconnect})
 C=ns['WebSocketHandler'];h=C.__new__(C)
 async def close():closed.append(True)
 h.chat_group_manager=SimpleNamespace(get_client_group=lambda uid:None);h.client_connections={'fake':object()};h.client_contexts={'fake':SimpleNamespace(close=close)};h.received_data_buffers={'fake':[]};h.current_conversation_tasks={};h.send_group_update=None
 await h.handle_disconnect('fake');assert not h.client_contexts and not closed and clean==['fake']
 return {'name':'disconnect_pops_context_before_close','context_close_calls':len(closed),'contexts_remaining':len(h.client_contexts),'cleanup_client_called':True}
async def shared_cache_check():
 C=load('src/open_llm_vtuber/service_context.py',['ServiceContext'])['ServiceContext'];a=C();b=C();agent=SimpleNamespace(_memory=[])
 async def fake_mcp(*args):pass
 a._init_mcp_components=fake_mcp;b._init_mcp_components=fake_mcp
 character=SimpleNamespace(agent_config=SimpleNamespace(agent_settings=SimpleNamespace(basic_memory_agent=SimpleNamespace(use_mcpp=False,mcp_enabled_servers=[]))))
 args=dict(config=object(),system_config=object(),character_config=character,live2d_model=object(),asr_engine=object(),tts_engine=object(),vad_engine=None,agent_engine=agent,translate_engine=None)
 await a.load_cache(**args);await b.load_cache(**args);a.agent_engine._memory.append({'role':'user','content':'synthetic A'});same=a.agent_engine is b.agent_engine and b.agent_engine._memory==a.agent_engine._memory;assert same
 return {'name':'new_contexts_share_agent_reference','same_agent':same,'second_context_sees_synthetic_memory':b.agent_engine._memory,'does_not_prove':'real frontend cross-talk'}
def pure_checks():
 mem0=ROOT/'src/open_llm_vtuber/agent/agents/mem0_llm.py';ns={};exec(compile(ast.parse(mem0.read_text()),str(mem0),'exec'),ns);assert 'LLM' not in ns
 detector=load('src/open_llm_vtuber/mcpp/json_detector.py',['StreamJSONDetector'])['StreamJSONDetector'];d=detector();valid='{'+ '"text":"}","ok":1' +'}';assert json.loads(valid);found=d.process_chunk(valid);assert found==[]
 E=load('src/open_llm_vtuber/mcpp/tool_executor.py',['ToolExecutor'])['ToolExecutor'];e=E(None,None);dictionary=e.process_tool_from_prompt_json([{'mcp_server':'fake','tool':'tool','arguments':{'x':1}}]);encoded=e.process_tool_from_prompt_json([{'mcp_server':'fake','tool':'tool','arguments':'{"x":1}'}]);assert dictionary==[] and len(encoded)==1
 ns=load('src/open_llm_vtuber/utils/sentence_divider.py',['comma_splitter','segment_text_by_regex'],assignments=True);comma=ns['comma_splitter']('你好，今天,后面');abbreviation=ns['segment_text_by_regex']('Dr. Smith is here.');assert comma[0]=='你好，今天,' and abbreviation[0]==['Smith is here.']
 L=load('src/open_llm_vtuber/agent/agents/letta_agent.py',['LettaAgent'],{'AgentInterface':object,'TextSource':SimpleNamespace(INPUT='input',CLIPBOARD='clipboard')})['LettaAgent'];l=L.__new__(L);images=l._to_messages(SimpleNamespace(texts=[SimpleNamespace(source='input',content='fake')],images=[SimpleNamespace(data='data:image/png;base64,fake')]));assert images==[{'role':'user','content':[{'type':'text','text':'fake'}]}]
 ns=load('src/open_llm_vtuber/utils/tts_preprocessor.py',['_filter_nested']);nested=ns['_filter_nested']('hello [one[two]] world','[',']');unclosed=ns['_filter_nested']('hello [one world','[',']');assert nested=='hello world' and unclosed=='hello'
 return [{'name':'mem0_empty_impl','tracked':True,'bytes':mem0.stat().st_size,'exports_LLM':False},{'name':'json_string_brace_not_supported','valid_json':valid,'detector_result':found},{'name':'prompt_tool_arguments_mismatch','object_arguments_result':dictionary,'string_arguments_count':len(encoded)},{'name':'sentence_helpers_edge_cases','comma_split':comma,'abbreviation_result':abbreviation},{'name':'letta_drops_image_inputs','messages':images},{'name':'nested_bracket_filter','nested_result':nested,'unclosed_result':unclosed}]
async def main():
 results=[]
 for f in [clear_check,order_check,failure_check,overlap_check,proactive_memory_check,ack_checks,disconnect_check,shared_cache_check]:results.append(await f())
 results.extend(pure_checks())
 report={'date':'2026-10-14','sha':'992309c0aa19845960228f880013d4685fde93b5','checks_passed':len(results),'checks':results,'source_hashes_used':used,'backend_AST_parse_pass':sum('syntax' in r and r['syntax']=='pass' for r in MANIFEST.values()),'product_started':False,'dependencies_installed':False,'network_used':False,'real_models_or_devices_used':False,'limits':['exact AST definitions but fake dependency edges; not full application test','no UI/device/audio/cost/quality acceptance','no real persistence crash/restart/durability test']}
 (OUT/'offline-checks.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__':asyncio.run(main())
