#!/usr/bin/env bash
# FEATURE-550 · pattern cache 释放的前后台内存序列
#
# 用法: bash mem-seq.sh <out-dir>
#
# 序列（每一步都抓 meminfo）：
#   N0 冷启动完成、未打开任何代码块   → 期望：无 12 语言 pattern cache
#   N1 打开 PROB-3（12 语言代码块）   → 期望：12 个 scanner 建起来，Native Heap 上升
#   N2 按 HOME 进入后台（触发 release）→ 期望：回落（Alloc 下降 / Free 上升）
#   N3 回到前台（尚未触发新的高亮）    → 期望：仍为释放后的水平
#   N4 再次打开 PROB-3（重新高亮）    → 期望：回到接近 N1（重新建 scanner）
#
# 关键列：dumpsys meminfo 的 Native Heap 行 —— 前三列是 PSS/Private/Private-Clean，
# 后三列 Heap Size/Alloc/Free 由 malloc 统计给出，释放后 Free 上升、Alloc 下降
# （PSS 不一定回落，见报告 §内存）。
#
# 注意：dev-client 必须用 `exp+multica-mobile://expo-development-client/?url=...` 拉起；
# 裸 `am start -n .MainActivity` 只会停在 dev launcher 上，量出来的是 launcher 的内存。
set -uo pipefail

ADB_BIN="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
SERIAL="${ANDROID_SERIAL:-emulator-5554}"
PKG="${PKG:-ai.multica.mobile.dev}"
WS="${WS:-probe550}"
ISSUE="${ISSUE:-c3be9531-19ad-403c-9944-ed33c6c67f05}"
METRO_URL="${METRO_URL:-http%3A%2F%2F10.0.2.2%3A8083}"

adb_() { "$ADB_BIN" -s "$SERIAL" "$@"; }

out="${1:?usage: mem-seq.sh <out-dir>}"
mkdir -p "$out"

snap() {
  adb_ shell dumpsys meminfo "$PKG" > "$out/mem-$1.txt"
  printf -- "--- %s\n" "$1"
  awk '/Native Heap/{print "    " $0}' "$out/mem-$1.txt" | head -2
  awk '/TOTAL PSS/{print "    " $0}' "$out/mem-$1.txt" | head -1
}

launch_dev() {
  adb_ shell am start -n "$PKG/.MainActivity" -a android.intent.action.VIEW \
    -d "exp+multica-mobile://expo-development-client/?url=$METRO_URL" >/dev/null 2>&1
}

open_issue() {
  adb_ shell am start -n "$PKG/.MainActivity" -a android.intent.action.VIEW \
    -d "multica://$WS/issue/$ISSUE" >/dev/null 2>&1
}

# 前置校验：当前必须在应用内（底部 tab bar 存在），否则量到的是 dev launcher。
assert_in_app() {
  adb_ shell uiautomator dump /sdcard/fe550-mem.xml >/dev/null 2>&1
  if ! adb_ shell cat /sdcard/fe550-mem.xml 2>/dev/null | grep -q 'text="My Issues"'; then
    echo "ERROR: '$1' 不在应用内（可能是 dev launcher），本次采样作废" >&2
    adb_ exec-out screencap -p > "$out/FAILED-$1.png"
    exit 1
  fi
}

adb_ shell input keyevent KEYCODE_HOME >/dev/null 2>&1
sleep 2
adb_ shell am force-stop "$PKG"
sleep 2
launch_dev
sleep 30
assert_in_app N0-cold
snap N0-cold

open_issue
sleep 12
snap N1-langs-rendered
adb_ exec-out screencap -p > "$out/N1-langs.png"

adb_ shell input keyevent KEYCODE_HOME
sleep 8
snap N2-background

adb_ shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
sleep 6
snap N3-resumed

open_issue
sleep 12
snap N4-rehighlighted
adb_ exec-out screencap -p > "$out/N4-rehighlighted.png"

echo "done -> $out"
