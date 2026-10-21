"""Independent PR09 supplement: original memory producer and context assembler, no model/network.
Frozen 10-case outputs remain byte-for-byte unchanged. Source bodies are AST-selected verbatim;
only @timed decorators are stripped. Real synthetic SQLite; shared 32-row corpus, fixed clock.
"""
import ast,asyncio,hashlib,json,os,re,sqlite3,types
from datetime import datetime,timedelta
from pathlib import Path
ROOT=Path('/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat')
OUT=Path('/tmp/aimy-20261014-memory-ab-proactive')
FIXTURE=Path('/tmp/aimy-20261014-memory-ab/fixtures.json')
FROZEN=[FIXTURE,OUT/'aions-results.json',OUT/'airi-results.json',OUT/'results.json',OUT/'source-manifest.json']
hash_bytes=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
BEFORE={str(p):hash_bytes(p) for p in FROZEN}
assert BEFORE[str(FIXTURE)]=='61b8c0b87067f9d349876f11217adcb82d321df795ddfec6e330e0f9caa14b61'
fixture=json.loads(FIXTURE.read_text());BASE=fixture['clock_epoch'];DB=OUT/'PR09-surfacing-synthetic.sqlite'
os.environ['TZ']='Asia/Shanghai';__import__('time').tzset()
if DB.exists():DB.unlink()
with sqlite3.connect(DB) as db:
 db.execute('''CREATE TABLE memories(id TEXT PRIMARY KEY,content TEXT,type TEXT,created_at REAL,source_conv TEXT,embedding BLOB,keywords TEXT,importance REAL,source_start_ts REAL,source_end_ts REAL,source_msg_id TEXT,evidence_summary TEXT,unresolved INTEGER,archive_state TEXT)''')
 for m in fixture['recall_corpus']:
  db.execute('INSERT INTO memories VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(m['id'],m['content'],'important',m['created_at'],'conv-synthetic',None,json.dumps(m['keywords'],ensure_ascii=False),m['importance'],m['source_start_ts'],m['source_end_ts'],json.dumps(m['source_message_ids'],ensure_ascii=False),'',0,m['archive_state']))
assert len(fixture['recall_corpus'])==32
sql_trace=[];embedding_calls=[];manifest={}
class Cursor:
 def __init__(self,c):self.c=c
 async def fetchall(self):return self.c.fetchall()
 async def fetchone(self):return self.c.fetchone()
class AsyncDB:
 def __init__(self):self.db=sqlite3.connect(DB);self.db.set_trace_callback(sql_trace.append)
 @property
 def row_factory(self):return self.db.row_factory
 @row_factory.setter
 def row_factory(self,v):self.db.row_factory=v
 async def __aenter__(self):return self
 async def __aexit__(self,*args):self.db.close()
 async def execute(self,*args):return Cursor(self.db.execute(*args))
class FixedDatetime(datetime):
 @classmethod
 def now(cls,tz=None):return datetime.fromtimestamp(BASE,tz)
async def no_embedding(text):embedding_calls.append(text);return None
async def no_health():return ''
ns={'asyncio':asyncio,'json':json,'re':re,'datetime':FixedDatetime,'timedelta':timedelta,'time':types.SimpleNamespace(time=lambda:BASE),'get_db':AsyncDB,'aiosqlite':types.SimpleNamespace(Row=sqlite3.Row),'get_embedding':no_embedding,'build_health_summary':no_health}
def load(file,names,constants=()):
 p=ROOT/file;tree=ast.parse(p.read_text());nodes=[];ranges=[]
 for node in tree.body:
  name=getattr(node,'name',None)
  targets=[t.id for t in node.targets if isinstance(t,ast.Name)] if isinstance(node,ast.Assign) else []
  if name in names or set(targets)&set(constants):
   if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)):node.decorator_list=[]
   nodes.append(node);ranges.append({'name':name or ','.join(targets),'start':node.lineno,'end':node.end_lineno})
 assert len(nodes)==len(names)+len(constants),(file,names,constants,ranges)
 exec(compile(ast.Module(body=nodes,type_ignores=[]),str(p),'exec'),ns)
 manifest[str(p)]={'sha256':hash_bytes(p),'loaded_original_ranges':ranges,'transform':'removed @timed decorators only; function bodies unchanged'}
