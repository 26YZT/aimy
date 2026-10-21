# Charakuru：同标准增量与实际离线对照

2026-10-14（Asia/Shanghai）。状态：生产侧来源审查+离线功能对照，不是选择VRM、不是真实角色制作/产品实施。唯一写入 `/tmp/aimy-20261014-remaining-charakuru/`；未改仓库、未操作当前Blender/MCP场景、未读用户项目或密钥、未安装依赖、未调用联网资产/模型/设备。

**结论：Charakuru比AIRI新增的是生产侧制作/检查流程，不是更强的角色运行时。此次实际执行了Blender生产叶子函数、双方真实VRM loader和CPU表情/口型/物理对照；没有证明Charakuru真实成品比AIRI已有资产更好。完整制作、正式角色绑定与外观仍未验。**

## 1. 固定来源与已读范围

- 发行包根：`/tmp/charakuru-extract/charakuru-1.0.4-2026-10-12T17-55-01-211Z/`，package version1.0.4。原ZIP SHA256仍为 `2438dff64e5573cd80bf8691c49713be96d4c46a4cd1dcce52108c4da83ba290`。
- 本轮全文读关键实现：`scripts/production.py`（271行）、`scripts/mtoon-export.py`（305行）、`public/preview-avatar.mjs`（93行）、`public/preview-gltf.mjs`（44行）、`public/spring-physics.mjs`（130行）、`server-production.mjs`（30行）、两个Tripo工作流/详细rig Skill。job wrapper/CLI/renderer更新为定向调用链阅读，不冒称全仓逐行审计。
- AIRI：实际 `stage-ui-three/src/composables/vrm/loader.ts`全文检查；对应renderer expression/spring更新、blink/expression代码定向复核。使用当前已安装 `@pixiv/three-vrm` / animation3.5.5，未安装或替换依赖。
- 指纹、阅读级别、真实函数列表见 `source-manifest.json`；测试脚本与合成资产均在本目录。现有本机Blender为5.2.1 LTS；factory进程中VRM add-on未启用，不据此断言机器完全未安装该插件。

## 2. 制作流程：代码已实现、工序指令与未验的区别

|制作环节|有何实际实现|只是流程/外部环节|相对AIRI的有效增量/证据|
|---|---|---|---|
|立绘到4方向参考与3D候选|应用保存图像/候选/项目与发起agent任务|图像生成与Tripo Studio Smart Mesh/UV/重贴图/rig由Skill规定浏览器/agent工序；不是Kit本地3D生成模型|**生产流程候选**；未执行远端生成，不称已完成一张图→可用角色|
|松散部件分析/分离/合并|production.py的bounds/imported/piece/analyze/prepare/join/assemble，以及job wrapper实际调用Blender|语义分组/部位判断仍是人工/agent目视，不能由组件大小自动推导角色解剖|已核AIRI主角色导入/运行链未提供这套DCC工序；本轮真实factory进程验证piece/join叶子与坏边界|
|UV/材质恢复|restore_uv按空间匹配/拓扑与4K纹理约束恢复原网格UV，拒变形/重网格/缺面；assemble使用返回结果|依赖正确Tripo返回FBX/贴图；完整头身流程未跑|生产侧明确实现；本轮原函数真实运行，原顶点保持、UV恢复0误差、坏拓扑拒绝|
|MToon与VRM输出|mtoon-export.py实际转换/纹理检查/临时导出inspect_vrm后replace；需VRM add-on与有效Humanoid|无addon就不能用普通“文件有.vrm后缀”替代导出；本轮未启用addon或完整export|源码实现，不是procedure-only；**本轮导出未验**。AIRI已有MToon运行支持，不能把导出工具算运行更强|
|权重/骨骼/Spring制作|transfer-weights/spring-setup脚本与server job有接线；标准rig走Tripo，详细marker路径Skill另选|依赖授权donor/制作Blend/真实网格；本轮没读donor/用户项目，也没跑权重或rig端到端|生产侧功能候选，不自动变成Aimy运行时依赖或正式资产选择|
|成品验证|PreviewAvatar是真实GLTF/VRM loader；verifySpringMotion加载成品几何并测90帧物理ON/OFF响应|数字检查不评价美术、人设一致、中文口型自然度、性能或授权|验证方法有增量；此次已跑真实loader/物理，不再只停在结构helper|

