#!/usr/bin/env bash
# Tests for scripts/android-release.sh.
#
# What matters here is the contract the distribution docs promise: the artifact
# is named and located where the docs say, it is named after the resolved Expo
# config rather than a literal, and the script refuses to build when it cannot
# know which signing key the artifact would carry. So pnpm, node's Expo config
# read and gradlew are stubbed (or, for node, fed a canned config) and the cases
# assert the call sequence, the staged file and the exit codes. No node_modules,
# no Android SDK, no device.
#
# Every case runs from a throwaway directory, so the assertions never touch a real
# apps/mobile/android/ tree or a real dist/.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TEST_DIR=$(mktemp -d "${TMPDIR:-/tmp}/multica-android-release.XXXXXX")
BIN_DIR="$TEST_DIR/bin"
CALLS_FILE="$TEST_DIR/pnpm-calls.log"
KEYSTORE_PROPS="$TEST_DIR/keystore.properties"

cleanup() {
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT

mkdir -p "$BIN_DIR"
export MULTICA_TEST_PNPM_CALLS="$CALLS_FILE"

# Stub pnpm: answer `expo config` with a canned resolved config (the real one is
# a function of APP_ENV, which the caller sets) and record everything else.
cat >"$BIN_DIR/pnpm" <<'EOF'
#!/usr/bin/env bash
set -eu
echo "$*" >>"$MULTICA_TEST_PNPM_CALLS"
if [ "${1:-}" = 'exec' ] && [ "${2:-}" = 'expo' ] && [ "${3:-}" = 'config' ]; then
  printf '%s' "$MULTICA_TEST_EXPO_CONFIG"
fi
EOF
chmod +x "$BIN_DIR/pnpm"
PATH="$BIN_DIR:$PATH"
export PATH
export MULTICA_TEST_EXPO_CONFIG='{"version":"0.1.0","android":{"package":"com.ehaier.zgq.shop.mall.staging","versionCode":7}}'

# A keystore properties file that exists but is never read by the script itself —
# its presence is the whole contract (the plugin, not this script, reads values).
printf 'storeFile=/tmp/does-not-need-to-exist.keystore\n' >"$KEYSTORE_PROPS"
export MULTICA_ANDROID_KEYSTORE_PROPERTIES="$KEYSTORE_PROPS"

# The build is driven through the generated project's own wrapper, so each case
# needs a stand-in android/ tree: gradlew records the task and leaves the artifact
# the script then stages. MULTICA_TEST_SKIP_ARTIFACT exercises the "Gradle said it
# succeeded but produced nothing" path.
write_gradlew() {
  mkdir -p android/app/build/outputs/apk/release android/app/build/outputs/bundle/release
  cat >android/gradlew <<'EOF'
#!/usr/bin/env bash
set -eu
echo "gradlew $*" >>"$MULTICA_TEST_PNPM_CALLS"
[ -n "${MULTICA_TEST_SKIP_ARTIFACT:-}" ] && exit 0
case "$1" in
  assembleRelease) : >app/build/outputs/apk/release/app-release.apk ;;
  bundleRelease) : >app/build/outputs/bundle/release/app-release.aab ;;
esac
EOF
chmod +x android/gradlew
}

fail() {
  echo "android-release.test.sh: $1" >&2
  exit 1
}

# --- no keystore: refuse before spending a prebuild -------------------------
case_dir="$TEST_DIR/no-keystore"
mkdir -p "$case_dir"
cd "$case_dir"
: >"$CALLS_FILE"
set +e
MULTICA_ANDROID_KEYSTORE_PROPERTIES="$case_dir/missing.properties" "$SCRIPT_DIR/android-release.sh" >/dev/null 2>"$TEST_DIR/no-keystore.err"
status=$?
set -e

[ "$status" -eq 1 ] || fail "a missing keystore should exit 1, got $status"
grep -q 'android:mobile:keystore' "$TEST_DIR/no-keystore.err" ||
  fail "the refusal should name the command that creates a key"
[ ! -s "$CALLS_FILE" ] || fail "nothing should be built without a known signing key"

# --- APK: prebuild then assembleRelease, staged under dist/ -----------------
case_dir="$TEST_DIR/apk"
mkdir -p "$case_dir"
cd "$case_dir"
write_gradlew
: >"$CALLS_FILE"
APP_ENV=staging "$SCRIPT_DIR/android-release.sh" >"$TEST_DIR/apk.out" 2>&1

