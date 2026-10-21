"""Re-run both native arms against the read-only frozen fixture; assemble evidence.
--assemble-only retains already-run raw observations and never re-executes arms.
"""
import hashlib,json,subprocess,sys
from pathlib import Path
from collections import Counter
O=Path('/tmp/aimy-20261014-memory-ab-lm');FP=Path('/tmp/aimy-20261014-memory-ab/fixtures.json');EXPECTED='61b8c0b87067f9d349876f11217adcb82d321df795ddfec6e330e0f9caa14b61'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert sha(FP)==EXPECTED,'input fixture changed'
F=json.loads(FP.read_text())
if '--assemble-only' not in sys.argv:
 for cmd in [[sys.executable,'-B',str(O/'aions-arm.py')],['node',str(O/'airi-arm.cjs')]]:
  completed=subprocess.run(cmd,check=True,capture_output=True,text=True)
  print(completed.stdout,end='')
a=json.loads((O/'aions-results.json').read_text());b=json.loads((O/'airi-results.json').read_text())
assert a['fixture_sha256']==b['fixture_sha256']==EXPECTED
AM={x['case_id']:x for x in a['cases']};BM={x['case_id']:x for x in b['cases']}
assert list(AM)==list(BM)==[x['id'] for x in F['memory_cases']]
comments={
 'LM01':('持久画像是本地固定源码/新进程证实的增量；不是AIRI聊天丢失','SQLite画像恢复1条；原manager新OS进程为空。两者数据对象/启动链不同，不称等价整应用重启。'),
 'LM02':('精确重复去重双方已有，不算候选新增','Aions job source_id幂等加同topic原函数；AIRI字符串列表精确去重。均不证明同义事实去重。'),
 'LM03':('精确同主题当前事实替换有界差异','Aions同category/topic按较新source_ts复用key；AIRI confirmedFacts只并列表字符串，无topic合同；不以unsupported打0分。'),
 'LM04':('迟到保护双方已有，不重复计算完整新增功能','Aions同条目source_ts和AIRI全局sourceTurnIndex水位均挡旧；不是同主题当前事实语义本身。'),
 'LM05':('逐事实来源白名单是有界差异','Aions原U标签名单拒绝U999；AIRI caller sourceTurnId并非逐事实源消息查验；不混淆sourceTurn标签与来源证据。'),
 'LM06':('await前后原文一致性是有界差异','Aions原SQLite消息改后after-context检查拒绝候选；AIRI manager没有原文存储/版本接口，不填实现。'),
 'LM07':('同ref删除与revision拒迟到在此序列成立','Aions真实manual删除、原job pending重排及30秒retry之后同P1仍被阻止；AIRI仅whole-task clear邻接探针会重建，不代表桌面会话删除失效。'),
 'LM08':('删除屏障不够完整，不能直接复用为完整遗忘','主任务manual来源事实删后，新U1候选改topic被提交；自动private:U1同源副探针只在内存新建、未SQL commit。AIRI无per-fact delete/topic合同，unsupported；不能据此宣布一方完整删除更强。'),
 'LM09':('两方均不保证合法来源中的本人语义正确','故意固定错误模型候选被两方原写入接口接受，只测确定性防线边界，不评价抽取模型精确率/理解能力。'),
 'LM10':('原生长度拒绝更严，但没有总结质量胜出结论','相同1504字原候选：Aions每条600字原校验拒绝、job pending、context0；AIRI原context1540超过1200目标，未添加截断。')}
cases=[]
for f in F['memory_cases']:
 x=AM[f['id']];y=BM[f['id']]
 assert x['contract_outcome'] in ['pass','fail','unsupported','inconclusive'] and y['contract_outcome'] in ['pass','fail','unsupported','inconclusive']
 cases.append({'case_id':f['id'],'contract':f['contract'],'fixture_input':f,'arms':{'aions_home':x,'airi_task_memory':y},'comparison':{'bounded_conclusion':comments[f['id']][0],'limits':comments[f['id']][1],'experience_stronger_proven':False}})
