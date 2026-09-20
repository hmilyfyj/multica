#!/usr/bin/env bash
# FEATURE-550 · 一次性验收（用户 2026-09-18 要求：一轮会话跑完全部验收项）
#
# 用法: bash verify-all.sh [out-root]
# 默认 out-root = research/verify-final
#
# 前置（由调用方保证，脚本自己不做）：模拟器已启动、已登录 probe550、Metro 在 8081、
# 应用里的 JS 就是待验收的那份（dev 构建走 Metro，改 JS 不需要重装）。
#
# 一轮会话的顺序（中途不重装、不重启模拟器、不改代码）：
#   1. 内存序列 N0..N4（mem-seq.sh）—— 冷启动 → 12 语言代码块 → 后台 → 回前台 → 再渲染
#   2. 后台释放 / 回前台重建的证据（release-proof.sh）—— logcat 标记 + 前后截图
#   3. 语法矩阵 · 浅色（capture.sh issue）+ uiautomator 文本断言
#   4. 语法矩阵 · 深色（capture.sh issue）
#   5. 长文档首屏与滚动（perf.sh）
#   6. 汇总 verify-summary.txt
#
# 覆盖 issue 的验收项：语法逐项（浅深两套）、高亮（ts/python 有色彩、未知语言回滚纯文本）、
# 降级不抛错、内存回收路径、长文档首屏与滚动。
set -uo pipefail

HERE="$(cd -- "$(dirname -- "$0")" && pwd)"
OUT_ROOT="${1:-$HERE/verify-final}"
ADB_BIN="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
SERIAL="${ANDROID_SERIAL:-emulator-5554}"
PKG="${PKG:-ai.multica.mobile.dev}"
WS="${WS:-probe550}"
ISSUE_MATRIX="${ISSUE_MATRIX:-01a0b3a5-0bf0-7702-b33b-5c38dc6ded45}"
ISSUE_PERF="${ISSUE_PERF:-01a0b3a5-2c4c-770e-b13f-c0060d368b7e}"
# 子脚本的 METRO_URL 默认是 8083；本轮统一到 8081 上跑的 Metro（dev-client 靠它重连）。
METRO_URL="${METRO_URL:-http%3A%2F%2F10.0.2.2%3A8081}"
export METRO_URL SERIAL PKG WS
LOG="$OUT_ROOT/verify.log"
SUMMARY="$OUT_ROOT/verify-summary.txt"

mkdir -p "$OUT_ROOT"
: >"$LOG"
: >"$SUMMARY"

adb_() { "$ADB_BIN" -s "$SERIAL" "$@"; }

step() {
  local name="$1"
  shift
  printf '\n===== %s · %s =====\n' "$(date '+%H:%M:%S')" "$name" | tee -a "$LOG"
  local start; start=$(date +%s)
  "$@" >>"$LOG" 2>&1
  local status=$?
  local end; end=$(date +%s)
  printf '%-22s exit=%s  %ss\n' "$name" "$status" "$((end - start))" | tee -a "$SUMMARY"
  return $status
}

dump_ui() {
  adb_ shell uiautomator dump /sdcard/fe550-verify.xml >/dev/null 2>&1
  adb_ shell cat /sdcard/fe550-verify.xml 2>/dev/null | tr -d '\r' >"$OUT_ROOT/prob1-ui.xml"
}

tab_root() {
  adb_ shell input keyevent KEYCODE_BACK
  sleep 1
}

printf 'FEATURE-550 一次性验收 · %s\n设备 %s · 包 %s · 工作区 %s\n\n' \
  "$(date '+%Y-%m-%d %H:%M:%S')" "$SERIAL" "$PKG" "$WS" | tee -a "$SUMMARY"

# --- 0. 本轮使用的 JS 版本指纹（避免"测的不是这一份"） ----------------------
printf 'js-revision: %s\n' "$(git -C "$HERE/../../../.." rev-parse --short HEAD 2>/dev/null) + uncommitted: $(git -C "$HERE/../../../.." status --porcelain apps/mobile/lib/markdown | tr '\n' ' ')" \
  | tee -a "$SUMMARY"

# --- 1. 内存序列 -----------------------------------------------------------
step "mem-seq" bash "$HERE/mem-seq.sh" "$OUT_ROOT/mem-seq"

