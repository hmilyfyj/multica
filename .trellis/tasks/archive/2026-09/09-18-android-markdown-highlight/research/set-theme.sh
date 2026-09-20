#!/usr/bin/env bash
# FEATURE-550 · 在应用内切换主题并复验（复用 FEATURE-549 的实测结论）
#
# 用法: bash set-theme.sh Light|Dark|System
#
# 约束（549 实测）：`cmd uimode night` 不可靠 —— 应用偏好可能已被写成 light，
# 且改完还要等 Appearance 事件。主题只能走应用内 Settings → APPEARANCE 行，
# 改完用正文区中心像素亮度复验。
set -uo pipefail

ADB_BIN="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
SERIAL="${ANDROID_SERIAL:-emulator-5554}"
PKG="${PKG:-ai.multica.mobile.dev}"
WS="${WS:-probe550}"

adb_() { "$ADB_BIN" -s "$SERIAL" "$@"; }

want="${1:?usage: set-theme.sh Light|Dark|System}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

dump_ui() {
  adb_ shell uiautomator dump /sdcard/fe550-ui.xml >/dev/null 2>&1
  adb_ shell cat /sdcard/fe550-ui.xml > "$TMP/ui.xml" 2>/dev/null
}

open_route() {
  adb_ shell am start -n "$PKG/.MainActivity" -a android.intent.action.VIEW \
    -d "multica://$WS/$1" >/dev/null 2>&1
}

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

set_theme() {
  local i=0
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

i=0
lum=0
while [ "$i" -lt 4 ]; do
  lum="$(screen_lum)"
  if { [ "$want" = Dark ] && [ "$lum" -lt 80 ]; } ||
     { [ "$want" = Light ] && [ "$lum" -gt 180 ]; } ||
     { [ "$want" = System ] && [ "$lum" -gt 180 ]; }; then
    echo "theme=$want confirmed (lum=$lum, attempt=$i)"
    exit 0
  fi
  set_theme || true
  i=$((i + 1))
done
echo "theme=$want NOT confirmed (last lum=$lum)" >&2
exit 1
