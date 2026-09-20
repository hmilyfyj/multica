#!/usr/bin/env bash
# FEATURE-550 · 证明后台释放路径确实触发、且之后能重新建立高亮
#
# 用法: bash release-proof.sh <out-dir>
#
# 观测点（shiki.ts 的 __DEV__ 日志，只在 dev 构建里出现）：
#   "[shiki] initializing highlighter"             高亮器（重新）建立
#   "[shiki] released highlighter (backgrounded)"  后台释放
#
# 本脚本用**带时间戳的连续 logcat 抓取**（而不是每次 logcat -d），避免环形缓冲
# 淘汰早期行导致计数错乱；每一步同时打印动作时间点，便于把日志与动作对齐。
#
# 已实测的坑：
#   1. 裸 `am start -n .MainActivity` 会停在 expo-dev-client 的服务器列表页；
#      必须用 `exp+multica-mobile://expo-development-client/?url=...` 拉起。
#   2. dev-client 会记住上次用的 Metro（本机可能同时跑着别的任务在 8081/8082），
#      拉起后必须确认进入应用（底部 tab bar 存在），否则量到的是 launcher 或
#      别的任务的 bundle。
#   3. 本机可能瞬间 `device offline`（adb server 抖动），每步前先 wait-for-device。
set -uo pipefail

ADB_BIN="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
SERIAL="${ANDROID_SERIAL:-emulator-5554}"
PKG="${PKG:-ai.multica.mobile.dev}"
WS="${WS:-probe550}"
ISSUE="${ISSUE:-c3be9531-19ad-403c-9944-ed33c6c67f05}"
METRO_URL="${METRO_URL:-http%3A%2F%2F10.0.2.2%3A8083}"

adb_() { "$ADB_BIN" -s "$SERIAL" "$@"; }
adb_wait() { "$ADB_BIN" -s "$SERIAL" wait-for-device >/dev/null 2>&1; }

out="${1:?usage: release-proof.sh <out-dir>}"
mkdir -p "$out"
LOG="$out/logcat.txt"
MARK="$out/marks.txt"
: > "$MARK"

mark() { printf '%s  %s\n' "$(date '+%H:%M:%S')" "$1" | tee -a "$MARK"; }

# 应用内判定：底部 tab bar 的文案存在于无障碍树
in_app() {
  adb_ shell uiautomator dump /sdcard/fe550-proof.xml >/dev/null 2>&1
  adb_ shell cat /sdcard/fe550-proof.xml 2>/dev/null | grep -q 'text="My Issues"'
}

launch_dev() {
  adb_ shell am start -n "$PKG/.MainActivity" -a android.intent.action.VIEW \
    -d "exp+multica-mobile://expo-development-client/?url=$METRO_URL" >/dev/null 2>&1
}

open_issue() {
  adb_ shell am start -n "$PKG/.MainActivity" -a android.intent.action.VIEW \
    -d "multica://$WS/issue/$ISSUE" >/dev/null 2>&1
}

adb_wait
adb_ shell input keyevent KEYCODE_HOME >/dev/null 2>&1
sleep 2
adb_ shell am force-stop "$PKG"
adb_ logcat -c
sleep 2

adb_ logcat -v time -s ReactNativeJS:V > "$LOG" 2>&1 &
LOGPID=$!
trap 'kill "$LOGPID" 2>/dev/null || true' EXIT

mark "launch dev-client (cold)"
launch_dev
sleep 30
adb_wait
if ! in_app; then
  echo "first launch did not reach the app; retrying once" >&2
  launch_dev
  sleep 30
fi
if ! in_app; then
  echo "ERROR: 未进入应用（dev launcher 或别的 Metro），本次取证作废" >&2
  adb_ exec-out screencap -p > "$out/FAILED-cold.png"
  exit 1
fi
adb_ exec-out screencap -p > "$out/A-cold.png"

mark "open PROB-3 (12 langs)"
open_issue
sleep 16
adb_ exec-out screencap -p > "$out/B-langs.png"

mark "HOME (background)"
adb_ shell input keyevent KEYCODE_HOME
sleep 10

mark "resume (bring app back, no new issue)"
adb_ shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
sleep 6
adb_ exec-out screencap -p > "$out/C-resumed.png"

mark "re-open PROB-3 (new highlight)"
open_issue
sleep 16
adb_ exec-out screencap -p > "$out/D-after-resume.png"

mark "done"
sleep 1
kill "$LOGPID" 2>/dev/null || true
wait "$LOGPID" 2>/dev/null || true
trap - EXIT

echo "=== shiki 日志（带时间戳）==="
awk '/\[shiki\]/{sub(/.*ReactNativeJS[^ ]*: /, ""); print}' "$LOG" | nl -ba
echo "=== 动作时间点 ==="
cat "$MARK"
echo "=== 计数 ==="
printf 'init=%s release=%s\n' \
  "$(grep -c 'initializing highlighter' "$LOG")" \
  "$(grep -c 'released highlighter' "$LOG")"
echo "done -> $out"