主要源码锚点：[production.py:53](/tmp/charakuru-extract/charakuru-1.0.4-2026-10-12T17-55-01-211Z/scripts/production.py:53)（piece）、[production.py:153](/tmp/charakuru-extract/charakuru-1.0.4-2026-10-12T17-55-01-211Z/scripts/production.py:153)（restore_uv）、[production.py:217](/tmp/charakuru-extract/charakuru-1.0.4-2026-10-12T17-55-01-211Z/scripts/production.py:217)（join/assemble）、[server-production.mjs:7](/tmp/charakuru-extract/charakuru-1.0.4-2026-10-12T17-55-01-211Z/server-production.mjs:7)（结果回包/pack）、[mtoon-export.py:94](/tmp/charakuru-extract/charakuru-1.0.4-2026-10-12T17-55-01-211Z/scripts/mtoon-export.py:94)（apply_mtoon）、[mtoon-export.py:218](/tmp/charakuru-extract/charakuru-1.0.4-2026-10-12T17-55-01-211Z/scripts/mtoon-export.py:218)（inspect_vrm/保存链）。具体函数精确行另由source-manifest符号表列出。

## 3. 真实Blender生产函数实验

先审production.py，**只抽取原始AST函数** `bounds/piece/join/restore_uv`，不执行原脚本CLI，不打开原工程。使用独立进程：

```sh
/Applications/Blender.app/Contents/MacOS/Blender \
 --background --factory-startup --disable-autoexec --python-exit-code 1 \
 --python /tmp/aimy-20261014-remaining-charakuru/blender-production-probe.py
```

全部输入是新建三角/四边形与内存空白4K纹理，未渲染/保存图片，也未加载真实角色/donor。当前用户Blender场景没有连接或修改。

|正反例|实际结果|
|---|---|
|原quad→piece完整组件|1个四边面与UV原样保留|
|两组件→join|合成2面网格，原网格不被改|
|piece只给半个面顶点|抛ValueError，拒不完整边界|
|返回网格平移/放大2倍并给新UV|restore_uv maxError=0，容差1.4142e-5；算scale=[.5,.5,1]，原顶点不变且UV正确迁移|
|返回triangle替代原quad|拒绝拓扑改变，未当修复成功|

结果是原生产函数在Blender5.2.1真实几何API上成立；不是“Tripo头身组装、完整权重、MToon/VRM导出全流程通过”。factory中VRM addon未启用，这些后续链保持未验，不安装依赖补全。

## 4. 同一合成VRM在AIRI与Kit实际loader对照

脚本 `loader-compare.mjs` 先审相关模块，再把**AIRI原useVRMLoader源码仅擦除TS类型/解析现有依赖位置**，保留其MToon/VRMLoaderPlugin/VRMAnimation注册；另一端直接使用Kit原 `PreviewAvatar` / `verifySpringMotion`。没有fake loader、fake expression manager或fake physics。网络fetch被禁止，全部GLB二进制与纹理/几何在本tmp/内存内。

实际库版本：AIRI Three revision185 / three-vrm3.5.5，Kit vendored Three revision170；没有据此替换任一库。同资产数值相同不证明所有版本/渲染兼容。

输入不是Charakuru生成的正式模型，而是为反例构造的同一小GLB：

- `minimal-no-face.vrm`（2436字节）：有Humanoid/三角形/MToon，为缺能力反例不放expressions/LookAt/Spring。这只是最小fixture；Kit标准工艺确实制作Spring，不能据本fixture说标准产物无物理。
- `authored-capabilities.vrm`（4160字节）：同一结构再显式加入happy/aa/blink实际morph targets、eye bones/LookAt和一条带尾节点Spring。

|资产/能力|AIRI实际loader|Kit实际PreviewAvatar|
|---|---|---|
|minimal-no-face载入|成功，Humanoid+MToon|成功，Humanoid+MToon|
|minimal-no-face表情/口型/视线/物理|无这些目标/扩展；set aa不产生morph|同样无目标，不会自动补出|
|authored载入|成功，识别happy/aa/blink、LookAt、1有效Spring joint|同样成功/识别|
|authored实际happy/aa/blink驱动|逐项setValue(1)+update，真实morph对应权重0→1|同样0→1|
|同一资产同一90帧输入/物理ON-OFF|骨角响应1.2360521571 rad；采样顶点位移0.1158814917|数值相同至浮点误差|

