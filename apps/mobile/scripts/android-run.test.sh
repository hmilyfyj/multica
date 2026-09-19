#!/usr/bin/env bash
# Tests for scripts/android-run.sh.
#
# The wrapper exists so that `expo prebuild` always runs before `expo run:android`
# (run:android skips prebuild whenever android/ already exists, freezing everything
# app.config.ts owns) and so that the freshly generated native project gets the
# ABI set of the install target instead of the template's four. These tests stub
# pnpm (which writes a stand-in android/gradle.properties) and adb on PATH, then
# assert the call sequence, the environment the expo calls see, and the ABI the
# generated project ends up with — no node_modules, no Android SDK, no device.
#
# Every case runs from a throwaway directory, so the assertions never touch a real
# apps/mobile/android/ tree.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TEST_DIR=$(mktemp -d "${TMPDIR:-/tmp}/multica-android-run.XXXXXX")
BIN_DIR="$TEST_DIR/bin"
CALLS_FILE="$TEST_DIR/pnpm-calls.log"
ENVS_FILE="$TEST_DIR/pnpm-envs.log"
STDERR_FILE="$TEST_DIR/script-stderr.log"
TEMPLATE_ABIS='armeabi-v7a,arm64-v8a,x86,x86_64'

cleanup() {
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT

mkdir -p "$BIN_DIR"
export MULTICA_TEST_PNPM_CALLS="$CALLS_FILE"
export MULTICA_TEST_PNPM_ENVS="$ENVS_FILE"

# Stub pnpm: record every invocation and the APP_ENV it saw; simulate what
# `expo prebuild -p android` leaves behind (android/gradle.properties with the
# template's ABI list); optionally fail the prebuild so the abort-before-run case
# can be exercised.
cat >"$BIN_DIR/pnpm" <<'EOF'
#!/usr/bin/env bash
set -eu

printf '%s\n' "$*" >>"$MULTICA_TEST_PNPM_CALLS"
printf '%s\n' "${APP_ENV:-unset}" >>"$MULTICA_TEST_PNPM_ENVS"

case "$*" in
  *prebuild*)
    if [ -n "${MULTICA_TEST_FAIL_PREBUILD:-}" ]; then
      echo "stub prebuild failure" >&2
      exit 1
    fi
    mkdir -p android
    if [ -z "${MULTICA_TEST_NO_ABI_LINE:-}" ]; then
      printf 'org.gradle.parallel=true\nreactNativeArchitectures=%s\nnewArchEnabled=true\n' \
        "$MULTICA_TEST_TEMPLATE_ABIS" >android/gradle.properties
    else
      printf 'org.gradle.parallel=true\nnewArchEnabled=true\n' >android/gradle.properties
    fi
    ;;
esac
EOF
chmod +x "$BIN_DIR/pnpm"

# Stub adb: one attached arm64-v8a device by default, a second one when asked,
# none at all when asked. The wrapper only reads `adb devices` and each target's
# `getprop ro.product.cpu.abi`.
cat >"$BIN_DIR/adb" <<'EOF'
#!/usr/bin/env bash
set -eu

case "$*" in
  devices*)
    printf 'List of devices attached\n'
    if [ -z "${MULTICA_TEST_ADB_NO_DEVICE:-}" ]; then
      printf 'emulator-5554\tdevice\n'
      if [ -n "${MULTICA_TEST_ADB_SECOND_ABI:-}" ]; then
        printf 'emulator-5556\tdevice\n'
      fi
    fi
    ;;
  *getprop*)
    case "$*" in
      *emulator-5556*) printf '%s\n' "$MULTICA_TEST_ADB_SECOND_ABI" ;;
      *) printf '%s\n' "${MULTICA_TEST_ADB_ABI:-arm64-v8a}" ;;
    esac
    ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$BIN_DIR/adb"

PATH="$BIN_DIR:$PATH"
export PATH
export MULTICA_TEST_TEMPLATE_ABIS="$TEMPLATE_ABIS"

# Every case runs in its own empty directory: the wrapper resolves android/ from
# the working directory, exactly as the package.json scripts do.
cd "$TEST_DIR"

fail() {
  echo "FAIL: $1" >&2
  echo "--- recorded calls ---" >&2
  cat "$CALLS_FILE" >&2 || true
  echo "--- generated android/gradle.properties ---" >&2
  cat android/gradle.properties >&2 || true
  echo "--- wrapper stderr ---" >&2
  cat "$STDERR_FILE" >&2 || true
  exit 1
}

run_wrapper() {
  : >"$STDERR_FILE"
  "$SCRIPT_DIR/android-run.sh" "$@" 2>>"$STDERR_FILE"
}

generated_abis() {
  sed -n 's/^reactNativeArchitectures=//p' android/gradle.properties 2>/dev/null
}

# --- prebuild runs before run:android ---------------------------------------
: >"$CALLS_FILE"
rm -rf android
run_wrapper

expected_prebuild='exec expo prebuild -p android --no-install'
[ "$(sed -n '1p' "$CALLS_FILE")" = "$expected_prebuild" ] ||
  fail "first call should be the prebuild, got: $(sed -n '1p' "$CALLS_FILE")"
