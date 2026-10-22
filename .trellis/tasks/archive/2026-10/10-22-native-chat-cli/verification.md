Validation on 2026-10-22, against main f27d5dfbf:

- `go test ./cmd/multica -run TestNativeChat -count=1`: passed.
- `env -u MULTICA_TASK_CONFIG_ROOT go test -race ./cmd/multica -run TestNativeChat -count=1`: passed. Covers all five native commands plus invalid input boundaries.
- `go build -o bin/multica-native-chat ./cmd/multica`: passed; the built CLI exposes all five session commands.
- `git diff --check`: passed.
- `make test`: attempted in the managed, isolated `multica_multica_33` database environment; failed. First run inherited task configuration variables. A second run without inherited `MULTICA_*` variables passed internal/cli and the handler suite, but cmd/multica tests still discover the actual ancestor `.multica/daemon_task_context.json` and reject fake non-task credentials. internal/daemon also failed `TestStartDshProfileProvision_RunsAtMostOnce` during TempDir cleanup (`directory not empty`). The untouched legacy tests and runtime guards were not changed to hide these failures. The agent-package half does not run when the regular half fails.

The dependent bridge change passes `pnpm ci:local`: 791 tests passed, two intentionally skipped; typecheck and production build passed. It includes native startup/restart, authorized document routing, task-correlated replies, persistence and ambiguous-write recovery tests. No real model, production Multica session, Feishu event or comment send was used. Native visibility relies on the existing CreateChatSession handler marking sessions explicitly created; no alternate storage path is introduced.