对照确认：**能力来自资产绑定+已有VRM驱动，两方都能消费；不能从Kit的制作流程推出它运行时表情/口型/物理更强。** 无目标模型能导入，却不能因此叫“会笑/会说/会看”。rich fixture是人为加入的能力，不是Kit标准制作自动产出这些能力的证明。

AIRI已有真实消费接线：[loader.ts:107](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui-three/src/composables/vrm/loader.ts:107)（useVRMLoader）、[VRMModel.vue:514](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui-three/src/components/Model/VRMModel.vue:514)（expression更新/520 Spring更新）、[animation.ts:92](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui-three/src/composables/vrm/animation.ts:92)（blink）。本轮测试走loader/engine，未启动完整Electron/Vue/音频设备，故不是Aimy真实桌面呈现验收。

## 5. Kit原90帧验收与负例

另外直接运行 `public/spring-physics.mjs:68` 的原 `verifySpringMotion`，它会通过原PreviewAvatar加载同一rich fixture、检查受影响mesh、做物理ON/OFF 90帧：

- 1链/1有效joint；链最大物理角1.2360521571 rad。
- 原函数多顶点测得最大位移0.2317710024，阈值9.4600e-7，通过。
- 该多顶点数值与两方共同“首顶点”对照不同，不能混成同一指标；分别保留在JSON。
- 合法可载入但无Spring的asset，在plan声明必须有Spring时被拒。
- 带外部纹理URI的GLB被Kit原preflight拒绝，未发网络。

**比前轮更进一步的证据**：真实VRM loader、真实morph影响、真实CPU Spring与原Kit90帧验收已经执行，不仅是JSON结构helper。仍不能证明真实头发/衣服物理、形变美感、音素时序或用户喜好。

## 6. 仍不能证明的优势与裁决

|可证明|不可证明|
|---|---|
|Kit含AIRI运行器没有的DCC生产功能代码与明确agent工序|整个图像→Tripo→分件→rig/weights→VRM制作已在本机成功|
|生产piece/join/UV恢复叶子正反例成立|真实角色拓扑、比例、绑定、材质质量或生产效率/费用|
|原Kit成品90帧检查可实际运行；双方同资产都能驱动已有能力|Charakuru真实成品更自然、更省电、口型更好或优于AIRI原资产|
|最小缺目标fixture两边都不会自动补能力|所有Kit产物永远没表情，或用户不能明确要求另做这些能力|
|现有本地工具足以做受限离线检查，无需新下载/安装|正式格式必须VRM，或Live2D不可行|

当前建议：**保留为正式角色路线确定后的生产侧条件候选/验证方法，不新增Aimy运行时功能计数，不搬Kit/Blender/donor到主产品。** 如果将来确选此路线，正式资产验收须分别证明可加载、目标表情/口型/眨眼/视线/物理、真实表现协调、性能和用户外观认可。

Kit根README:162/AGENTS:45仍明确标准新制作是中性脸/固定视线，不擅自加入表情/瞳分离/LookAt。本轮也没有替用户作角色格式决定。Outputs/Kit/source artwork/donor/第三方素材的许可边界保持分别登记，合成fixture不带donor或示例角色资产；没有因为本试验给予真实素材清权结论。

## 7. 重现与保存

- `node /tmp/aimy-20261014-remaining-charakuru/loader-compare.mjs`。
- Blender命令见第3节。两个命令均只写本tmp，所有输出/失败记录见 `loader-run.log`、`blender-production.log`。
- `loader-results.json`含双方逐项结果、共同物理对照、Kit原90帧结果与负例；`blender-production-results.json`含原生产函数结果/Blender版本/sourceSHA。
- `source-manifest.json`记录来源/依赖版本、符号与SHA。测试使用TS擦类型、现有依赖与厂方实际loader；不复制修改AIRI产品文件。

未验项继续保持未验：远端生成/Tripo当前界面与计费、完整制作链、VRM add-on导出、真实资产/音色/语音时序、GPU/浏览器/完整Electron体验、VRMA、模型美术/授权及真实性能。
