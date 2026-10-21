import hashlib,json
from pathlib import Path
O=Path('/tmp/aimy-20261014-memory-ab-proactive'); F=Path('/tmp/aimy-20261014-memory-ab/fixtures.json')
a=json.loads((O/'airi-results.json').read_text());b=json.loads((O/'aions-results.json').read_text())
assert a['fixture_sha256']==b['fixture_sha256']==hashlib.sha256(F.read_bytes()).hexdigest()=='61b8c0b87067f9d349876f11217adcb82d321df795ddfec6e330e0f9caa14b61'
assert [x['id'] for x in a['cases']]==[x['id'] for x in b['cases']]==[f'PR{i:02d}' for i in range(1,11)]
# Stage-level scope avoids treating supported native task mapping as a native NEXT_CHAT parser.
for x in a['cases']:
 x['stage_support']={'automatic_NEXT_CHAT_plan':'unsupported','native_notebook_task':'not_exercised' if x['id'] in ('PR09','PR10') else 'executed','atomic_single_claim':'unsupported','original_Spark_generation':'executed' if x['observation']['model_requests'] else 'not_called','character_reaction_commit':'executed' if x['observation']['reactions'] else 'not_called','real_voice_or_UI_delivery':'not_verified'}
for x in b['cases']:
 obs=x['observation'].get('restarted',x['observation'])
 x['stage_support']={'native_NEXT_CHAT_plan':'not_exercised' if x['id']=='PR09' else 'executed','original_SQL_claim':'executed' if obs.get('claim_attempts') else 'not_called','original_generation_caller':'executed' if obs.get('fixed_model_inputs') else 'not_called','original_SQL_commit_and_ws_broadcast':'executed' if obs.get('submissions') else 'not_called','real_UI_or_TTS_delivery':'not_verified'}
 b['field_mapping']={'assistant_NEXT_CHAT':'exact msg_created assistant content through original ws.broadcast → process_visible_message_event; initial synthetic SQL row mimics saved message','clock':'epoch seconds → original local datetime formatting; TZ Asia/Shanghai fixed','poll':'original _tick manually invoked at +30,+60,+90,+120 seconds; original background thread not launched','two_claims':'original _fire_monitor invoked twice on same captured schedule row after original normal fire; original DELETE+rowcount refuses duplicate','user_return':'synthetic saved user msg_created through original ws.broadcast; original hook removes pending proactive plans','disable':'original set_proactive_enabled boolean; save_settings only writes fake synthetic dict; pending timer remains','session_switch':'insert synthetic newer conv-B; original _fire_monitor selects latest conversations row','fresh_process':'two real OS child processes, same isolated SQLite; no transferred timer object','generation_control':'original current_generation/generation_event; no generation scope created by selected background caller','memory_surfacing':'context-only DTO with no timer; true producer not executed, inconclusive','idle':'separate original autonomy_actor_configs, minimum5min; not silently mapped to2min NEXT_CHAT or same toggle'}
combined={'fixture_sha256':a['fixture_sha256'],'version':'MEM-AB-PRO-1','contract_scope':'本轮Aimy续聊合成合同；fail/unsupported不等于上游违反自身设计承诺；反例断言通过不等于产品通过。','fixed_generation':{'visible_text':a['model_output'],'idle_json':{'action':'private_chat','reason':'固定模型控制变量','message':a['model_output']},'real_model_called':False},'comparison':[{'id':x['id'],'contract':x['contract'],'AIRI':{'contract_outcome':x['contract_outcome'],'reason':x['reason']},'AionsHome':{'contract_outcome':y['contract_outcome'],'reason':y['reason']}} for x,y in zip(a['cases'],b['cases'])],'projects':{'AIRI':a,'AionsHome':b},'no_aggregate_ranking':True,'real_product_acceptance':False}
(O/'results.json').write_text(json.dumps(combined,ensure_ascii=False,indent=2))
manifest={}
for project,file in [('AIRI','airi-source-manifest.json'),('AionsHome','aions-source-manifest.json')]:
 m=json.loads((O/file).read_text())
 for p,e in m.items():
  if isinstance(e.get('loaded_exact_bodies'),list):e['loaded_exact_bodies']=list({(x['name'],x['start'],x['end']):x for x in e['loaded_exact_bodies']}.values())
  assert hashlib.sha256(Path(p).read_bytes()).hexdigest()==e['sha256'],p
  manifest[p]={'project':project,**e}
sha_scripts={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in O.glob('*') if p.is_file() and p.suffix in ('.py','.mjs')}
(O/'source-manifest.json').write_text(json.dumps({'fixture_sha256':a['fixture_sha256'],'AIRI_head':'b851ef3334320d13dd86cb8cafb449a70d154c9b','AIRI_version_rule':'current source file hashes authoritative; shared repo HEAD alone not source purity claim','AionsHome_git':'local archive no .git; source file hashes authoritative','sources':manifest,'harness_sha256':sha_scripts,'scope_note':'loaded_exact_bodies lists loaded source definitions; not claim every listed helper branch executed. Per-case traces state executed paths.'},ensure_ascii=False,indent=2))
print(json.dumps({'cases':len(combined['comparison']),'fixture_sha256':a['fixture_sha256'],'source_files':len(manifest),'scope':'10 PR pairs +4 separate idle caller observations; no ranking'},ensure_ascii=False))
