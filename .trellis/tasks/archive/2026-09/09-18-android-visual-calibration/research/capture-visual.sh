#!/usr/bin/env bash
# FEATURE-549 · Android 视觉校准截图驱动器（主要页面 × 深浅两套主题）
#
# 用法: ANDROID_SERIAL=emulator-5554 bash capture-visual.sh <输出目录> [每页等待秒数]
# 前置: 模拟器已启动、应用已连接 Metro 并已登录 probe542 工作区、后端监听 8090。
#
# 已实测的约束（含 FEATURE-547 capture-sheets.sh 的结论）：
#   1. 必须显式 `-s <serial>`：本机可能同时跑着别的任务的模拟器。
#   2. 深链必须带 `-n <pkg>/.MainActivity`：dev 与 staging 两个包注册了同一个
#      `multica`/`exp+multica-mobile` scheme，裸 VIEW intent 会弹系统 "Open with" 选择器。
#   3. **深链不会顶掉 modal**：上一次跑到 sheet 路由后，下一次的深链会把目标压在 sheet
#      底下，于是「看着深链成功、其实还在旧页面」。每次切主题/换路由前先
#      `reset_to_tab_root`：靠 tab bar 文案判断是否处在 tab 根，不在就 BACK 弹栈。
#   4. **不要用 `cmd uimode night` 驱动主题**：实测应用不一定跟随系统（preference 可能
#      已被写成 light），改完还要等 Appearance 事件。改用应用内 Settings → APPEARANCE
#      的 Light/Dark 行（直接 `Appearance.setColorScheme`），并用像素亮度复验。
set -uo pipefail

ADB_BIN="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
SERIAL="${ANDROID_SERIAL:-emulator-5554}"
PKG="${PKG:-ai.multica.mobile.dev}"
WS="${WS:-probe542}"

adb_() { "$ADB_BIN" -s "$SERIAL" "$@"; }

ISSUE1="${ISSUE1:-d432e42f-8ef7-4b77-a56e-c2eb11069c89}"
ISSUE2="${ISSUE2:-a84a5e74-49c0-4ca3-87a8-9084db883b01}"
PROJECT="${PROJECT:-f05959d6-96b8-4358-b4d7-6f0359d0665a}"

OUT="${1:?usage: capture-visual.sh <out-dir> [wait-seconds]}"
DELAY="${2:-4}"
mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

open_route() {
  adb_ shell am start -n "$PKG/.MainActivity" -a android.intent.action.VIEW \
    -d "multica://$WS/$1" >/dev/null 2>&1
}

dump_ui() {
  adb_ shell uiautomator dump /sdcard/fe549-ui.xml >/dev/null 2>&1
  adb_ shell cat /sdcard/fe549-ui.xml > "$TMP/ui.xml" 2>/dev/null
}

# 正文区中心像素的亮度：浅色主题接近 255，深色主题接近 10。
screen_lum() {
  adb_ exec-out screencap -p > "$TMP/lum.png"
  python3 - "$TMP/lum.png" <<'PY'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("L")
w, h = im.size
print(im.getpixel((w // 2, int(h * 0.625))))
PY
}

# 在 uiautomator 树里按 text 精确匹配一个节点并点它的中心。
tap_text() {
  local label="$1"
  dump_ui
  local center
  center="$(python3 - "$TMP/ui.xml" "$label" <<'PY'
import re, sys, xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
want = sys.argv[2]
for node in root.iter("node"):
    if node.get("text") == want:
        x1, y1, x2, y2 = map(int, re.findall(r"-?\d+", node.get("bounds")))
        print((x1 + x2) // 2, (y1 + y2) // 2)
        break
PY
)" || return 1
  [ -n "$center" ] || return 1
  # shellcheck disable=SC2086
  adb_ shell input tap $center
}

# tab bar 存在 => 处在 tab 根，没有 modal 压在下面。
at_tab_root() {
  dump_ui
  grep -q 'text="My Issues"' "$TMP/ui.xml" && grep -q 'text="More"' "$TMP/ui.xml"
}

reset_to_tab_root() {
  local i=0
  while [ "$i" -lt 6 ]; do
    if at_tab_root; then
      open_route inbox
      sleep 3
      return 0
    fi
    adb_ shell input keyevent KEYCODE_BACK
    sleep 2
    i=$((i + 1))
  done
  echo "reset_to_tab_root failed" >&2
  return 1
}

# want: Light | Dark | System
set_theme() {
  local want="$1" i=0
  while [ "$i" -lt 4 ]; do
    reset_to_tab_root || true
    open_route "more/settings"
    sleep 4
    if tap_text "$want"; then
      sleep 3
      return 0
    fi
    i=$((i + 1))
  done
  echo "theme row '$want' not found" >&2
  return 1
}

confirm_theme() {
  local want="$1" i=0 lum=0
  while [ "$i" -lt 4 ]; do
    reset_to_tab_root || true
    lum="$(screen_lum)"
    if { [ "$want" = Dark ] && [ "$lum" -lt 80 ]; } ||
       { [ "$want" = Light ] && [ "$lum" -gt 180 ]; }; then
      echo "theme=$want confirmed (lum=$lum, attempts=$i)"
      return 0
    fi
    set_theme "$want" || true
    i=$((i + 1))
  done
  echo "theme=$want NOT confirmed (last lum=$lum)" >&2
  return 1
}

capture() {
  local name="$1" path="$2"
  reset_to_tab_root || true
  open_route "$path"
  sleep "$DELAY"
  adb_ exec-out screencap -p > "$OUT/$name.png"
  echo "captured $name"
}

# name|route path
ROUTES=(
  "inbox|inbox"
  "my-issues|my-issues"
  "chat|chat"
  "projects|more/projects"
  "settings|more/settings"
  "issue-detail|issue/$ISSUE1"
  "issue-detail-plain|issue/$ISSUE2"
  "new-issue|new-issue"
  "search|search"
  "switch-workspace|switch-workspace"
  "chat-sessions|chat-sessions"
  "project-detail|project/$PROJECT"
  "inbox-detail|inbox/2c552f35-ab37-4c5d-9ab0-05971b6880d5"
  "issue-picker-assignee|issue/$ISSUE1/picker/assignee"
)

for theme in Light Dark; do
  set_theme "$theme" || true
  confirm_theme "$theme" || true
  for entry in "${ROUTES[@]}"; do
    capture "$(echo "$theme" | tr '[:upper:]' '[:lower:]')-${entry%%|*}" "${entry#*|}"
  done
done

set_theme System >/dev/null 2>&1 || true
echo "done -> $OUT"
