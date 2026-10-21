# Charakuru 生产侧与AIRI同资产离线对照

2026-10-14。未选择正式角色格式，未生成联网角色/访问用户资产，未修改当前Blender场景或产品源码。

- `findings.md`：实现/工序边界、生产叶子、双loader真实功能、可/不可证明的增量。
- `source-manifest.json`：16项关键来源/指纹/阅读等级，真实依赖与执行边界。
- `blender-production-probe.py` / `blender-production-results.json` / `.log`：独立Blender5.2.1 factory进程跑原AST bounds/piece/join/restore_uv，正反例。
- `loader-compare.mjs` / `loader-results.json` / `loader-run.log`：真实AIRI useVRMLoader与Kit PreviewAvatar加载同合成GLB；真实happy/aa/blink影响；共同90帧CPU Spring比较与Kit原90帧多顶点验收；两个负例。
- `airi-loader.mjs`：AIRI原loader擦TS类型+解析到现有依赖的临时模块，产品源码未改。
- `minimal-no-face.vrm` / `authored-capabilities.vrm`：只有本地数学几何构造的fixture，不是Tripo/Kit生产成品，不代表用户角色或美术质量。旧`standard-like.vrm`为同一次测试早期名称的fixture，保留原字节，不能当真实标准产物。

重现：

```sh
node /tmp/aimy-20261014-remaining-charakuru/loader-compare.mjs
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python /tmp/aimy-20261014-remaining-charakuru/blender-production-probe.py
```

已安装Three/VRM库与Kit vendored库；未安装任何依赖。Node测试禁止网络、无GPU/Browser/Electron/音频。Blender只建临时内存几何/空白纹理，不打开用户Blend/donor，不渲染图片。完整生成/rig/weight/MToon-export链、VRM Add-on导出、真实角色/音色/外观/性能仍未验。
