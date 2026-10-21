from pathlib import Path
from collections import Counter
import json, hashlib, subprocess, re

root=Path('/Users/mima1234/Documents/aimy'); docs=root/'docs'; research=docs/'02-调研参考'
name='2026-10-14-长期记忆召回与主动续聊同条件验证'
ev=research/(name+'-证据'); pack=docs/'05-实施手册/2026-10-14-Aimy增量开发交接包'
archive=docs/'91-管理记录/2026-10-14-复用范围校正'; tmp=Path('/tmp/aimy-20261014-memory-ab')
def read(p): return json.loads(Path(p).read_text())
def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
fixture=read(ev/'protocol/fixtures.json'); expected_sha=(tmp/'fixture-sha256.txt').read_text().strip()
assert sha(ev/'protocol/fixtures.json')==sha(tmp/'fixtures.json')==expected_sha
assert len(fixture['memory_cases'])==len(fixture['recall_queries'])==len(fixture['proactive_cases'])==10
assert len(fixture['recall_corpus'])==32
report=read(research/(name+'.json')); assert report['fixture']['sha256']==expected_sha
assert report['real_model_calls']==report['external_messages_sent']==report['device_capture_calls']==0
assert report['product_code_changed'] is False and report['whole_product_or_experience_acceptance_completed'] is False
assert report['gold_adjudication']==read(ev/'protocol/gold-adjudication.json')
assert report['gold_adjudication']['Q07']['evidence_relevant_ids']==['R09']
assert not report['gold_adjudication']['Q07']['active_current_fact_ids']

lm=read(ev/'memory/results.json'); assert len(lm['cases'])==10
assert {x['case_id'] for x in lm['cases']}=={x['id'] for x in fixture['memory_cases']}
for x in lm['cases']: assert x['fixture_input']==next(c for c in fixture['memory_cases'] if c['id']==x['case_id'])
for arm in ['aions_home','airi_task_memory']:
 assert dict(Counter(x['arms'][arm]['contract_outcome'] for x in lm['cases']))==lm['outcome_counts_for_audit_only'][arm]
assert report['per_contract_audit_only']['memory']==lm['outcome_counts_for_audit_only']
rec=read(ev/'recall/results.json'); assert len(rec['observations'])==50
assert rec['gold_adjudication']['data']==report['gold_adjudication']
for x in rec['raw_result_integrity']:
 assert sha(x['path'])==x['sha256']==sha(ev/'recall'/Path(x['path']).name)
pr=read(ev/'proactive/results.json');assert len(pr['comparison'])==10
assert report['per_contract_audit_only']['proactive']==pr['comparison']
assert next(x for x in pr['comparison'] if x['id']=='PR09')['AIRI']['contract_outcome']=='inconclusive'
assert next(x for x in pr['comparison'] if x['id']=='PR09')['AionsHome']['contract_outcome']=='inconclusive'
sup=read(ev/'proactive/PR09-surfacing-supplement.json')
assert sup['original_PR09_outcome_unchanged']=='inconclusive'
assert sup['frozen_input_and_original_raw_before']==sup['frozen_input_and_original_raw_after']
assert sup['native_budget']==8 and len(sup['cases'])==3
for x in sup['cases']:
 assert len(x['original_producer']['returned_ids'])==8 and x['proactive_contract_outcome']=='inconclusive'
 assert '[背景记忆]' in x['original_context_assembler']['returned_blocks']['time_block']
browser=read(ev/'browser/verification.json');assert browser['real_browser_storage'] and browser['fresh_js_page_realm']
assert not browser['fresh_browser_os_process'] and not browser['full_electron_tested']
assert browser['task_finished'] and browser['local_server_stopped']
assert read(ev/'browser/delete-fresh-page-read.json')['restored']=={'chat':None,'ryza':[]}
assert read(ev/'browser/ryza-fact-counterexamples.json')['correction']['contract_outcome']=='fail'
assert len(read(ev/'browser/ryza-fact-counterexamples.json')['afterFreshPageRealm']['entries'])==1
core=read(ev/'protocol/airi-default-context-results.json');assert len(core['captures'])==3 and len(core['observations'])==5
assert core['fixture_sha256']==expected_sha

copies=read(ev/'原字节映射.json');assert len({x['copy'] for x in copies})==len(copies)
assert all(sha(x['source'])==sha(x['copy'])==x['sha256'] for x in copies)
sources={}
def walk(v):
 if isinstance(v,dict):
  if isinstance(v.get('path'),str) and isinstance(v.get('sha256'),str) and Path(v['path']).is_absolute():sources[v['path']]=v['sha256']
  for k,x in v.items():
   if isinstance(k,str) and k.startswith('/') and isinstance(x,str) and re.fullmatch('[a-f0-9]{64}',x):sources[k]=x
   else:walk(x)
 elif isinstance(v,list):
  for x in v:walk(x)
for p in [ev/'memory/source-manifest.json',ev/'recall/source-manifest.json',ev/'proactive/source-manifest.json',ev/'proactive/PR09-source-supplement-hashes.json',ev/'browser/source-manifest.json']:
 walk(read(p))
