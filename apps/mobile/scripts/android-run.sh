#!/usr/bin/env bash
# Build and run the Android app, re-applying app.config.ts to android/ first.
#
# `expo run:android` only prebuilds when android/ is missing (ensureNativeProjectAsync
# in @expo/cli): when the directory already exists it returns early and config
# plugins are never re-applied. Everything driven by app.config.ts — android.package,
# versionCode, the adaptive icon, the permissions expo-image-picker strips, the
# status-bar style — then stays frozen at whatever the first prebuild produced,
# while the Gradle build still reports success.
#
# android/ is gitignored and fully generated, so prebuilding on every run is safe
# and idempotent. --no-install is fine because Android prebuild has no pod step:
# it only skips the dependency re-check, and dependencies come from the workspace
# install. --clean is deliberately avoided — it wipes the native directory and
# makes Gradle redo work the incremental build skips, far too slow for the normal
# edit/run loop.
#
# APP_ENV and the .env file are supplied by the calling package.json script, so
# prebuild and run resolve the same variant. Arguments are forwarded to
# run:android only — prebuild takes the same flags for every variant.
#
# Two host requirements are read by Gradle, not set here, because both are
# machine-specific: JAVA_HOME must point at JDK 21 (the default JDK 25 makes
# Gradle fail while resolving the foojay toolchain) and ANDROID_HOME at the SDK
# (Gradle does not probe for it). See README.md > Android.
set -euo pipefail

pnpm exec expo prebuild -p android --no-install
exec pnpm exec expo run:android "$@"
