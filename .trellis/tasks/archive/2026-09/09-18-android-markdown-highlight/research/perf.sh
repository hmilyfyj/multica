#!/usr/bin/env bash
# FEATURE-550 · 长文档首屏与滚动性能采样
#
# 用法: bash perf.sh <out-dir> [issue-id]
#   默认 issue = PROB-2 长文档性能夹具（24 个 h2 / 48 个代码块 / 6256 字符）
#
# 采集：
#   1. 首屏：深链后每 ~0.3s 抓一帧，与「深链前」基线帧做平均绝对差，第一帧超过阈值
#      即视为正文已绘制。分辨率受 screencap 耗时限制（约 0.3–0.5s）。
#      绝对耗时含 Debug/Metro 的 bundle 与数据请求，**只在同一构建内横向比较才算数**。
#   2. 滚动：`dumpsys gfxinfo` reset → 14 次全屏滑动 → janky 帧数与百分位。
set -uo pipefail

ADB_BIN="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
SERIAL="${ANDROID_SERIAL:-emulator-5554}"
PKG="${PKG:-ai.multica.mobile.dev}"
WS="${WS:-probe550}"

adb_() { "$ADB_BIN" -s "$SERIAL" "$@"; }
adb_wait() { "$ADB_BIN" -s "$SERIAL" wait-for-device >/dev/null 2>&1; }

out="${1:?usage: perf.sh <out-dir> [issue-id]}"
ISSUE="${2:-01a0b3a5-2c4c-770e-b13f-c0060d368b7e}"
mkdir -p "$out"

open_issue() {
  adb_ shell am start -n "$PKG/.MainActivity" -a android.intent.action.VIEW \
    -d "multica://$WS/issue/$ISSUE" >/dev/null 2>&1
}

# 回到 tab 根，避免上一个 issue 的详情盖住这次深链
adb_wait
adb_ shell input keyevent KEYCODE_BACK >/dev/null 2>&1
sleep 3

adb_ exec-out screencap -p > "$out/baseline.png"
start_ns=$(python3 -c 'import time; print(time.time_ns())')
open_issue
for i in $(seq 1 10); do
  adb_ exec-out screencap -p > "$out/frame-$(printf '%02d' "$i").png"
done
python3 - "$out" "$start_ns" <<'PY'
import sys, pathlib, time
from PIL import Image, ImageChops
out = pathlib.Path(sys.argv[1]); start_ns = int(sys.argv[2])
base = Image.open(out / "baseline.png").convert("L")
for p in sorted(out.glob("frame-*.png")):
    im = Image.open(p).convert("L")
    diff = ImageChops.difference(base, im)
    score = sum(diff.point(lambda v: v > 24).getdata()) / (im.width * im.height)
    elapsed = round((time.time_ns() - start_ns) / 1e6)
    print(f"{p.name}: diff={score:.4f} (cumulative ~{elapsed} ms incl. screencap cost)")
PY
adb_ exec-out screencap -p > "$out/settled.png"

sleep 3
adb_ shell dumpsys gfxinfo "$PKG" reset >/dev/null
for _ in $(seq 1 14); do
  adb_ shell input swipe 540 1900 540 520 220
  sleep 1
done
sleep 2
adb_ shell dumpsys gfxinfo "$PKG" > "$out/gfxinfo-scroll.txt"
adb_ exec-out screencap -p > "$out/scroll-end.png"

echo "=== gfxinfo ==="
awk '/Total frames rendered|Janky frames|Number Missed Vsync|Number Slow UI thread|Number Slow bitmap uploads|Number Slow issue draw commands|50th percentile|90th percentile|95th percentile|99th percentile/{print "  " $0}' \
  "$out/gfxinfo-scroll.txt"
echo "done -> $out"
