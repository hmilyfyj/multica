#!/usr/bin/env bash
# FEATURE-549 · 单次截图：先确保处在无 modal 的 tab 根，再走深链，再截图并回报主题亮度。
#
# 用法: bash cap-one.sh <输出目录> <名称> <路由> [等待秒数]
set -uo pipefail

ADB_BIN="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
SERIAL="${ANDROID_SERIAL:-emulator-5554}"
PKG="${PKG:-ai.multica.mobile.dev}"
WS="${WS:-probe542}"
adb_() { "$ADB_BIN" -s "$SERIAL" "$@"; }

OUT="$1"; NAME="$2"; ROUTE="$3"; DELAY="${4:-5}"
mkdir -p "$OUT"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

dump_ui() {
  adb_ shell uiautomator dump /sdcard/fe549-ui.xml >/dev/null 2>&1
  adb_ shell cat /sdcard/fe549-ui.xml > "$TMP/ui.xml" 2>/dev/null
}

at_tab_root() {
  dump_ui
  grep -q 'text="My Issues"' "$TMP/ui.xml" && grep -q 'text="More"' "$TMP/ui.xml"
}

# 先点掉可能存在的 sheet 遮罩（上半屏），再点 Inbox tab；重复直到 tab bar 出现。
for i in 1 2 3 4 5; do
  at_tab_root && break
  adb_ shell input tap 540 300
  sleep 1
  adb_ shell input keyevent KEYCODE_BACK
  sleep 2
done
adb_ shell input tap 160 2250
sleep 3
at_tab_root && echo "state: tab root" || echo "state: NOT tab root (may still capture)"

adb_ shell am start -n "$PKG/.MainActivity" -a android.intent.action.VIEW -d "multica://$WS/$ROUTE" >/dev/null 2>&1
sleep "$DELAY"
adb_ exec-out screencap -p > "$OUT/$NAME.png"
python3 - "$OUT/$NAME.png" <<'PY'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("L")
w, h = im.size
print(f"captured {sys.argv[1]} lum={im.getpixel((w // 2, int(h * 0.625)))}")
PY
