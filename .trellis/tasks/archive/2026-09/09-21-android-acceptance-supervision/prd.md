# Bound Android acceptance waits

## Goal

Supervise owned groups, preserve evidence, and stop stalled runs

## Requirements

- Add a bounded entry point around the archived FEATURE-558 runner without changing its assertions or historical evidence.
- Check device/Metro and explicit login/page/fixture readiness before a group; stop and preserve diagnosis if the environment is lost or results stall.
- Own only the launched child process group. Keep attempts separate; reuse passing checkpoints only for identical inputs and intact evidence.

## Acceptance Criteria

- [x] Exited children finish promptly; stalled children are terminated and recorded as blocked.
- [x] Empty output and failed assertions cannot pass because the shell exits zero.
- [x] Missing/changed evidence invalidates checkpoint reuse.
- [x] Six device-free tests pass; live Android verification was not performed.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