[ "$(sed -n '2p' "$CALLS_FILE")" = 'exec expo run:android' ] ||
  fail "second call should be run:android, got: $(sed -n '2p' "$CALLS_FILE")"
[ "$(wc -l <"$CALLS_FILE")" -eq 2 ] || fail "expected exactly 2 calls"

# --- arguments forward to run:android only ----------------------------------
: >"$CALLS_FILE"
rm -rf android
run_wrapper --device --variant release

[ "$(sed -n '1p' "$CALLS_FILE")" = "$expected_prebuild" ] ||
  fail "prebuild must not receive run:android arguments"
[ "$(sed -n '2p' "$CALLS_FILE")" = 'exec expo run:android --device --variant release' ] ||
  fail "run:android should receive the forwarded arguments"

# --- the caller's APP_ENV reaches both expo calls ---------------------------
: >"$CALLS_FILE"
: >"$ENVS_FILE"
rm -rf android
APP_ENV=staging "$SCRIPT_DIR/android-run.sh" --device >/dev/null 2>&1

[ "$(sed -n '1p' "$ENVS_FILE")" = 'staging' ] ||
  fail "prebuild must see the caller's APP_ENV, got: $(sed -n '1p' "$ENVS_FILE")"
[ "$(sed -n '2p' "$ENVS_FILE")" = 'staging' ] ||
  fail "run:android must see the caller's APP_ENV, got: $(sed -n '2p' "$ENVS_FILE")"

# --- a debug build narrows the generated project to the attached device -----
: >"$CALLS_FILE"
rm -rf android
run_wrapper --device

[ "$(generated_abis)" = 'arm64-v8a' ] ||
  fail "the generated project should carry the attached device ABI, got: $(generated_abis)"
grep -q 'android-run: native ABIs = arm64-v8a' "$STDERR_FILE" ||
  fail "the wrapper should say which ABI set it wrote"

# --- two attached devices narrow to the sorted union of their ABIs ----------
rm -rf android
MULTICA_TEST_ADB_SECOND_ABI=x86_64 "$SCRIPT_DIR/android-run.sh" >/dev/null 2>>"$STDERR_FILE"

[ "$(generated_abis)" = 'arm64-v8a,x86_64' ] ||
  fail "both attached devices' ABIs should be kept, got: $(generated_abis)"

# --- a release build keeps the template's four-ABI default ------------------
rm -rf android
run_wrapper --device --variant release

[ "$(generated_abis)" = "$TEMPLATE_ABIS" ] ||
  fail "release builds must not narrow the ABI set, got: $(generated_abis)"

# --- MULTICA_ANDROID_ABIS=all restores the four-ABI default -----------------
rm -rf android
MULTICA_ANDROID_ABIS=all "$SCRIPT_DIR/android-run.sh" --device >/dev/null 2>>"$STDERR_FILE"

[ "$(generated_abis)" = "$TEMPLATE_ABIS" ] ||
  fail "MULTICA_ANDROID_ABIS=all must leave the ABI set alone, got: $(generated_abis)"

# --- an explicit ABI list wins ----------------------------------------------
rm -rf android
MULTICA_ANDROID_ABIS=arm64-v8a,armeabi-v7a "$SCRIPT_DIR/android-run.sh" --device >/dev/null 2>>"$STDERR_FILE"

[ "$(generated_abis)" = 'arm64-v8a,armeabi-v7a' ] ||
  fail "an explicit MULTICA_ANDROID_ABIS must be used verbatim, got: $(generated_abis)"

# --- with nothing attached the host architecture decides --------------------
case "$(uname -m)" in
  arm64 | aarch64) expected_host_abi='arm64-v8a' ;;
  x86_64 | amd64) expected_host_abi='x86_64' ;;
  *) expected_host_abi='' ;;
esac
if [ -n "$expected_host_abi" ]; then
  rm -rf android
  MULTICA_TEST_ADB_NO_DEVICE=1 "$SCRIPT_DIR/android-run.sh" >/dev/null 2>>"$STDERR_FILE"

  [ "$(generated_abis)" = "$expected_host_abi" ] ||
    fail "no attached device should fall back to the host ABI $expected_host_abi, got: $(generated_abis)"
fi

# --- a template without the ABI line is reported, not silently ignored ------
rm -rf android
MULTICA_TEST_NO_ABI_LINE=1 "$SCRIPT_DIR/android-run.sh" --device >/dev/null 2>>"$STDERR_FILE"

[ "$(generated_abis)" = '' ] ||
  fail "nothing should have been written to a template without the ABI line, got: $(generated_abis)"
grep -q 'no reactNativeArchitectures line to narrow' "$STDERR_FILE" ||
  fail "a missing reactNativeArchitectures line should be reported"

# --- a failed prebuild aborts before run:android ----------------------------
: >"$CALLS_FILE"
rm -rf android
set +e
MULTICA_TEST_FAIL_PREBUILD=1 "$SCRIPT_DIR/android-run.sh" >/dev/null 2>&1
status=$?
set -e

[ "$status" -ne 0 ] || fail "a failed prebuild should make the wrapper exit non-zero"
grep -q 'run:android' "$CALLS_FILE" &&
  fail "run:android must not run after a failed prebuild"

echo "android-run.test.sh: all assertions passed"
