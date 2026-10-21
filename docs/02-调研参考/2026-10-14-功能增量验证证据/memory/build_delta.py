from pathlib import Path
import hashlib,json
O=Path('/tmp/aimy-20261014-delta-memory');W=Path('/Users/mima1234/Documents/aimy');A=W/'aimy-app';R=Path('/Users/mima1234/Documents/资料/拆解项目/AionsHome-main')
selection=W/'docs/05-实施手册/2026-10-14-Aimy增量开发交接包/能力选择.json';summary=W/'docs/02-调研参考/2026-10-14-六项目复用裁决汇总.json';baseline=W/'docs/02-调研参考/2026-10-14-AIRI现状能力清单.json'
sel={r['candidate_id']:r for r in json.loads(selection.read_text())['decisions']};prior={r['id']:r for r in json.loads(summary.read_text())['decisions']};tests={x['test_id']:x for x in json.loads((O/'results.json').read_text())['observations']}
def ar(rel,line):
 p=A/rel;return {'path':str(p),'line':line,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
mem=[ar('packages/stage-pages/src/pages/settings/modules/memory-long-term.vue',2),ar('packages/memory-pgvector/src/index.ts',15),ar('packages/stage-ui/src/stores/character/notebook.ts',33),ar('packages/stage-ui/src/database/repos/chat-sessions.repo.ts',29)]
notify=[ar('packages/stage-ui/src/stores/character/orchestrator/store.ts',183),ar('packages/stage-ui/src/stores/character/notebook.ts',33)]
voice=[ar('packages/stage-ui/src/stores/voice.ts',418),ar('packages/core-agent/src/voice/input/attempt.ts',240),ar('packages/stage-ui/src/stores/modules/speech.ts',612)]
vision=[ar('packages/stage-ui/src/stores/modules/vision/orchestrator.ts',92),ar('packages/stage-ui/src/composables/vision/use-vision-inference.ts',81)]
rows=[]
def add(id,category,slices,decision,airi,unit,positives,negative,not_stronger,next_gate,air_refs):
 old=prior[id];refs=[]
 for e in old['source_evidence']:
  e=dict(e);p=Path(e['path'])
  if str(p).startswith(str(R)):
   e['sha256']=hashlib.sha256(p.read_bytes()).hexdigest();e['current_read_scope']='当前固定源码；本轮执行仅见对应test_id，其他为静态/先前定向深读'
  else:e['sha256']=None;e['current_read_scope']='仅沿用当前JSON记录；本DELTA未独立读取或执行Kirara源码'
  refs.append(e)
 for t in positives+negative:assert t in tests,(id,t)
 rows.append({'candidate_id':id,'candidate':old['candidate'],'original_selection':sel[id]['selection'],'functional_slice_ids':slices,'delta_classification':category,'revised_decision':decision,'current_airi_baseline':airi,'reusable_unit':unit,'positive_test_ids':positives,'negative_or_counterexample_test_ids':negative,'evidence_levels':{'current_static':'记录级，未独立复核Kirara' if id=='KI01' else '固定当前源码/已核AIRI相关主路径','current_isolated_execution':'有：仅列出的真实函数/合成边界' if positives or negative else '本轮无此候选直接执行','real_model_ab':'未进行','device_or_human_experience':'未进行'},'cannot_claim_stronger':not_stronger,'adoption_gate':next_gate,'source_evidence':refs,'airi_evidence':air_refs,'implementation_status':'未改产品代码；功能slice是研究短名单，不是候选完整实现已被采用'})
add('AH-R01','真实新增产品能力的主实现来源；局部源码/隔离机制已证','MEM-F01 MEM-F02'.split(),'保留，作为自动事实记忆一个能力的主参考，不把每个护栏另计功能','AIRI当前有聊天存储、内存notebook；长期记忆页面WIP、pgvector空configure；没有已核自动事实提取/纠正闭环','post_sentinel持久用户job、用户source标签、source_ts、revision/epoch、手动纠正/删除屏障；重做AIRI适配层',['DM-P01','DM-P02'],['DM-N01','DM-N02','DM-N03','DM-N04','DM-N05','DM-N06','DM-C01','DM-C02'],'有效来源ID不证明语义正确；引用/否定坏候选可被接受；不同topic同义事实可重建；没有真实准确率/自然主动收益AB','保留局部规则；补来源血缘和未知同义边界，真实模型提取/更正/删除质量评测前不得称整体更强',mem)
add('AH-R02','与AH-R01同一用户能力的补充源码，不单独新增计数',['MEM-F01'],'合并保留原子记录/来源管理补充，不另列一套记忆核心','同上；现有history/compaction不等于事实库','memory_library CRUD/来源页面数据契约，内容改动时置旧向量失效；不搬Python API/SQLite权威',['DM-P09','DM-P10'],['DM-N09','DM-C05'],'本轮自动_digest未执行；CRUD用假DTO/embedding/WS；删记录保留派生正文，不能说完整忘记更正确','与R01统一AIRI MemoryRepo/来源服务；消除两套删除入口与派生语义差异后再验',mem)
add('AH-R03','真实新增领域能力；工具runner本身已有',['MEM-F02'],'保留为有来源事实的时间/文本召回能力，与R01/R02共享数据','AIRI已有context、tools/MCP、聊天history；没有已核来源事实查询/时间状态投影闭环','active_memory_search.parse/date/rank/format与user_profile_policy生命周期/整条事实预算',['DM-P03','DM-P04','DM-P05','DM-P06'],['DM-N07','DM-C03'],'没有真实召回准确率/覆盖率AB；非法中文月日抛异常；05:00日界/老化天数是原项目政策，不证明适合Aimy','日期非法输入先转受控拒绝；中文真实语料/时区边界/不相关沉默质量对照后再定权重与天数',mem)
add('AH-R04','仅工程方法/失败经验；不是候选已实现的新增功能',['MEM-F01'],'移出产品功能短名单；保留删除验收输入','AIRI已有聊天删除tombstone/outbox，事实忘记是MEM-F01内部必要行为','旧DELETE/新关联删除/压缩复活的反例及删除契约；不复用删除业务实现',[],['DM-C01','DM-C05'],'“彻底忘记的派生清理契约”不是AionsHome已正确实现的功能；现反例证明不能整体称更强','只保留工程负例，不能按一个独立增强功能计数',mem)
add('AH-R05','候选存在领域新增，但完整性/收益未证',['MEM-F01'],'后置研究；不进入当前已证增强短名单','AIRI有history-block裁剪/计数summary；缺少已核事实压缩lineage，但不代表该候选质量已胜出','CalendarPlanner/lineage短引用规则；事务应用与索引需重做',[],[],'本DELTA无该候选正例执行；先前当前源码已有删除during-model复活反例；长期压缩损失与性能未AB','先建立可靠事实/删除，再做无膨胀、删改竞态、信息保真度对照',mem)
add('AH-R06','部分真实新增：持久follow-up策略；AIRI通知基础已有',['PRO-F01'],'保留持久续聊为条件增强；原消费器因禁用漏洞不直接采用','AIRI已有Spark Agent、2秒tick、内存task/notify重排；不重复统计主动Agent/播放器','NEXT_CHAT有界决定、SQLite timer持久/单领/新用户清待计时语义；AIRI实现持久策略adapter',['DM-P07','DM-P08'],['DM-N08','DM-C04'],'禁用后旧timer仍可claim；没执行_fire_monitor、真实模型或设备；持久timer不证明时机自然/成本更低','关开关/新输入/隐藏/切会话/重启/在飞结果先正确，之后真实模型自然度/打扰AB',notify)
add('AH-R07','效果假设；已有能力组合与策略变体',['MEM-F02','PRO-F01'],'并入主动回忆实验，不重复计数，不复制15动作系统','AIRI有notify/角色反应，但缺少事实记忆；“随机读旧日再聊天”是选择策略','memory_browse选择日期→摘要→私聊/日记的行为假设；只保留本地回忆/沉默候选',[],[],'本DELTA未运行该3阶段模型流程；随机回忆不证明比按相关性召回更合适/不打扰','在MEM-F01/F02及PRO-F01成立后单因素策略对照',mem+notify)
add('AH-R08','窄源码差异；效果未证；不是另一套语音产品能力',[],'不进入本轮记忆功能短名单；语音专项可保留验证叶子假设','AIRI已有TTS/打断/SSML pitch-rate-volume；语音能力不可重复统计','expressive_voice.validate_directed_text的台词校验/白名单规则可能可适配，导演效果待测',[],[],'未在本DELTA验证该叶子；标点等价校验不等于含义完全不变；音色/情绪收益未AB','只有真实确定台词/音色缺口才做有界语音专项对照',voice)
add('AH-R09','AIRI已有；候选未证更强',[],'不选','AIRI已有VAD/ASR/streaming TTS/turn interrupt/取消回执','不导入第二音频队列、播放器、半双工唤醒',[],[],'Aions半双工不构成AIRI连续打断升级；没有延迟/顺序/回声真实AB','除非以后明确测得单一缺口，否则不复用',voice)
add('AH-R10','AIRI已有范式；未AB的阈值',[],'由“可直接复用”降为不选；可读性或17行小不是产品优势','AIRI已有silence/onset/echo gate与turn定向interrupt','仅800/1200ms阈值和adapter guard，无新产品能力',[],[],'不能以纯JS可搬运宣称更强；没有中文误打断/延迟AB','已测出缺口后再选阈值，当前不进功能短名单',voice)
add('AH-R11','仅工程保护/失败上下文参考',[],'移出功能短名单，保留基线修复参考','AIRI已有屏幕源、capturedAt/sourceId、推理queue/context，晚结果保护是工程缺陷修补','图像来源/失败说明/新鲜度约束；不复制camera/activity采集',[],[],'不能把采集链或防陈旧规则另算新看屏功能；没有正确率/费用AB','AIRI基线保护按自己缺陷修复；不称候选新增产品收益',vision)
add('AH-R12','工程方法；原自动人设变更的产品收益未证',[],'移出功能短名单；保留审阅diff/回滚参考','AIRI已有角色卡与编辑；自主改核心身份/边界并非已确认需求','before/after/diff、反馈去重属于工程参考，不采用模型自由改身份/安全边界',[],[],'没有人格稳定/关系体验AB；把原不受控演化改成建议又不应宣称复用了成熟人格成长功能','真实产品需求另定，当前不按新功能立项',mem)
add('AH-R13','部分领域新增但超当前产品范围',[],'不纳入','AIRI多角色卡不等于Aions双AI群聊/Visitor Lounge；二者不是完全重复','不纳入多AI轮次、访客身份服务',[],[],'功能不同不等于当前更有价值；无隔离/预算/体验整体验收','主要单角色边界内不列功能短名单',notify)
add('AH-R14','混合：已有工具/超范围新业务/未证实现',[],'不纳入，不把大包泛称增强','AIRI已有HomeAssistant/工具/游戏生态；阅读/生活/外设等是不同业务范围','不引入基金、定位、家居、购物、外发、Android或成人设备系统',[],[],'不能把竞品功能多计为整体强；本轮没有逐项业务AB','真实需求逐项另研究；当前全部不列功能短名单',vision)
add('AH-R15','完整工程运行时；不是可比较产品功能',[],'拒整体迁入','AIRI桌面/chat/audio/provider/存储主链已有','不复用FastAPI/原生JS/Windows配置整体；语言差异不是法律禁止',[],[],'整体可运行/跨语言可嵌不证明缺口收益；增加第二状态权威','不需要新增运行时来承载已筛的少数能力',mem+notify)
add('KI01','仅工程抽象；本DELTA未独立复核Kirara源码',[],'移出功能短名单','AIRI已有上下文/历史/Provider抽象；用户缺的是有依据事实能力，不是composer/decomposer类名','scope/composer/decomposer仅作为设计可读性参考，不搬manager/持久化',[],[],'当前JSON也注明隔离缺陷；未做可感知功能或质量AB，不能因架构精巧说更强','不作为本期功能选择；无需为被排除的工程抽象额外安装运行',mem)
meta={'date':'2026-10-14','status':'按用户最新“仅AIRI缺少/确有优势”目的重审；未改产品代码','scope':'AH-R01..15 + KI01；Chromatic不进入本DELTA','evidence_policy':'源码存在、隔离真实函数执行、真实模型AB、用户体验分别标记；源码护栏不是多个产品功能','source_selection_json_sha256':hashlib.sha256(selection.read_bytes()).hexdigest(),'source_reuse_json_sha256':hashlib.sha256(summary.read_bytes()).hexdigest(),'airi_baseline_json_sha256':hashlib.sha256(baseline.read_bytes()).hexdigest(),'candidate_count':len(rows),'candidates':rows}
(O/'candidate-delta.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2))
slices=[
 {'slice_id':'MEM-F01','user_function':'自动形成可管理、可追溯的跨会话当前事实记忆','candidate_ids':['AH-R01','AH-R02'],'engineering_reference_ids':['AH-R04'],'not_separate_features':['source IDs','revision/epoch','删除屏障','来源UI','索引失效'],'airi_gap':'当前主桌面已核路径缺少自动事实提取/当前版本/来源纠正闭环；history/notebook/compaction不冒充事实记忆','source_implementation':'post_sentinel自动job/共享画像与memory_library原子记录CRUD，二者在来源项目仍是不同数据链；Aimy应归一个能力与事实权威','positive_test_ids':['DM-P01','DM-P02','DM-P09','DM-P10'],'negative_test_ids':['DM-N01','DM-N02','DM-N03','DM-N04','DM-N05','DM-N06','DM-N09'],'counterexample_ids':['DM-C01','DM-C02','DM-C05'],'current_verdict':'真实新增功能可列短名单；原实现不直接采用；局部规则可改写适配，质量与彻底忘记尚未证明'},
 {'slice_id':'MEM-F02','user_function':'按来源、时间与当前状态想起相关事实，允许自然提起与沉默','candidate_ids':['AH-R03'],'supporting_candidate_ids':['AH-R01','AH-R07'],'airi_gap':'已核主桌面无事实级时间/当前状态召回；已有MCP/tools/context不重复算新能力','positive_test_ids':['DM-P03','DM-P04','DM-P05','DM-P06'],'negative_test_ids':['DM-N07'],'counterexample_ids':['DM-C03'],'current_verdict':'确定性时间/rank/证据预算真实可执行；真实召回质量和自然主动提起仍是假设，策略需实际模型AB'},
 {'slice_id':'PRO-F01','user_function':'用户授权后在适当时刻续聊，跨进程保存待续聊意图','candidate_ids':['AH-R06'],'supporting_candidate_ids':['AH-R07'],'airi_gap':'AIRI已有内存notify/task；缺的是持久follow-up与专属陪伴策略，不是Agent/播放器','positive_test_ids':['DM-P07','DM-P08'],'negative_test_ids':['DM-N08'],'counterexample_ids':['DM-C04'],'current_verdict':'持久规则是窄新增；原禁用缺陷未修，不可称整套正确；自然度/打扰/成本收益未AB'}]
(O/'functional-slices.json').write_text(json.dumps({'status':'3个去重功能slice；不是16个新增功能，第三个为带阻断条件的候选','slices':slices},ensure_ascii=False,indent=2))
# Evidence anchors must exist and be in range; reject hashes for out-of-read-scope source.
checked=0
for row in rows:
 for e in row['source_evidence']+row['airi_evidence']:
  if e.get('sha256'):
   p=Path(e['path']);assert 1<=e['line']<=len(p.read_text(errors='replace').splitlines());checked+=1
print(json.dumps({'candidates':len(rows),'slices':len(slices),'source_anchors_hashed_and_checked':checked,'results_counts':json.loads((O/'results.json').read_text())['counts']},ensure_ascii=False))
