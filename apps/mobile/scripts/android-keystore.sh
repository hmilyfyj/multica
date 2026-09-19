#!/usr/bin/env bash
# Create the Android release signing key this repository distributes with.
#
# The key must never live in the repository, and an Android application id can
# never change its signing key once a build of it has been published — so this
# script writes a self-use key OUTSIDE the tree, at
#
#   ${MULTICA_ANDROID_KEYSTORE_PROPERTIES:-$HOME/.multica-android/keystore.properties}
#
# next to it a PKCS12 keystore, and both at mode 600. `plugins/with-android-release-signing.js`
# reads that properties file at prebuild time and hands the values to Gradle; nothing
# else has to know where they are. Point MULTICA_ANDROID_KEYSTORE_PROPERTIES at a
# different path to use a key the team already owns (an upload key for a store
# release, for instance) — in that case do not run this script at all.
#
# The generated password is random and written into the properties file, which is
# the copy of record: read it back with
#
#   grep storePassword "$MULTICA_ANDROID_KEYSTORE_PROPERTIES"
#
# PKCS12 (the JDK 9+ default) binds the key password to the store password, so the
# two are deliberately the same value here. That keystore type is also why keytool
# needs `-storetype PKCS12` spelled out only on JDKs that predate the switch.
#
# Refusing to overwrite is the important behaviour: regenerating the key silently
# would orphan every APK already handed out (Android refuses to upgrade an install
# whose signature changed) and make any future store upload impossible. --force is
# there for the one legitimate case — a key that leaked before it was ever used.
set -euo pipefail

force=
while [ $# -gt 0 ]; do
  case "$1" in
    --force) force=1; shift ;;
    -h | --help)
      echo "usage: android-keystore.sh [--force]"
      exit 0
      ;;
    *)
      echo "android-keystore: unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

properties_path=${MULTICA_ANDROID_KEYSTORE_PROPERTIES:-$HOME/.multica-android/keystore.properties}
keystore_dir=$(dirname -- "$properties_path")
keystore_path="$keystore_dir/multica-release.keystore"
key_alias=multica-release

# A JDK is the only requirement, and JAVA_HOME is not set by default on macOS —
# fall back to whatever `keytool` is on PATH before giving up.
keytool=keytool
if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/keytool" ]; then
  keytool="$JAVA_HOME/bin/keytool"
elif ! command -v keytool >/dev/null 2>&1; then
  echo "android-keystore: no keytool found — install a JDK 21 and/or export JAVA_HOME; see README > Android" >&2
  exit 1
fi

if [ -z "$force" ]; then
  for existing in "$properties_path" "$keystore_path"; do
    if [ -e "$existing" ]; then
      echo "android-keystore: $existing already exists — keeping it." >&2
      echo "  当前口令：grep storePassword \"$properties_path\"" >&2
      echo "  确实要换一套密钥（会让已装机的旧包无法覆盖安装）再跑 --force" >&2
      exit 1
    fi
  done
fi

mkdir -p "$keystore_dir"
chmod 700 "$keystore_dir"

# /dev/urandom through od, so the password is hex — no quoting or escaping to get
# wrong in the properties file that Gradle parses.
password=$(od -An -tx1 -N16 /dev/urandom | tr -d ' \n')

"$keytool" -genkeypair \
  -keystore "$keystore_path" \
  -storetype PKCS12 \
  -alias "$key_alias" \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storepass "$password" \
  -keypass "$password" \
  -dname "CN=Multica Android Release, OU=Multica, O=Multica, L=Hangzhou, ST=Zhejiang, C=CN"

# The properties file is what the config plugin resolves, and it points at the
# keystore by absolute path so a build never depends on the caller's cwd.
umask 077
cat >"$properties_path" <<EOF
# Android release signing material for this repository — NOT in version control.
# Consumed by apps/mobile/plugins/with-android-release-signing.js at prebuild time;
# see apps/mobile/docs/android-distribution.md. Keep a backup: losing this file
# means no future build can upgrade an app already installed from these keys.
storeFile=$keystore_path
storePassword=$password
keyAlias=$key_alias
keyPassword=$password
EOF
chmod 600 "$properties_path" "$keystore_path"

echo "android-keystore: 已生成自用发布密钥"
echo "  keystore    $keystore_path"
echo "  properties  $properties_path  (chmod 600)"
echo "  口令获取    grep storePassword \"$properties_path\""
echo "  构建        pnpm android:mobile:dist:prod"
