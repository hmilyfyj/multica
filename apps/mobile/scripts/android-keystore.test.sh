#!/usr/bin/env bash
# Tests for scripts/android-keystore.sh.
#
# The script's whole job is where files land, what they contain and what it
# refuses to do, so the assertions are about the filesystem and the properties
# file — plus the keytool invocation, which is stubbed so no JDK is needed and so
# the test can see the exact flags. Every case runs against a throwaway
# MULTICA_ANDROID_KEYSTORE_PROPERTIES path, so a real ~/.multica-android is never
# touched.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TEST_DIR=$(mktemp -d "${TMPDIR:-/tmp}/multica-android-keystore.XXXXXX")
BIN_DIR="$TEST_DIR/bin"
CALLS_FILE="$TEST_DIR/keytool-calls.log"

cleanup() {
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT

mkdir -p "$BIN_DIR"
export MULTICA_TEST_KEYTOOL_CALLS="$CALLS_FILE"

# Stub keytool: record the arguments and create the file it was told to write, the
# way the real tool leaves a keystore behind.
cat >"$BIN_DIR/keytool" <<'EOF'
#!/usr/bin/env bash
set -eu
echo "$*" >>"$MULTICA_TEST_KEYTOOL_CALLS"
keystore=
while [ $# -gt 0 ]; do
  case "$1" in
    -keystore)
      keystore=$2
      shift 2
      ;;
    *) shift ;;
  esac
done
[ -n "$keystore" ] || exit 1
: >"$keystore"
EOF
chmod +x "$BIN_DIR/keytool"
PATH="$BIN_DIR:$PATH"
export PATH

fail() {
  echo "android-keystore.test.sh: $1" >&2
  exit 1
}

properties_value() {
  sed -n "s/^$2=//p" "$1"
}

permissions() {
  stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"
}

# --- a first run writes both files where the docs say -----------------------
case_dir="$TEST_DIR/first"
mkdir -p "$case_dir"
: >"$CALLS_FILE"
MULTICA_ANDROID_KEYSTORE_PROPERTIES="$case_dir/keystore.properties" "$SCRIPT_DIR/android-keystore.sh" >/dev/null 2>&1

properties="$case_dir/keystore.properties"
keystore="$case_dir/multica-release.keystore"
[ -f "$properties" ] || fail "the properties file should have been written"
[ -f "$keystore" ] || fail "the keystore should have been written next to the properties file"

[ "$(properties_value "$properties" storeFile)" = "$keystore" ] ||
  fail "storeFile must be the absolute keystore path, got: $(properties_value "$properties" storeFile)"
[ "$(properties_value "$properties" keyAlias)" = 'multica-release' ] ||
  fail "keyAlias should be multica-release, got: $(properties_value "$properties" keyAlias)"

store_password=$(properties_value "$properties" storePassword)
key_password=$(properties_value "$properties" keyPassword)
[ -n "$store_password" ] || fail "storePassword must not be empty"
[ "$store_password" = "$key_password" ] ||
  fail "PKCS12 binds key and store passwords, so they must match"

[ "$(permissions "$properties")" = '600' ] || fail "the properties file must be 600, got $(permissions "$properties")"
[ "$(permissions "$keystore")" = '600' ] || fail "the keystore must be 600, got $(permissions "$keystore")"

grep -q -- '-genkeypair' "$CALLS_FILE" || fail "keytool should have been asked for a key pair"
grep -q -- '-alias multica-release' "$CALLS_FILE" || fail "keytool should use the documented alias"
grep -q -- '-keysize 2048' "$CALLS_FILE" || fail "keytool should generate an RSA 2048 key"
grep -q -- '-validity 10000' "$CALLS_FILE" || fail "keytool should generate a long-lived certificate"
grep -q -- "-storepass $store_password" "$CALLS_FILE" ||
  fail "the generated password should be the one keytool was called with"

# --- a second run keeps the existing key and says so ------------------------
: >"$CALLS_FILE"
set +e
MULTICA_ANDROID_KEYSTORE_PROPERTIES="$properties" "$SCRIPT_DIR/android-keystore.sh" >/dev/null 2>"$TEST_DIR/second.err"
status=$?
set -e

[ "$status" -ne 0 ] || fail "a second run must refuse to overwrite an existing keystore"
grep -q 'already exists' "$TEST_DIR/second.err" || fail "the refusal should say the files are being kept"
grep -q 'storePassword' "$TEST_DIR/second.err" || fail "the refusal should say how to read the password back"
[ ! -s "$CALLS_FILE" ] || fail "keytool must not run again when the key is kept"

# --- --force is the one way past it, and it rotates the password ------------
before_password=$(properties_value "$properties" storePassword)
: >"$CALLS_FILE"
MULTICA_ANDROID_KEYSTORE_PROPERTIES="$properties" "$SCRIPT_DIR/android-keystore.sh" --force >/dev/null 2>&1

[ -s "$CALLS_FILE" ] || fail "--force should regenerate the key"
after_password=$(properties_value "$properties" storePassword)
[ "$after_password" != "$before_password" ] || fail "--force should rotate the password"

# --- the properties path relocates both files -------------------------------
case_dir="$TEST_DIR/relocated"
mkdir -p "$case_dir"
MULTICA_ANDROID_KEYSTORE_PROPERTIES="$case_dir/nested/keys.properties" "$SCRIPT_DIR/android-keystore.sh" >/dev/null 2>&1

[ -f "$case_dir/nested/keys.properties" ] || fail "the properties file should honour the override"
[ -f "$case_dir/nested/multica-release.keystore" ] || fail "the keystore should follow the properties file"
[ "$(properties_value "$case_dir/nested/keys.properties" storeFile)" = "$case_dir/nested/multica-release.keystore" ] ||
  fail "storeFile must follow the relocated keystore"

# --- an unknown argument is rejected before anything is written -------------
case_dir="$TEST_DIR/unknown"
mkdir -p "$case_dir"
set +e
MULTICA_ANDROID_KEYSTORE_PROPERTIES="$case_dir/keystore.properties" "$SCRIPT_DIR/android-keystore.sh" --rotate >/dev/null 2>&1
status=$?
set -e

[ "$status" -eq 2 ] || fail "an unknown argument should exit 2, got $status"
[ ! -e "$case_dir/keystore.properties" ] || fail "nothing should be written for a rejected argument"

echo "android-keystore.test.sh: all assertions passed"
