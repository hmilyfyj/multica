#!/usr/bin/env bash
# Build a distributable, signed Android artifact for one APP_ENV variant.
#
#   android-release.sh [--format apk|aab]
#
# APK (assembleRelease) is the side-loadable artifact handed to a phone; AAB
# (bundleRelease) is the Play upload format kept working for later. Both come out
# of the same signed release build type; neither installs anything or needs a
# device, so this script is also what a CI job would call.
#
# The variant comes from APP_ENV, exactly as it does for the run scripts, and it
# decides the application id (app.config.ts): com.ehaier.zgq.shop.mall.dev /
# .staging / com.ehaier.zgq.shop.mall. All three can sit on one device.
#
# Two host requirements are read by Gradle, not set here, because both are
# machine-specific: JAVA_HOME must point at JDK 21 and ANDROID_HOME at the SDK.
# See README.md > Android.
#
# `expo prebuild` runs first for the same reason scripts/android-run.sh does it:
# run:android and the Gradle tasks alike operate on android/, and when that
# directory already exists @expo/cli skips prebuild entirely, freezing everything
# app.config.ts owns (applicationId, versionCode, config plugins — including the
# release signing block this repo adds). android/ is gitignored and fully
# generated, so regenerating it every build is safe and idempotent.
#
# The keystore check below is deliberately strict, while the config plugin stays
# permissive when the key is absent: the plugin also runs on debug prebuilds and
# must not break them, but a *distributable* artifact signed with the debug key is
# worthless (nobody can tell, and the debug key is public). So this script refuses
# to start until it knows which key the artifact will carry.
set -euo pipefail

format=apk
while [ $# -gt 0 ]; do
  case "$1" in
    --format)
      format=${2:-}
      [ -n "$format" ] || {
        echo "android-release: --format needs a value (apk|aab)" >&2
        exit 2
      }
      shift 2
      ;;
    --format=*) format=${1#--format=}; shift ;;
    -h | --help)
      echo "usage: android-release.sh [--format apk|aab]"
      exit 0
      ;;
    *)
      echo "android-release: unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

case "$format" in
  apk)
    gradle_task=assembleRelease
    built=android/app/build/outputs/apk/release/app-release.apk
    ;;
  aab)
    gradle_task=bundleRelease
    built=android/app/build/outputs/bundle/release/app-release.aab
    ;;
  *)
    echo "android-release: --format must be apk or aab, got '$format'" >&2
    exit 2
    ;;
esac

variant=${APP_ENV:-dev}
properties_path=${MULTICA_ANDROID_KEYSTORE_PROPERTIES:-$HOME/.multica-android/keystore.properties}
if [ ! -f "$properties_path" ]; then
  cat >&2 <<EOF
android-release: no release keystore at $properties_path

  自用密钥（一条命令生成，仓库之外）：
    pnpm android:mobile:keystore
  团队已有密钥：
    MULTICA_ANDROID_KEYSTORE_PROPERTIES=/path/to/keystore.properties pnpm android:mobile:dist

  不用密钥也能构建（release 会退回 debug 签名，只能自用不能分发）：
    pnpm android:mobile:device:prod:release
EOF
  exit 1
fi

# The package id, version and versionCode that name the artifact are read from the
# resolved Expo config rather than from package.json or a literal: it is the same
# config prebuild writes into the generated Gradle project, so an artifact can
# never be labelled with a package it does not actually contain.
config_file=$(mktemp "${TMPDIR:-/tmp}/multica-android-config.XXXXXX")
trap 'rm -f "$config_file"' EXIT
pnpm exec expo config --type public --json >"$config_file"
read -r app_package app_version app_version_code < <(node -e '
const config = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
const fields = [config.android?.package, config.version, config.android?.versionCode];
if (fields.some((field) => field === undefined)) {
  process.exit(1);
}
process.stdout.write(fields.join(" "));
' "$config_file") || true

if [ -z "${app_package:-}" ] || [ -z "${app_version:-}" ] || [ -z "${app_version_code:-}" ]; then
  echo "android-release: could not read android.package / version / android.versionCode from the Expo config" >&2
  exit 1
fi

echo "android-release: $format for '$variant' → $app_package $app_version (versionCode $app_version_code)" >&2
pnpm exec expo prebuild -p android --no-install

# `java_home -v 21` silently resolves to a newer JDK when 21 is not registered
# with it; the native CMake configure then fails with an opaque message. Say so
# before Gradle spends minutes getting there.
if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ]; then
  java_major=$("$JAVA_HOME/bin/java" -version 2>&1 | sed -n '1s/.*version "\([0-9]*\).*/\1/p')
  if [ -n "$java_major" ] && [ "$java_major" != "21" ]; then
    echo "android-release: JAVA_HOME points at JDK $java_major, not 21 — native CMake configure may fail; see README > Android" >&2
  fi
fi

(cd android && ./gradlew "$gradle_task")

if [ ! -f "$built" ]; then
  echo "android-release: $gradle_task finished but $built is missing" >&2
  exit 1
fi

# Release builds keep the template's four ABIs (scripts/android-run.sh narrows only
# debug builds), so one artifact installs on any phone or emulator. It is staged
# under dist/, which is gitignored, next to the variant it was built for.
out_dir=dist/android
out="$out_dir/multica-mobile-$variant-$app_version-vc$app_version_code.$format"
mkdir -p "$out_dir"
cp "$built" "$out"

if command -v shasum >/dev/null 2>&1; then
  sha256=$(shasum -a 256 "$out" | awk '{print $1}')
else
  sha256=$(sha256sum "$out" | awk '{print $1}')
fi

echo "android-release: 产物已就绪 → $out"
echo "  package   $app_package"
echo "  version   $app_version (versionCode $app_version_code)"
echo "  size      $(du -h "$out" | cut -f1 | tr -d '[:space:]')"
echo "  sha256    $sha256"
case "$format" in
  apk) echo "  安装      adb install -r $out" ;;
  aab) echo "  AAB 不能直接安装：经 Play 上传，或 bundletool 转 APK 后再装" ;;
esac
