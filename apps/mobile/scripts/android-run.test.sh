#!/usr/bin/env bash
# Tests for scripts/android-run.sh.
#
# The wrapper exists so that `expo prebuild` always runs before `expo run:android`
# (run:android skips prebuild whenever android/ already exists, freezing everything
# app.config.ts owns). These tests stub pnpm on PATH and assert the call sequence,
# so they need no node_modules, no Android SDK, and no device.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TEST_DIR=$(mktemp -d "${TMPDIR:-/tmp}/multica-android-run.XXXXXX")
BIN_DIR="$TEST_DIR/bin"
CALLS_FILE="$TEST_DIR/pnpm-calls.log"
ENVS_FILE="$TEST_DIR/pnpm-envs.log"

cleanup() {
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT

mkdir -p "$BIN_DIR"
export MULTICA_TEST_PNPM_CALLS="$CALLS_FILE"
export MULTICA_TEST_PNPM_ENVS="$ENVS_FILE"

# Stub pnpm: record every invocation and the APP_ENV it saw, and optionally fail
# the prebuild so the abort-before-run case can be exercised.
cat >"$BIN_DIR/pnpm" <<'EOF'
#!/usr/bin/env bash
set -eu

printf '%s\n' "$*" >>"$MULTICA_TEST_PNPM_CALLS"
printf '%s\n' "${APP_ENV:-unset}" >>"$MULTICA_TEST_PNPM_ENVS"

if [ -n "${MULTICA_TEST_FAIL_PREBUILD:-}" ]; then
  case "$*" in
    *prebuild*)
      echo "stub prebuild failure" >&2
      exit 1
      ;;
  esac
fi
EOF
chmod +x "$BIN_DIR/pnpm"

PATH="$BIN_DIR:$PATH"
export PATH

fail() {
  echo "FAIL: $1" >&2
  echo "--- recorded calls ---" >&2
  cat "$CALLS_FILE" >&2 || true
  exit 1
}

# --- prebuild runs before run:android ---------------------------------------
: >"$CALLS_FILE"
"$SCRIPT_DIR/android-run.sh"

expected_prebuild='exec expo prebuild -p android --no-install'
[ "$(sed -n '1p' "$CALLS_FILE")" = "$expected_prebuild" ] ||
  fail "first call should be the prebuild, got: $(sed -n '1p' "$CALLS_FILE")"
[ "$(sed -n '2p' "$CALLS_FILE")" = 'exec expo run:android' ] ||
  fail "second call should be run:android, got: $(sed -n '2p' "$CALLS_FILE")"
[ "$(wc -l <"$CALLS_FILE")" -eq 2 ] || fail "expected exactly 2 calls"

# --- arguments forward to run:android only ----------------------------------
: >"$CALLS_FILE"
"$SCRIPT_DIR/android-run.sh" --device --variant release

[ "$(sed -n '1p' "$CALLS_FILE")" = "$expected_prebuild" ] ||
  fail "prebuild must not receive run:android arguments"
[ "$(sed -n '2p' "$CALLS_FILE")" = 'exec expo run:android --device --variant release' ] ||
  fail "run:android should receive the forwarded arguments"

# --- the caller's APP_ENV reaches both expo calls ---------------------------
: >"$CALLS_FILE"
: >"$ENVS_FILE"
APP_ENV=staging "$SCRIPT_DIR/android-run.sh" --device

[ "$(sed -n '1p' "$ENVS_FILE")" = 'staging' ] ||
  fail "prebuild must see the caller's APP_ENV, got: $(sed -n '1p' "$ENVS_FILE")"
[ "$(sed -n '2p' "$ENVS_FILE")" = 'staging' ] ||
  fail "run:android must see the caller's APP_ENV, got: $(sed -n '2p' "$ENVS_FILE")"

# --- a failed prebuild aborts before run:android ----------------------------
: >"$CALLS_FILE"
set +e
MULTICA_TEST_FAIL_PREBUILD=1 "$SCRIPT_DIR/android-run.sh" >/dev/null 2>&1
status=$?
set -e

[ "$status" -ne 0 ] || fail "a failed prebuild should make the wrapper exit non-zero"
grep -q 'run:android' "$CALLS_FILE" &&
  fail "run:android must not run after a failed prebuild"

echo "android-run.test.sh: all assertions passed"