[ "$(sed -n '1p' "$CALLS_FILE")" = 'exec expo config --type public --json' ] ||
  fail "the resolved config should be read first, got: $(sed -n '1p' "$CALLS_FILE")"
[ "$(sed -n '2p' "$CALLS_FILE")" = 'exec expo prebuild -p android --no-install' ] ||
  fail "prebuild should run before Gradle, got: $(sed -n '2p' "$CALLS_FILE")"
[ "$(sed -n '3p' "$CALLS_FILE")" = 'gradlew assembleRelease' ] ||
  fail "the release APK task should be assembleRelease, got: $(sed -n '3p' "$CALLS_FILE")"

artifact='dist/android/multica-mobile-staging-0.1.0-vc7.apk'
[ -f "$artifact" ] || fail "the APK should be staged at $artifact"
grep -q "com.ehaier.zgq.shop.mall.staging" "$TEST_DIR/apk.out" ||
  fail "the summary should print the package the artifact actually carries"
grep -q "$artifact" "$TEST_DIR/apk.out" || fail "the summary should print the staged path"
grep -q 'sha256' "$TEST_DIR/apk.out" || fail "the summary should print a checksum for hand-off"
grep -q "adb install -r $artifact" "$TEST_DIR/apk.out" || fail "the summary should print the install command"

# --- AAB: same flow, bundleRelease, .aab name -------------------------------
case_dir="$TEST_DIR/aab"
mkdir -p "$case_dir"
cd "$case_dir"
write_gradlew
: >"$CALLS_FILE"
APP_ENV=production "$SCRIPT_DIR/android-release.sh" --format aab >"$TEST_DIR/aab.out" 2>&1

[ "$(sed -n '3p' "$CALLS_FILE")" = 'gradlew bundleRelease' ] ||
  fail "the AAB task should be bundleRelease, got: $(sed -n '3p' "$CALLS_FILE")"
[ -f 'dist/android/multica-mobile-production-0.1.0-vc7.aab' ] ||
  fail "the AAB should be staged with the production variant in the name"
grep -q 'adb install' "$TEST_DIR/aab.out" && fail "an AAB is not installed with adb install"

# --- the dev variant is the default when APP_ENV is unset -------------------
case_dir="$TEST_DIR/default-variant"
mkdir -p "$case_dir"
cd "$case_dir"
write_gradlew
env -u APP_ENV "$SCRIPT_DIR/android-release.sh" >/dev/null 2>&1

[ -f 'dist/android/multica-mobile-dev-0.1.0-vc7.apk' ] ||
  fail "an unset APP_ENV should produce the dev artifact name"

# --- a rejected --format builds nothing -------------------------------------
case_dir="$TEST_DIR/bad-format"
mkdir -p "$case_dir"
cd "$case_dir"
write_gradlew
: >"$CALLS_FILE"
set +e
"$SCRIPT_DIR/android-release.sh" --format ipa >/dev/null 2>&1
status=$?
set -e

[ "$status" -eq 2 ] || fail "an unsupported format should exit 2, got $status"
[ ! -s "$CALLS_FILE" ] || fail "an unsupported format must not start a build"

# --- Gradle succeeding without producing the artifact is an error -----------
case_dir="$TEST_DIR/no-artifact"
mkdir -p "$case_dir"
cd "$case_dir"
write_gradlew
set +e
MULTICA_TEST_SKIP_ARTIFACT=1 "$SCRIPT_DIR/android-release.sh" >/dev/null 2>"$TEST_DIR/no-artifact.err"
status=$?
set -e

[ "$status" -eq 1 ] || fail "a missing artifact should exit 1, got $status"
grep -q 'missing' "$TEST_DIR/no-artifact.err" || fail "the failure should name the missing artifact"
[ ! -e 'dist/android' ] || fail "nothing should be staged when the build produced no artifact"

# --- a failed Gradle build stages nothing -----------------------------------
case_dir="$TEST_DIR/gradle-fails"
mkdir -p "$case_dir"
cd "$case_dir"
write_gradlew
cat >android/gradlew <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
chmod +x android/gradlew
set +e
"$SCRIPT_DIR/android-release.sh" >/dev/null 2>&1
status=$?
set -e

[ "$status" -ne 0 ] || fail "a failed Gradle build should fail the script"
[ ! -e 'dist/android' ] || fail "a failed build must not stage a partial artifact"

echo "android-release.test.sh: all assertions passed"
