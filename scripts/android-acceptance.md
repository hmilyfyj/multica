# Supervised Android acceptance

Use `python3 scripts/android-acceptance.py` for the FEATURE-558 archived runner instead of polling process names or running a fixed sleep loop. The runner still requires its documented fixture/backend environment; the supervisor does not create an environment, install an application, or certify visual correctness.

```sh
python3 scripts/android-acceptance.py \
  --runner .trellis/tasks/archive/2026-09/09-19-android-final-acceptance/research/acceptance558.sh \
  --out test-results/android-acceptance/build-123 \
  --serial emulator-5554 --package com.ehaier.zgq.shop.mall.staging \
  --groups b,v,e --input-key build-123-fixture-v2 \
  --ready-command /absolute/path/to/check-login-page-and-fixtures
```

The readiness command must check the installed application, required login/page and backend fixtures, return nonzero when unavailable, and must not mutate the UI during an active group. It receives `ANDROID_SERIAL`, `PKG`, and `ACCEPT_GROUPS`. It has a 30-second timeout. Device and Metro probes run before and during each group; they do not run UI dumps concurrently with the runner.

The supervisor records the exact child PID, elapsed time, idle time and runner output. No result growth for 120 seconds triggers a BLOCKED diagnosis and terminates only the owned process group. Each group has a separate 20-minute ceiling. Override these thresholds explicitly for a case with a longer legitimate SLA; do not globally reduce product timing assertions. Empty results or a zero shell exit with failed assertions are not success.

Each attempt has a unique evidence directory. `--resume` reuses only groups with passing results and identical runner scripts, device, selected groups, timeout settings, readiness command and input key. Change the input key whenever the installed build, readiness implementation, backend or fixtures change. Skipped groups do not recreate UI state: readiness must restore/verify the starting state needed by each remaining group. On blocked readiness/environment, fix it before resuming. Do not equate these checkpoints with fresh device verification.

The archived scripts can contain their own historical absolute paths; configure their documented environment and inspect them before use. The supervisor does not rewrite archived evidence or change their assertions.

Validation without devices: `python3 scripts/test_android_acceptance.py`.