# --- 2. 后台释放 / 重建证据 -------------------------------------------------
step "release-proof" bash "$HERE/release-proof.sh" "$OUT_ROOT/release-proof"

# --- 3. 语法矩阵 · 浅色 ----------------------------------------------------
step "theme-light" bash "$HERE/set-theme.sh" Light
step "matrix-light" bash "$HERE/capture.sh" issue "$OUT_ROOT/matrix-light" 8 760
tab_root
adb_ shell am start -n "$PKG/.MainActivity" -a android.intent.action.VIEW \
  -d "multica://$WS/issue/$ISSUE_MATRIX" >/dev/null 2>&1
sleep 6
dump_ui

# --- 4. 语法矩阵 · 深色 ----------------------------------------------------
step "theme-dark" bash "$HERE/set-theme.sh" Dark
step "matrix-dark" bash "$HERE/capture.sh" issue "$OUT_ROOT/matrix-dark" 6 760

# --- 5. 长文档性能 ---------------------------------------------------------
step "theme-light-restore" bash "$HERE/set-theme.sh" Light
step "perf-long-doc" bash "$HERE/perf.sh" "$OUT_ROOT/perf" "$ISSUE_PERF"

# --- 6. 汇总 ---------------------------------------------------------------
{
  printf '\n===== 内存序列（Native Heap Alloc/Free 与 TOTAL_PSS，KB）=====\n'
  for f in "$OUT_ROOT/mem-seq"/mem-*.txt; do
    [ -f "$f" ] || continue
    native=$(grep -m1 'Native Heap' "$f" | awk '{print "Alloc="$(NF-1)" Free="$NF}')
    total=$(grep -m1 'TOTAL' "$f" | awk '{print "TOTAL_PSS="$2}')
    printf '%-26s %s  %s\n' "$(basename "$f")" "$native" "$total"
  done

  printf '\n===== 后台释放标记（release-proof/logcat）=====\n'
  if [ -f "$OUT_ROOT/release-proof/logcat.txt" ]; then
    printf 'initializing highlighter: %s\n' "$(grep -c 'initializing highlighter' "$OUT_ROOT/release-proof/logcat.txt")"
    printf 'released highlighter:     %s\n' "$(grep -c 'released highlighter' "$OUT_ROOT/release-proof/logcat.txt")"
  fi
  [ -f "$OUT_ROOT/release-proof/marks.txt" ] && sed 's/^/  /' "$OUT_ROOT/release-proof/marks.txt"

  printf '\n===== 语法矩阵文本断言（uiautomator dump）=====\n'
  if [ -s "$OUT_ROOT/prob1-ui.xml" ]; then
    missing=0
    for marker in "PROB Markdown 语法全覆盖" "H1 一级标题" "加粗" "删除线" "无序列表" "有序列表" \
      "未完成项" "引用第二层" "表格" "分隔线" "代码块（typescript" "foobar" \
      "plain monospace fallback" "行内代码紧邻标点" "表情" "HTML 硬换行"; do
      if grep -q "$marker" "$OUT_ROOT/prob1-ui.xml"; then
        printf '  ✓ %s\n' "$marker"
      else
        printf '  · %s（dump 里没有，见截图）\n' "$marker"
        missing=$((missing + 1))
      fi
    done
    printf '  dump 未覆盖 %s 项（渲染是否可见以截图为准）\n' "$missing"
  else
    printf '  dump 为空（enriched-markdown 的文本未进无障碍树时属预期）\n'
  fi

  printf '\n===== 长文档性能（gfxinfo）=====\n'
  if [ -f "$OUT_ROOT/perf/gfxinfo-scroll.txt" ]; then
    grep -E "Janky frames|50th|90th|95th|99th|Total frames" "$OUT_ROOT/perf/gfxinfo-scroll.txt" | sed 's/^/  /'
  fi

  printf '\n===== 产物 =====\n'
  for d in mem-seq release-proof matrix-light matrix-dark perf; do
    printf '  %-14s %s files\n' "$d" "$(ls "$OUT_ROOT/$d" 2>/dev/null | wc -l | tr -d ' ')"
  done
} | tee -a "$SUMMARY"

printf '\n一轮验收跑完：%s\n' "$SUMMARY"
