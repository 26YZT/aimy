# 真实浏览器存储补证

2026-10-14。研究实验，产品未实施。固定输入见父批次fixtures.json中的LM01/03/07，原始消息/候选内容未改；clock固定2026-10-14T10:00:00+08:00。

真实运行AIRI `chatSessionsRepo`、原storage.ts和实际unstorage IndexedDB driver；Ryza原longterm.js与真实浏览器localStorage。用既有esbuild打包原模块，未改源文件/依赖，也未加载产品登录、同步、Provider、麦克风或屏幕模块。模型仅为固定JSON回调。

本次Ego TaskSpace53，仅访问新随机localhost origin `http://127.0.0.1:52442/`。未访问用户站点或已有数据库，未清浏览器profile。页面CSP限制网络为本origin，关闭设备权限。实际浏览器版本见write-immediate-read.json。TaskSpace和仅本实验HTTP进程均已关闭。

结果：

- 原聊天repo的IndexedDB保存/页面重建读回成功；Ryza固定事实localStorage保存/页面重建读回成功。
- 原deleteSession与LongTerm.remove在无在飞写入时删除成功，页面重建后仍为空。这是整个聊天记录与单条记忆两种不同对象，不能冒称逐事实删除同条件竞赛。
- Ryza LM03真实consolidate/merge在固定新偏好输出后仍保留旧、新两条active；LM07先删除、再让在飞consolidate返回旧条目，该条目又写回真实localStorage，页面重建后仍存在。

这里的重建是**同一浏览器进程内新页面JS realm**，每次ego脚本是新Node控制进程；不是新浏览器OS进程，也不是完整Electron重启。AIRI保存聊天成功不证明自动抽取/跨会话事实/逐事实纠正删除已完成；Ryza固定条目成功不证明真实模型抽取正确。原helper删除后session索引元数据未一起更新，本次没有把它当完整UI会话删除验收。

文件：build.cjs/entry.ts是原模块装配；serve.py仅在127.0.0.1随机端口提供静态合成页；browser-write/reload/delete/ryza-facts.mjs为四阶段调用，四份JSON保存原观察。source-manifest.json含原源码SHA与打包metafile；verification.json记录层次和边界。

重跑时使用新实验目录/随机端口、一个新TaskSpace，将脚本里的本次spaceId改为新的明确ID；先node build.cjs，再python3 -u serve.py，再ego-browser nodejs按上述四脚本顺序执行。不要复用用户origin或读取/清理用户数据。脚本的首次空数据断言应保持，不能为通过而清真实库。最终只finish当前实验空间并停止自己的server。
