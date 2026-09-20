#!/usr/bin/env bash
# FEATURE-550 · Android markdown / 代码高亮取证脚本
#
# 用法（前置：模拟器已启动、Debug 应用已连本任务 Metro、已登录 probe550）：
#   bash capture.sh issue <out-dir> [frames] [scroll-px]   # 逐屏滚动截图
#   bash capture.sh one   <out-file> [route] [wait]        # 单张截图
#   bash capture.sh perf  <out-dir>                        # 滚动帧率采样（gfxinfo）
#   bash capture.sh mem   <out-dir>                        # 前后台内存采样
#
# 已实测约束（沿用 547/549 的结论）：
#   1. 必须显式 -s <serial>：本机同时跑着别的任务（FEATURE-548）的模拟器。
#   2. 深链必须带 -n <pkg>/.MainActivity：dev 与 staging 注册了同一个 scheme。
#   3. 深链不顶 modal；本脚本每次先回到 tab 根再深链。
#   4. 不要用 `cmd uimode night` 驱动主题（549 实测），主题走应用内 Settings。
set -uo pipefail

ADB_BIN="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
SERIAL="${ANDROID_SERIAL:-emulator-5554}"
PKG="${PKG:-ai.multica.mobile.dev}"
WS="${WS:-probe550}"
ISSUE="${ISSUE:-01a0b3a5-0bf0-7702-b33b-5c38dc6ded45}"

adb_() { "$ADB_BIN" -s "$SERIAL" "$@"; }

mode="${1:?usage: capture.sh <mode> <out-path> [args]}"
out="${2:?usage: capture.sh <mode> <out-path> [args]}"

open_issue() {
  adb_ shell am start -n "$PKG/.MainActivity" -a android.intent.action.VIEW \
    -d "multica://$WS/issue/$ISSUE" >/dev/null 2>&1
}

# 回到 tab 根（存在底部 tab bar 文案即无 modal 压制）
tab_root() {
  adb_ shell input keyevent KEYCODE_BACK
  sleep 1
}

case "$mode" in
  one)
    route="${3:-issue/$ISSUE}"
    wait_s="${4:-6}"
    adb_ shell am start -n "$PKG/.MainActivity" -a android.intent.action.VIEW \
      -d "multica://$WS/$route" >/dev/null 2>&1
    sleep "$wait_s"
    adb_ exec-out screencap -p > "$out"
    echo "captured $out"
    ;;

  issue)
    frames="${3:-12}"
    step="${4:-760}"
    mkdir -p "$out"
    tab_root
    open_issue
    sleep 6
    for i in $(seq 1 "$frames"); do
      adb_ exec-out screencap -p > "$out/frame-$(printf '%02d' "$i").png"
      adb_ shell input swipe 540 1900 540 $((1900 - step)) 260
      sleep 2
    done
    echo "captured $frames frames -> $out"
    ;;

  perf)
    mkdir -p "$out"
    tab_root
    open_issue
    sleep 6
    # reset 后只统计随后的滚动：帧间隔 >16.7ms 即超过 60fps 预算。
    adb_ shell dumpsys gfxinfo "$PKG" reset >/dev/null
    for i in $(seq 1 14); do
      adb_ shell input swipe 540 1900 540 520 220
      sleep 1
    done
    adb_ shell dumpsys gfxinfo "$PKG" > "$out/gfxinfo-scroll.txt"
    adb_ shell dumpsys meminfo "$PKG" > "$out/meminfo-after-scroll.txt"
    echo "perf sample -> $out/gfxinfo-scroll.txt"
    ;;

  mem)
    # 需要先让应用渲染过代码块（pattern cache 已填充），再采样：
    #   before  = 前台、已渲染完 PROB-1
    #   home    = 按 HOME 进入后台（Android 触发 AppState background）
    #   resume  = 回到前台后立刻采样
    mkdir -p "$out"
    tab_root
    open_issue
    sleep 8
    adb_ shell dumpsys meminfo "$PKG" > "$out/mem-foreground.txt"
    adb_ shell input keyevent KEYCODE_HOME
    sleep 6
    adb_ shell dumpsys meminfo "$PKG" > "$out/mem-background.txt"
    adb_ shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
    sleep 5
    adb_ shell dumpsys meminfo "$PKG" > "$out/mem-resumed.txt"
    echo "mem samples -> $out"
    ;;

  *)
    echo "unknown mode: $mode" >&2
    exit 2
    ;;
esac
