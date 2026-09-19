# Android 阶段 5 收尾验收（真机/模拟器回归 + 未覆盖项 + 实时层复验）

## Goal

阶段 5 收尾：唯一一次设备会话。核心流程 10 段 + 548 键盘/返回/沉浸式清单在可用设备上复跑；补验图片查看器与聊天流式回复（先补夹具）；复验 559 两处修复（断网恢复秒级刷新、后端 WS client_os=android）。结果写回 apps/mobile/docs/android-regression-checklist.md，证据落本任务 research/。允许补夹具与验收脚本，不改业务代码。

## Requirements

- 一次设备会话完成阶段 5 收尾验收：核心流程 10 段 + FEATURE-548 的键盘避让 / 返回路径 / edge-to-edge 三组交接清单
- 补验图片查看器与聊天流式回复（先用夹具补齐前置数据）
- 复验 FEATURE-559 的两处修复：断网恢复秒级刷新、后端 WS `client_os=android`
- 验收提速：Tier 1 冒烟门禁（可随手跑，<5 分钟）+ Tier 2 完整矩阵（68 条判据，需明确授权才跑）
- 结果写回 `apps/mobile/docs/android-regression-checklist.md`，证据落本任务 `research/`
- 允许补夹具与验收脚本，**不改业务代码**

## Acceptance Criteria

- [x] 设备会话记录完整：`sdk_gphone64_arm64` / Android 15 (API 35) / staging Release 包（内嵌 JS，不连 Metro），见 `research/run/summary.txt`
- [x] 核心流程（登录、验证码、工作区、收件箱、详情、编辑、新建、聊天、设置、系统栏）在设备上跑通并留截图，见 `research/run/*.png`
- [x] FEATURE-548 三组交接清单（键盘避让 A、返回路径 B、edge-to-edge C）在设备上复核，清单 §2–§4 已标 ✅ 通过
- [x] 图片查看器与聊天流式回复补验，夹具与图片生成器落在 `research/seed-fixtures.sql`、`research/make-fixture-images.py`
- [x] FEATURE-559 复验：断网恢复自动刷新与 WS `client_os=android` 已在设备侧确认；新发现的 HTTP 头仍写死 `ios`（`data/api.ts:227`、`:1319`）作为**未修项**落档，见清单 §8.3
- [x] Tier 1 冒烟门禁 S1–S8 实测 294s（冷态），`research/smoke558.sh` 可重复执行；Tier 2 完整矩阵按授权边界停在授权前，清单已写明
- [x] 生产 Release APK 核验（装得上、起得来、品牌与签名正确），见 `research/release-check558.sh`
- [x] 未通过 / 未覆盖项逐条写明现象、根因与影响面（清单 §7、§8），真机数 0 与「单测不冒充真机验收」一并注明
- [x] 终稿由 #28 squash 合并进 `main`（`adb710d2f`）

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