manifest=json.loads((O/'aions-manifest.json').read_text())+json.loads((O/'airi-manifest.json').read_text())
for m in manifest:assert sha(m['path'])==m['sha256'],'source changed during controlled run: '+m['path']
caller_paths=[('/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/routes/user_profile.py',[[1,60]]),('/Users/mima1234/Documents/aimy/aimy-app/services/computer-use-mcp/src/server/register-task-memory.ts',[[1,122]]),('/Users/mima1234/Documents/aimy/aimy-app/services/computer-use-mcp/src/server/runtime.ts',[[65,80]])]
source={'date':'2026-10-14','fixture_path':str(FP),'fixture_sha256':EXPECTED,'loaded_source_units':manifest,'loaded_unit_meaning':'原代码装配清单；不声称所有加载函数/分支均执行。关键已执行路径由每case native_sequence/结果和README锚点指明。','static_caller_evidence':[{'path':p,'sha256':sha(p),'ranges':r,'runtime_executed':False} for p,r in caller_paths],'all_loaded_source_hashes_unchanged_after_execution':True,'runtime_versions':{'python':a['runtime'],'node':b['runtime'],'typescript':b['real_compiler_version']},'native_storage':'sqlite3 actual file/transactions behind async protocol shim; not installed aiosqlite','source_import_exclusions':['Aions config/database/router/model call not imported','AIRI desktop app/service entry point not started','no Ryza arm in this LM batch; native corresponding long-term modules not falsely added to AIRI'],'output_scripts':[{'path':str(p),'sha256':sha(p)} for p in [O/'aions-arm.py',O/'airi-arm.cjs',O/'run.py']]}
(O/'source-manifest.json').write_text(json.dumps(source,ensure_ascii=False,indent=2))
result={'date':'2026-10-14','protocol_version':F['version'],'status':'controlled offline native function/SQL comparison; not product implementation or real model/UX evaluation','common_inputs':{'fixture_sha256':EXPECTED,'initial_clock_iso':F['clock_iso'],'initial_clock_epoch':F['clock_epoch'],'timezone':F['timezone'],'model':F['model'],'embedding':F['embedding'],'context_char_budget':F['context_char_budget'],'fixture_unchanged_after_execution':sha(FP)==EXPECTED,'LM07_only_clock_advance_seconds':31},'cases':cases,'scope':{'real_SQLite_fresh_OS_process':True,'real_Node_fresh_OS_process':True,'AIRI_manager_persistence_added':False,'product_code_changed':False,'real_models_devices_network_or_messages':False,'whole_application_or_Electron_restart':False,'desktop_IndexedDB_chat_restore_checked_here':False},'outcome_counts_for_audit_only':{'aions_home':dict(Counter(x['contract_outcome'] for x in a['cases'])),'airi_task_memory':dict(Counter(x['contract_outcome'] for x in b['cases']))},'count_policy':'逐合同状态，不合成胜率/通过率或比较排行榜；unsupported不打零分；反例断言成立仍是合同fail','commands_actually_run':['python3 -B /tmp/aimy-20261014-memory-ab-lm/aions-arm.py','node /tmp/aimy-20261014-memory-ab-lm/airi-arm.cjs','python3 -B /tmp/aimy-20261014-memory-ab-lm/run.py --assemble-only'],'fresh_process_limits':['Aions child reads same synthetic SQLite via original snapshot; not complete FastAPI startup','AIRI child constructs original in-memory manager with no parent payload or injected persistence; not desktop IndexedDB restore','main agent owns separate real IndexedDB chat repo experiment; chat history/tombstone/outbox not equivalent to per-fact memory barrier']}
(O/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps({'cases':len(cases),'statuses':result['outcome_counts_for_audit_only'],'fixture_unchanged':sha(FP)==EXPECTED,'loaded_source_units':len(manifest),'all_source_hashes_unchanged':True},ensure_ascii=False))