load('memory.py',['_coerce_ts','_format_ts_label','_memory_time_payload','_memory_line_with_evidence','format_recalled_memories_for_prompt','recall_memories','build_surfacing_memories'],['_LEADING_DATE_RE'])
load('context_builder.py',['_memory_debug_item','_build_recall_query','build_memory_blocks'])
async def main():
 observations=[]
 for label,topic,kws in [('empty_topic_recent_default','',[]),('Q08_literal_context','Aimy的记忆项目',['Aimy','记忆']),('Q07_cancelled_history_query','灯塔散步约定还有效吗',['灯塔'])]:
  sql_trace.clear();embedding_calls.clear()
  rows,ids=await ns['build_surfacing_memories'](topic,kws) # original max_total=8
  producer={'returned_ids':[m['id'] for m in rows],'surfaced_ids':sorted(ids),'returned_rows':rows,'sql':list(sql_trace),'embedding_calls':list(embedding_calls),'native_max_total':8}
  assert len(rows)<=8 and len(ids)==len(rows)
  assert not ({'R04','R09'}&ids),'original archive_state cold exclusion'
  assert len(rows)==8,'shared corpus default recent fill'
  sql_trace.clear();embedding_calls.clear()
  blocks=await ns['build_memory_blocks'](topic,recent_messages=[],digest_result={'topic':topic,'keywords':kws,'is_search_needed':False,'require_detail':False},include_source_details=False)
  assert '[背景记忆]' in blocks['time_block'];assert blocks['memory_block']==''
  assert all(m['content'] in blocks['time_block'] for m in rows)
  assert len(blocks['digest_result']['recalled_memories'])==0
  observations.append({'label':label,'topic':topic,'keywords':kws,'original_producer':producer,'original_context_assembler':{'returned_blocks':blocks,'sql':list(sql_trace),'embedding_calls':list(embedding_calls)},'stage_outcome':'background_evidence_produced_and_assembled','proactive_contract_outcome':'inconclusive','sends':'not invoked by this request-context producer; no autonomous scheduling or final sender executed'})
 sql_trace.clear();embedding_calls.clear()
 skip=await ns['build_memory_blocks']('Aimy的记忆项目',skip_digest=True)
 assert '[背景记忆]' not in skip['time_block'] and sql_trace==[] and embedding_calls==[]
 after={str(p):hash_bytes(p) for p in FROZEN};assert after==BEFORE
 report={'fixture_sha256':BEFORE[str(FIXTURE)],'supplement_only':True,'original_PR09_outcome_unchanged':'inconclusive','clock_epoch':BASE,'clock_timezone':'Asia/Shanghai','shared_corpus_rows':32,'embedding':'original callers get None; no network/embedding or artificial vector','native_budget':8,'mapping':{'id/content/created_at/keywords/importance/source_start_ts/source_end_ts/archive_state':'retained exact shared corpus values','source_message_ids':'JSON in source_msg_id; no source fact changed','type':'important as common synthetic long-term row type; corpus has no type field','source_conv':'conv-synthetic default; no actual conversation/user data','embedding':'NULL','unresolved':'0 default because shared corpus has no unresolved field; not infer unresolved=true from promises','evidence_summary':'empty default'},'cases':observations,'negative_skip_digest':{'returned_blocks':skip,'sql':list(sql_trace),'embedding_calls':list(embedding_calls),'stage_outcome':'producer_not_invoked'},'AIRI_correspondence':{'native_automatic_memory_surfacing_producer':'unsupported in scoped default companion chain; not invented','prior_focus_and_empty_task_observation':'retained unchanged, not semantically equivalent memory producer'},'limits':['No natural-time proactive emission/real UI/TTS/human experience proven','Context assembler executed original full body with fixed external digest_result (supported original parameter); instant_digest/model routing not exercised; health boundary returns empty','Noembedding disables native vector-relevant surfacing and recall; shared corpus recent fill is not relevance ranking','Cold retired R04/R09 excluded from background producer here; this does not mean historical cancelled source evidence is forbidden in all queries','All shared rows unresolved0 and unique IDs, so unresolved-priority/cross-tier duplicate positive branch not forced; native loop checks and returned uniqueness executed','Source timestamps in shared corpus include future-today values; original recent query has lower bound only, no custom temporal filter added','No autonomous timer/scheduler/model-generation/submit invoked by this supplement; 0send is not automatic proactive experience pass'],'frozen_input_and_original_raw_before':BEFORE,'frozen_input_and_original_raw_after':after}
 (OUT/'PR09-surfacing-supplement.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
 
 for rel,ranges in [('routes/chat.py',[(1392,1440),(2046,2101)]),('chatroom.py',[(1138,1151)])]:
  q=ROOT/rel;manifest[str(q)]={'sha256':hash_bytes(q),'source_checked_only_ranges':ranges,'executed':False,'scope':'private route uses original producer inline; group builder consumes build_memory_blocks.time_block; these caller ranges source checked only'}
 report['source_connection_notes']={'context_builder':'original build_memory_blocks body actually executed; producer results assembled into time_block background','private_routes':'routes/chat.py:1407–1440 and2063–2101 directly call producer and insert background into history; source checked only, full private route not executed','group_context':'chatroom.py:1138–1150 calls build_memory_blocks and appends time_block; source checked only, not private caller','automatic_speech':'none of these background assembly facts alone proves timer→generate→final send'}
 (OUT/'PR09-surfacing-supplement.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
 manifest_report={'fixture_sha256':report['fixture_sha256'],'sources':manifest,'script_sha256':hash_bytes(Path(__file__)),'original_raw_unchanged':True,'semantic_scope':'original build_surfacing_memories+build_memory_blocks noembedding branches actually executed; not autonomous sender'}
 (OUT/'PR09-source-supplement-hashes.json').write_text(json.dumps(manifest_report,ensure_ascii=False,indent=2))
 print(json.dumps({'cases':[{'label':x['label'],'IDs':x['original_producer']['returned_ids'],'sql_count':len(x['original_producer']['sql']),'original_context_assembled':True} for x in observations],'native_max_total':8,'original_raw_unchanged':True,'PR09_contract':'inconclusive'},ensure_ascii=False,indent=2))
if __name__=='__main__':asyncio.run(main())