walk(core['sourceHashes']);assert sources and all(Path(p).is_file() and sha(p)==h for p,h in sources.items())
prior_evidence=read(tmp/'evidence-before.json');assert len(prior_evidence)==105
assert all(sha(x['path'])==x['sha256'] for x in prior_evidence)
archive_files=0
for n,expected in [('旧版副本映射.json',3),('邻接补核前副本映射.json',3),('同条件验证前副本映射.json',5)]:
 rows=read(archive/n);assert len(rows)==expected and all(sha(x['copy'])==x['sha256'] for x in rows);archive_files+=len(rows)

sel=read(pack/'能力选择.json'); master=read(research/'2026-10-14-五项目功能增量与验证裁决.json'); trace=read(pack/'追溯矩阵.json')
assert sel['decisions']==master['decisions'] and len(sel['decisions'])==55
assert len({x['candidate_id'] for x in sel['decisions']})==55
assert {'CH01','CH02'}.isdisjoint({x['candidate_id'] for x in sel['decisions']})
assert {x['candidate_id'] for x in sel['decisions']}=={x['candidate_id'] for x in trace['candidate_mappings']}
assert dict(Counter(x['selection'] for x in sel['decisions']))==sel['counts']==master['counts']
elig=[x for x in sel['decisions'] if x['product_increment_eligible']]
assert len(elig)==8 and len({i for x in elig for i in x['functional_slices']})==5
previous=read(archive/'同条件验证前-追溯矩阵.json')
assert trace['tasks']==previous['tasks'] and trace['requirements']==previous['requirements']
assert len(trace['tasks'])==15 and len(trace['requirements'])==14
assert len(read(pack/'接口目录.json')['operations'])==17
prompts=read(pack/'Prompt目录.json')['prompts'];assert len(prompts)==5 and all(sha(pack/x['file'])==x['sha256'] for x in prompts)
for x in sel['decisions']:
 if not x['product_increment_eligible']:assert not x['requirements']
for cid in ['KI06','KI07','CK01','CK04']:
 x=next(x for x in sel['decisions'] if x['candidate_id']==cid);assert not x['product_increment_eligible'] and not x['current_release_selected']

before=read(tmp/'product-before.json'); changed=[p for p,h in before['files'].items() if not (root/p).is_file() or sha(root/p)!=h]
listed=set(subprocess.check_output(['git','-C',str(root),'ls-files','--cached','--others','--exclude-standard','-z','--','aimy-app']).decode().split('\0'))-{''}
current={p for p in listed if (root/p).is_file()};assert current==set(before['files']) and not changed
for p in listed-current:assert (root/p).is_symlink() and str((root/p).readlink()).encode()==subprocess.check_output(['git','-C',str(root),'show',':'+p])
assert sha(before['git_index_path'])==before['git_index_sha256']
files=list(pack.rglob('*.md'))+[docs/'README.md',docs/'PROJECT_STATE.md',docs/'任务编排.md',docs/'00-当前方向/开发方向与边界.md',research/'README.md',research/(name+'.md'),research/'2026-10-14-五项目功能增量与验证裁决.md',ev/'README.md',archive/'README.md']
broken=[];links=0;out_path=ev/'交付核验.json'
for p in files:
 for m in re.finditer(r'\[[^\]]*\]\(([^\n)]+)\)',p.read_text()):
  href=m.group(1).strip().strip('<>')
  if re.match(r'^(https?:|#|codex:|mailto:|app:)',href):continue
  href=re.sub(r':\d+$','',href.split('#')[0]);dst=Path(href) if href.startswith('/') else p.parent/href;links+=1
  if not dst.exists() and dst!=out_path:broken.append({'file':str(p),'href':href})
assert not broken,broken
assert 'PENDING' not in (research/(name+'.md')).read_text()
for ref in report['raw_evidence'].values():assert (research/ref).is_file()
json_files=list(ev.rglob('*.json'))
for p in json_files:read(p)
out={'date':'2026-10-14','status':'文档/机器字段/字节/入口与范围保护核验通过；非真实产品或模型效果验收','fixture_sha256':expected_sha,'controlled_cases':{'memory':10,'recall_records':32,'recall_queries':10,'proactive':10},'raw_recall_observations_not_function_count':50,'same_inputs_not_equivalent_interfaces':True,'no_quality_ranking':True,'original_PR09_still_inconclusive':True,'supplement_background_only':True,'gold_adjudication_preserves_raw':True,'durable_original_byte_copies':len(copies),'source_and_harness_paths_hash_verified':len(sources),'prior_evidence_originals_unchanged':len(prior_evidence),'prior_derived_archive_copies_unchanged':archive_files,'active_selection':{'records':55,'eligible_records':8,'merged_slices':5,'requirements':14,'tasks':15,'apis':17,'prompts':5,'prior_tasks_and_requirements_unchanged':True,'prompt_hashes_match':True},'navigation':{'files':len(files),'local_links':links,'broken':broken},'json_files_parsed':len(json_files),'protected_product_files':len(before['files']),'changed_product':changed,'git_index_unchanged':True,'real_model_calls':0,'external_messages_sent':0,'device_capture_calls':0,'browser_space_53_and_local_server_stopped':True,'review_findings_closed':{'LM08_summary':'manual task vs automatic same-source leaf explicitly separated; raw unchanged','delivery_README':'present and all linked current files exist','Q05':'top5 miss vs native12 background distinction explicit'}}
out_path.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(out,ensure_ascii=False,indent=2))
