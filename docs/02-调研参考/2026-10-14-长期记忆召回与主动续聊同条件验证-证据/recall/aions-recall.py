"""Frozen controlled recall: actual AST source + actual SQLite SQL, no application imports."""
import ast, asyncio, hashlib, json, math, os, re, sqlite3, sys, time, types
from collections import Counter
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Literal, Sequence
os.environ['TZ']='Asia/Shanghai';time.tzset()
SRC=Path('/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat')
OUT=Path('/tmp/aimy-20261014-memory-ab-recall');FIX=Path('/tmp/aimy-20261014-memory-ab/fixtures.json')
FREEZE='61b8c0b87067f9d349876f11217adcb82d321df795ddfec6e330e0f9caa14b61'
assert hashlib.sha256(FIX.read_bytes()).hexdigest()==FREEZE
f=json.loads(FIX.read_text()); anchor=datetime.fromisoformat(f['clock_iso']); corpus=f['recall_corpus']; sql_trace=[];executed=[]
DB=OUT/'aions-synthetic-recall.sqlite'
if DB.exists():DB.unlink()
# Adapter schema contains only columns consumed by original SQL. Fixtures seed data, not product writes.
with sqlite3.connect(DB) as db:
 db.executescript('''CREATE TABLE memories(id TEXT PRIMARY KEY,content TEXT,keywords TEXT,importance REAL,embedding BLOB,created_at REAL,source_start_ts REAL,source_end_ts REAL,source_msg_id TEXT,compression_batch_id TEXT,source_conv TEXT,evidence_summary TEXT,archive_state TEXT,source_memory_ids TEXT);
 CREATE TABLE messages(id TEXT PRIMARY KEY,conv_id TEXT,role TEXT,content TEXT,created_at REAL);
 CREATE TABLE chatroom_rooms(id TEXT PRIMARY KEY,type TEXT);
 CREATE TABLE chatroom_messages(id TEXT PRIMARY KEY,room_id TEXT,sender TEXT,content TEXT,created_at REAL);
 CREATE TABLE memory_compression_batch_inputs(batch_id TEXT,store TEXT,memory_id TEXT);''')
 for r in corpus:
  db.execute('INSERT INTO memories VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(r['id'],r['content'],json.dumps(r['keywords'],ensure_ascii=False),r['importance']/5,None,r['created_at'],r['source_start_ts'],r['source_end_ts'],json.dumps(r['source_message_ids']),None,'fixture-conversation',r['summary'],r['archive_state'],None))
  for mid in r['source_message_ids']:
   db.execute('INSERT INTO messages VALUES(?,?,?,?,?)',(mid,'fixture-conversation','user',r['content'],r['created_at']))
class Cursor:
 def __init__(self,c):self.c=c
 async def fetchall(self):return self.c.fetchall()
 async def fetchone(self):return self.c.fetchone()
class AsyncDB:
 def __init__(self):
  self.db=sqlite3.connect(DB);self.db.set_trace_callback(sql_trace.append)
 @property
 def row_factory(self):return self.db.row_factory
 @row_factory.setter
 def row_factory(self,x):self.db.row_factory=x
 async def __aenter__(self):return self
 async def __aexit__(self,*args):self.db.close()
 async def execute(self,*a):return Cursor(self.db.execute(*a))
 async def commit(self):self.db.commit()
search=types.ModuleType('controlled_recall_search');sys.modules[search.__name__]=search;ns=search.__dict__
ns.update(asyncio=asyncio,json=json,math=math,re=re,Counter=Counter,dataclass=dataclass,field=field,datetime=datetime,timedelta=timedelta,Literal=Literal,Sequence=Sequence,aiosqlite=types.SimpleNamespace(Row=sqlite3.Row),get_db=AsyncDB)
def extract(filename,names,namespace):
 p=SRC/filename;tree=ast.parse(p.read_text()); nodes=[]
 for n in tree.body:
  if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef)) and n.name in names:
   nodes.append(n);executed.append({'path':str(p),'symbol':n.name,'start':n.lineno,'end':n.end_lineno,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
 assert {n.name for n in nodes}==set(names),(filename,names)
 exec(compile(ast.Module(body=nodes,type_ignores=[]),str(p),'exec'),namespace)
extract('memory.py',{'_json_list','_coerce_ts','_format_ts_label','_memory_time_payload'},ns)
# Dynamic imports in original source point to original extracted leaves, not source application initialization.
mem=types.ModuleType('memory');mem._json_list=ns['_json_list'];sys.modules['memory']=mem
chat=types.ModuleType('chatroom');chat.get_chatroom_names=lambda:('合成用户','合成AI','合成二号');sys.modules['chatroom']=chat
comp=types.ModuleType('memory_compression');sys.modules['memory_compression']=comp
comp.__dict__.update(get_db=AsyncDB,aiosqlite=types.SimpleNamespace(Row=sqlite3.Row),_json_list=ns['_json_list'])
extract('memory_compression.py',{'resolve_source_memories'},comp.__dict__)
p=SRC/'active_memory_search.py';t=ast.parse(p.read_text());assignments=[]
for n in t.body:
 if isinstance(n,ast.Assign) and all(isinstance(v,ast.Name) and (v.id.startswith('MAX_') or v.id in {'SUMMARY_LIMIT','SOURCE_LIMIT','SUMMARY_SOFT_LIMIT','NORMAL_BLOCK_LIMIT','HARD_BLOCK_LIMIT','_COMMAND_RE','_CSV_SPLIT_RE','_SPACE_RE'}) for v in n.targets):assignments.append(n)
exec(compile(ast.Module(body=assignments,type_ignores=[]),str(p),'exec'),ns)
# No constant rewritten: native result maximum stays 10 and native format soft/normal/hard caps remain 2500/4000/8000.
extract('active_memory_search.py',{'MemorySearchRequest','MemorySearchResult','_clean_query','extract_memory_search_requests','parse_memory_keywords','_logical_day_start','_parse_date','resolve_memory_time_window','_norm','rank_memory_rows','actor_memory_query','search_actor_memories','_attach_source_details','_history_sources','_excerpt','_source_line','_read_message','open_memory_source','search_chat_history','_format_time','format_memory_search_context'},ns)
embedding_inputs=[]
async def no_embedding(text):embedding_inputs.append(text);return None
ns['get_embedding']=no_embedding
source_to_id={mid:r['id'] for r in corpus for mid in r['source_message_ids']}; by_id={r['id']:r for r in corpus}
def canonical(memory_id):
 if memory_id in by_id:return memory_id
 return source_to_id.get(memory_id.partition(':')[2])
def observation(q,lane,command,requests,results=None,error=None,trace_start=0,embed_start=0):
 data=[asdict(r) for r in results or []];ids=[canonical(r['memory_id']) for r in data];expected=q['expected_relevant'];forbidden=q['forbidden']
 ctx=ns['format_memory_search_context'](results or [],q['text']) if error is None else None
 selected_set=set(ids);missing=[x for x in expected if x not in selected_set];bad=[x for x in ids if x in forbidden];irrelevant=[x for x in ids if x not in expected];retired=[x for x in ids if x and by_id[x]['status']=='retired']
 checks={'all_expected_present':not missing,'forbidden_absent':not bad,'no_unrelated_evidence':not irrelevant,'max5_actual':len(ids)<=f['recall_limit'],'context_max1200_actual':ctx is not None and len(ctx)<=f['context_char_budget'],'query_succeeded':error is None}
 outcome='pass' if all(checks.values()) else 'fail'
 return {'query_id':q['id'],'lane':lane,'raw_question':q['text'],'input_command':command,'requests':[asdict(x) for x in requests],'selected_original_ids':ids,'native_result_ids':[x['memory_id'] for x in data],'original_order':ids,'native_results':data,'native_context':ctx,'context_chars_unicode_codepoints':len(ctx) if ctx is not None else None,'context_utf16_units':len(ctx.encode('utf-16-le'))//2 if ctx is not None else None,'expected_relevant':expected,'forbidden':forbidden,'gold_observation':{'expected_hits':[x for x in ids if x in expected],'missing_expected':missing,'forbidden_selected':bad,'unrelated_selected':irrelevant,'retired_selected':retired,'duplicates':[x for x,c in Counter(ids).items() if c>1]},'checks':checks,'contract_outcome':outcome,'error':error,'sql_trace':sql_trace[trace_start:],'embedding_requests':embedding_inputs[embed_start:],'embedding_return':'None; no vectors in fixture database','native_parameter_support':{'top5':'unsupported; MAX_RESULTS=10, no per-call limit','context1200':'unsupported; original formatter no budget argument'},'semantic_limits':'Gold tests evidence selection only. Raw-question and fixture-controlled command routing are separate. Historical cancellation evidence can violate the frozen retired-exclusion gold without asserting that the cancelled plan is current.'}
async def main():
 observations=[]
 for lane in ['raw_question_in_search_command','fixture_controlled_structured_command']:
  for q in f['recall_queries']:
   if lane=='raw_question_in_search_command':command='[MEMORY_SEARCH:'+q['text']+']'
   else:command='[MEMORY_SEARCH:'+q['keywords']+(' |date='+q['date_text'] if q.get('date_text') else '')+']'
   _,requests=ns['extract_memory_search_requests'](command);trace_start=len(sql_trace);embed_start=len(embedding_inputs)
   try:results=await ns['search_actor_memories']('aion',requests,now=anchor);o=observation(q,lane,command,requests,results=results,trace_start=trace_start,embed_start=embed_start)
   except Exception as e:o=observation(q,lane,command,requests,error={'type':type(e).__name__,'message':str(e),'scope':'source search leaf raised; actual route has exception-to-search-failure handling but not executed here'},trace_start=trace_start,embed_start=embed_start)
   observations.append(o)
 for e in executed:assert hashlib.sha256(Path(e['path']).read_bytes()).hexdigest()==e['sha256']
 report={'fixture':str(FIX),'fixture_sha256':FREEZE,'clock':f['clock_iso'],'environment':{'real_SQLite':sqlite3.sqlite_version,'async_sqlite':'stdlib protocol shim; original SQL runs in synthetic file','real_model_calls':0,'network_calls':0,'real_devices':0,'real_embeddings':0,'product_source_writes':0,'application_bootstrap':False},'transformations':{'content':'identical fixture content/summary; no gold in data path','keywords':'original fixture list encoded JSON for original parse_memory_keywords','importance':'fixture 1..5 divided by5 into Aions0.2..1.0, monotonic; source rank adds <=0.05','timestamps':'original epoch seconds unchanged, TZ=Asia/Shanghai','status':'fixture archive_state passed directly; retired rows cold in original SQL, history remains visible original source text','source_ids':'same U-Rxx seeded as synthetic original messages; IDs mapped out-of-band only for judging','routing':'raw lane uses full original text as query, no extra date condition. controlled lane uses supplied fixture keywords/date_text, not real language extraction; must not claim routing accuracy','topK_budget':'No source constant mutation, no harness sorting/filtering/slicing/truncating output'},'executed_source':executed,'observations':observations,'source_hashes_unchanged':True,'summary':{lane:dict(Counter(o['contract_outcome'] for o in observations if o['lane']==lane)) for lane in {o['lane'] for o in observations}},'all_assertions_meaning':'Script validates provenance/shape only; contract failures remain product-contract failures and are not asserted into passes.'}
 (OUT/'aions-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps({'observations':len(observations),'summary':report['summary'],'rows':[{'q':o['query_id'],'lane':o['lane'],'ids':o['selected_original_ids'],'chars':o['context_chars_unicode_codepoints'],'outcome':o['contract_outcome'],'error':o['error']['type'] if o['error'] else None} for o in observations]},ensure_ascii=False,indent=2))
asyncio.run(main())
