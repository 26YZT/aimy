# B 接入边界核验

## 已确认的接入路线

保留 AIRI 的包接口，使用精简的 Aimy 桌面 composition 与适配层。原 stage-tamagotchi 入口会装配插件、MCP、电脑操作、Godot和更新器；不能直接搬入一期壳。原 manifests 的桌面运行闭包34包、含dev41包；这些是声明闭包，不是最终最小产品闭包。

关键源证据：stage-ui/stores/chat.ts 与 chat/session-store.ts、database/storage.ts、stage-ui-three/ThreeScene、core-agent/chat-orchestrator-runtime、stage-tamagotchi/main/index.ts。

## C/D 前需要的实际边界

- BYOK凭证留在主进程/安全存储，renderer持非敏感ID与状态；原 provider-config 的localStorage与远程mutation需要local-only适配。
- 明确禁用全部工具来源：内置、MCP、debug、Spark、web search和active tools；只传 tools:[] 或隐藏按钮不足以禁用。
- 复用 core-agent 的真实生成取消；原UI cancel引用回复事件不能当作取消生成。
- 单VRM直接消费ThreeScene；不要为一个角色搬全部WidgetStage格式和云API类型。
- 原会话持久化以IndexedDB仓库为起点核验；settings/关系/记忆写入owner和恢复需独立验收。
- 现有 Electron out缺少renderer/index.html，不能把main/preload存在当成可启动完整桌面包。

## 连续语音与屏幕缺口

原桌面在角色说话时停止收听，结束后再抑制800ms；需要把有效VAD/用户插话接到LLM取消、TTS取消、播放队列清理，同时实测回声。不能简单删除抑制就宣布自然插话已完成。

原屏幕工作台默认3秒采样，忙时跳过，推理有60秒超时；stopTicker不等于取消正在推理的请求。Aimy已增加perception-gate：设备/provider必须使用lease.signal，异步推理完成后用同步lease.publish提交。关闭/隐藏后旧结果不能发布，恢复显示也不自动重开权限。该模块尚无实际设备适配消费者，不代表系统层采集已验收。

现有捕获 audio:false；没有已验证的游戏/视频系统音频理解链路。

## 视觉参考与资源

用户已确认沿AIRI角色呈现并先用示例。原型参考锁：角色主视觉、轻量聊天面板、清晰的看/听状态、直接的停止生成控制；保持角色空间，不采用营销页卡片布局。Refero MCP当前返回NO_SUBSCRIPTION，按技能使用已有AIRI界面/组件及bundled craft资料作为回退，不购买或升级服务、不生成图片。

## 服务探测入口

`packages/experience-lab`已实现并有26项实际SDK边界回归；根命令`pnpm --silent smoke:live`默认不执行。显式选择live和能力后，最多一次请求、无重试、禁止重定向、30秒截止；Vision/ASR需用户指定授权文件，输出只含安全统计。详见包README。连通性成功不等同实时语音/设备/质量通过。

## 尚未通过

真实LLM/Vision/ASR/TTS分段耗时、耳机/扬声器回声、真实插话、授权捕获/撤销、声音表现与用户体验仍待验。C桌面样机已实现，真实Electron/WebGL、默认mic/display拒绝、取消/恢复/清空有原生证据；这些不证明D实际采集或B自然语音已完成。用户尚未提供已配置服务能力；正式B出口不得用模拟数据替代。下一步用C样机评审并完成B真实实验，D/E按结论继续接入。
