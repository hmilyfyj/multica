# Android 阶段 5 收尾验收（真机/模拟器回归 + 未覆盖项 + 实时层复验）

## Goal

阶段 5 收尾：唯一一次设备会话。核心流程 10 段 + 548 键盘/返回/沉浸式清单在可用设备上复跑；补验图片查看器与聊天流式回复（先补夹具）；复验 559 两处修复（断网恢复秒级刷新、后端 WS client_os=android）。结果写回 apps/mobile/docs/android-regression-checklist.md，证据落本任务 research/。允许补夹具与验收脚本，不改业务代码。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
