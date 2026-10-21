from pathlib import Path
from collections import Counter
import json, hashlib, subprocess, re

root=Path('/Users/mima1234/Documents/aimy');docs=root/'docs';p=docs/'05-实施手册/2026-10-14-Aimy增量开发交接包';archive=docs/'91-管理记录/2026-10-14-增量交接包逐日审定'
read=lambda x:json.loads(Path(x).read_text())
sha=lambda x:hashlib.sha256(Path(x).read_bytes()).hexdigest()
ledger=read(p/'审定账本.json');trace=read(p/'追溯矩阵.json');api=read(p/'接口目录.json');prompts=read(p/'Prompt目录.json')['prompts'];sel=read(p/'能力选择.json');master=read(docs/'02-调研参考/2026-10-14-五项目功能增量与验证裁决.json')
assert ledger['productRoot']==str(root/'aimy-app')
assert ledger['decisions'][0]['selected']=='A' and ledger['decisions'][0]['status']=='confirmed_scope_only'
assert ledger['decisions'][0]['confirmation_source']=='本轮用户对选择工具的明确答复'
assert all(x['selected'] is None and x['date'] is None and x['status']=='not_asked' for x in ledger['decisions'][1:])
assert ledger['authorization']['planning_and_docs'] and all(v is False for k,v in ledger['authorization'].items() if k!='planning_and_docs')
assert ledger['progress']['next_day']==2 and not ledger['progress']['next_question_sent']
assert ledger['progress']['calendar_schedule'] is None and not ledger['progress']['automation_created']
assert len(trace['requirements'])==14 and len(trace['tasks'])==15 and len(api['operations'])==17 and len(prompts)==5
assert all(sha(p/x['file'])==x['sha256'] for x in prompts)
by={x['task_id']:x for x in trace['tasks']};req={x['requirement_id']:x for x in trace['requirements']};ops={x['operation']:x for x in api['operations']}
assert len(by)==15 and len(req)==14 and len(ops)==17
for t in by.values():
 assert set(t['dependencies']) <= set(by)
 assert set(t['requirements']) <= set(req)
 for v in t.get('conditional_dependencies',{}).values():assert set(v)<=set(by)
 for v in t.get('conditional_requirements',{}).values():assert set(v)<=set(req)
for r in req.values():
 assert set(r.get('task_ids',[])+r.get('conditional_task_ids',[]))<=set(by)
 assert set(r['api_operations'])<=set(ops)
for o in ops.values():assert o['requirement'] in req and o['model_callable'] is False
assert 'REQ-MEM-04' in by['MEM-03']['requirements'] and 'REQ-MEM-04' not in by['PRO-01']['requirements']
assert req['REQ-MEM-04']['api_operations']==['memory.resolveRequest']
assert ops['proactive.consider']['requirement']=='REQ-PRO-01'
assert by['INT-01']['dependencies']==['MEM-03'] and by['EXP-01']['dependencies']==['INT-01']
def closure(tid,seen=None):
 seen=set() if seen is None else seen
 if tid in seen:return seen
 seen.add(tid)
 for dep in by[tid]['dependencies']:closure(dep,seen)
 return seen
first=closure('EXP-01')
assert first==set(ledger['first_release_review']['task_ids'])==set(trace['scope_confirmation']['first_release_task_ids'])
assert not any(t.startswith(('PRO-','VIS-','VOICE-','CHAR-')) for t in first)
for tid in ['SRC-01','MEM-03']:
 for f in ['packages/core-agent/src/types/llm.ts','packages/core-agent/src/runtime/llm-service.ts','packages/core-agent/src/runtime/chat-completions.ts','packages/core-agent/src/runtime/responses.ts','packages/core-agent/src/runtime/request-context.ts','packages/core-agent/src/messages/chat-completions.ts']:
  assert f in by[tid]['allowed_future_paths'] and (root/'aimy-app'/f).is_file()
md=(p/'08-开发任务与交接.md').read_text()
assert set(re.findall(r'^### ([A-Z]+-\d+) ·',md,re.M))==set(by)
for t in by.values():
 section=md.split(f"### {t['task_id']} ·",1)[1].split('\n### ',1)[0]
 assert all(f'`{s}`' in section for s in t['allowed_future_paths'])
assert sel['decisions']==master['decisions'] and len(sel['decisions'])==55
assert dict(Counter(x['selection'] for x in sel['decisions']))==sel['counts']==master['counts']
assert len([x for x in sel['decisions'] if x['product_increment_eligible']])==8
assert {x['candidate_id'] for x in trace['candidate_mappings']}=={x['candidate_id'] for x in sel['decisions']}
assert trace['scope_confirmation']['product_implementation_authorized'] is False
for x in trace['candidate_mappings']:
 assert set(x['implementation_tasks'])<=set(by)
 if x['candidate_id']=='AH-R06':assert 'REQ-MEM-04' not in x['requirements']
old=read(archive/'审定前原字节映射.json');assert len(old)==14 and all(sha(x['copy'])==x['sha256'] for x in old)
copies=read(archive/'复核记录/原字节映射.json');assert all(sha(x['copy'])==sha(x['source'])==x['sha256'] for x in copies)
before=read('/tmp/aimy-20261014-handoff-review/protected-before.json');changed=[x for x,h in before['files'].items() if not (root/x).is_file() or sha(root/x)!=h]
assert not changed and sha(root/'.git/index')==before['index_sha256']
listed=subprocess.check_output(['git','-C',str(root),'ls-files','--cached','--others','--exclude-standard','-z','--','aimy-app']).decode().split('\0')
assert {x for x in listed if x and (root/x).is_file()}==set(before['files'])
files=list(p.glob('*.md'))+[docs/'README.md',docs/'PROJECT_STATE.md',docs/'任务编排.md',archive/'README.md',archive/'复核记录/README.md']
broken=[];count=0;planned=archive/'交付核验.json'
for f in files:
 for m in re.finditer(r'\[[^\]]*\]\(([^\n)]+)\)',f.read_text()):
  h=m.group(1).strip().strip('<>')
  if re.match(r'^(https?:|#|app:|mailto:|codex:)',h):continue
  h=re.sub(r':\d+$','',h.split('#')[0]);dst=Path(h) if h.startswith('/') else f.parent/h;count+=1
  if not dst.exists() and dst!=planned:broken.append({'file':str(f),'href':h})
assert not broken,broken
for f in list(p.glob('*.json'))+list((archive/'复核记录').rglob('*.json')):read(f)
out={'date':'2026-10-14','status':'审定文档/依赖闭包/字节保护核验通过；非实现或产品测试通过','day1':{'selection':'A','scope_only':True,'code_authorized':False},'future_days_not_asked_or_selected':6,'automation_created':False,'first_release_task_closure':sorted(first),'counts':{'requirements':14,'tasks':15,'api_proposals':17,'prompt_files_unchanged':5,'candidate_audit_records':55,'eligible_shortlist_records_not_first_release_count':8},'normal_chat_recall_task':'MEM-03','background_proactive_task':'PRO-01（后批）','post_commit_recovery_is_required':True,'durable_source_delete_receipt_is_required':True,'final_transport_and_payload_rebuild_contract':'待实现、源码边界已明确','prior_handoff_files_preserved':len(old),'review_original_byte_copies':len(copies),'navigation':{'files':len(files),'links':count,'broken':broken},'protected_product_files':len(before['files']),'changed_product':changed,'git_index_unchanged':True,'product_tests_rerun':False,'real_model_or_device_calls':0,'user_data_migration_or_deletion':False}
planned.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(json.dumps(out,ensure_ascii=False,indent=2))
