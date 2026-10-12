# T0.3 AIRI Core Agent Reuse Plan

> 文档状态：历史归档，不作为当前需求、技术选型或开工依据。
> 产物时期：2026-09-23，仅文件名；正文无独立日期。精确初稿时间未记录时保持未知。
> 保留原因：九包选择性vendoring计划，解释早期代码来源。
> 上下文风险：正文复选框与Task/步骤是旧指令，不是本轮执行授权；不得按计划重新复制包或改入口。
> 原位置：`digital-lover/docs/superpowers/plans/2026-09-23-t0-3-airi-core-agent.md`；归类整理：2026-10-11。
> 阅读入口：[文档中心](../../../README.md)。历史正文中的“当前、唯一、已锁定、下一步”仅适用于原时期。

> Scope: execute inline under the user's approval for T0.3. Do not edit `../airi-main`.

**Goal:** Vendor the smallest AIRI workspace dependency closure that lets aimy install and run the upstream `core-agent` test suite.

**Architecture:** Copy only `core-agent` and its eight transitive AIRI workspace dependencies into `packages/`, excluding generated `dist` and `node_modules`. Preserve upstream source/tests; resolve AIRI `catalog:` manifest aliases locally and add only the test entry needed to run core-agent tests from this standalone workspace.

**Tech Stack:** pnpm 11 workspace, TypeScript, Vitest.

**Spec:** `docs/任务编排.md` T0.3; `docs/00-架构裁决与底座说明.md`; `docs/01-AIRI复用与裁剪清单.md`.

## Global Constraints

- AIRI source at `../airi-main` is read-only.
- Do not change sibling projects or clear/commit existing parent-repository staging.
- Do not copy unrelated AIRI applications, services, or packages.
- Keep upstream core-agent source tests intact; distinguish mock tests from real model checks.
- Do not add model credentials; real model validation remains pending until M1.

---

### Task 1: Vendor the core-agent workspace dependency closure

**Files:**
- Create package directories under `packages/` for `core-agent`, `provider-inference`, `plugin-protocol`, `server-sdk`, `server-shared`, `stream-kit`, `pipelines-audio`, `audio`, and `better-ws`.
- Copy package manifests, source, package-local configs, tests, and licenses/readmes where present; exclude generated `dist` and `node_modules`.

- [ ] Copy upstream files without editing source files.
- [ ] Resolve each copied `catalog:` reference using the corresponding AIRI catalog version; retain workspace links only when their target is included.
- [ ] Confirm the copied workspace dependency graph has no missing internal package.

### Task 2: Make upstream core-agent tests runnable in aimy

**Files:**
- Modify `packages/core-agent/package.json` only for an explicit test script and the required Vitest dev dependency.

- [ ] Add a package test script that invokes the preserved `vitest.config.ts`.
- [ ] Run `pnpm install` and build the selected workspace dependencies in dependency order.
- [ ] Run core-agent tests and require the same 147 test cases as the verified AIRI baseline.

### Task 3: Record T0.3 evidence

**Files:**
- Modify root `README.md` with AIRI reuse/install/test instructions.
- Modify `docs/任务编排.md` only after the T0.3 DoD passes.

- [ ] Run clean-lockfile install, core-agent tests, and relevant typechecks.
- [ ] Mark T0.3 complete only if install and all 147 tests pass.
- [ ] Report real-model smoke as pending without a configured API key.
