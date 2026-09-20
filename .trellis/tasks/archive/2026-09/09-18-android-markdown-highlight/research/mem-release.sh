#!/usr/bin/env bash
# FEATURE-550 · 释放前后台的 Native Heap 精确采样（关注 malloc 的 Alloc / Free 列）
#
# 用法: bash mem-release.sh <out-dir>
#
# 为什么看 Alloc/Free 而不是 PSS：`dumpsys meminfo` 的 Native Heap 行前三列是
# PSS/Private/Private-Clean（计页级、受分配器是否归还页给内核影响），后三列来自
# malloc 统计（Heap Size / Alloc / Free）——`onig_free()` 之后 Alloc 立刻下降、
# Free 立刻上升，而 PSS 可能要等分配器归还整页才动。
#
# 协议（每轮）：
#   S1 前台稳定（打开 12 语言夹具后静置 40s，12 个 scanner 建好且 JS 已 GC）
#   S2 按 HOME 静置 20s（release 同步发生；应用进入 cached/frozen 前采样）
#   S3 回前台（active 边重新预热）静置 10s
set -uo pipefail

ADB_BIN="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
SERIAL="${ANDROID_SERIAL:-emulator-5554}"
PKG="${PKG:-ai.multica.mobile.dev}"
WS="${WS:-probe550}"
ISSUE="${ISSUE:-c3be9531-19ad-403c-9944-ed33c6c67f05}"

adb_() { "$ADB_BIN" -s "$SERIAL" "$@"; }
adb_wait() { "$ADB_BIN" -s "$SERIAL" wait-for-device >/dev/null 2>&1; }

out="${1:?usage: mem-release.sh <out-dir>}"
mkdir -p "$out"

snap() {
  adb_ shell dumpsys meminfo "$PKG" > "$out/$1.txt"
  local nh total
  nh=$(awk '/Native Heap/{print $2, $5, $7, $8; exit}' "$out/$1.txt")
  total=$(awk '/TOTAL PSS/{print $3}' "$out/$1.txt")
  printf '%-22s NativeHeap(PSS Size Alloc Free) = %-24s TOTAL_PSS = %s\n' "$1" "$nh" "$total" | tee -a "$out/summary.txt"
}

open_issue() {
  adb_ shell am start -n "$PKG/.MainActivity" -a android.intent.action.VIEW \
    -d "multica://$WS/issue/$ISSUE" >/dev/null 2>&1
}

: > "$out/summary.txt"
adb_wait

for round in 1 2; do
  echo "### round $round" | tee -a "$out/summary.txt"
  open_issue
  sleep 40
  snap "r${round}-S1-foreground-settled"
  adb_ shell input keyevent KEYCODE_HOME
  sleep 20
  snap "r${round}-S2-backgrounded"
  adb_ shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
  sleep 10
  snap "r${round}-S3-resumed"
done

echo "done -> $out"
