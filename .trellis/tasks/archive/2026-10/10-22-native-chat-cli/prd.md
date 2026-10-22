# Native chat CLI for Feishu document bridge

## Goal

Expose native chat creation, reading and messaging through the authenticated CLI. Preserve existing history/thread commands; verify multiline input and HTTP contracts.

## Requirements

- Expose native session list/create/get/send/messages through the existing authenticated CLI client.
- Use normal session creation so sessions appear in the creator's conversation list.
- Preserve existing channel-scoped `chat history` and `chat thread` behavior.
- Accept multiline message files inside the working directory; never silently retry writes.

## Acceptance Criteria

- [x] HTTP contract tests cover workspace/auth headers, session creation, reading and message/task IDs.
- [x] Invalid UUIDs, empty text, conflicting input and external files fail before network writes.
- [x] Repository Go checks collected in the isolated managed database environment; environment-related failures are recorded in verification.md.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
