#!/usr/bin/env bash
# FEATURE-558 · Tier 1 冒烟门禁（单设备目标 < 5 分钟）
#
# 为什么有它：完整矩阵（Tier 2，68 条）单设备下限 ~40 分钟，不适合每次改动都跑。
# 冒烟集是从完整矩阵里**挑出来的子集**（判据实现只有一处，在 `groups-core558.sh` 的
# `smoke_set()`），只覆盖 Android 差异面与最高风险路径，8 条：
#   S1 收件箱渲染 · S2 详情 + 属性 chip · S3 picker→BACK 返回路径 · S4 评论框键盘避让
#   S5 edge-to-edge 系统栏 · S6 聊天完成（库侧断言）· S7 实时层 client_os（日志断言）·
#   S8 品牌启动屏帧
#
# 用法：
#   bash smoke558.sh                 # 默认：Release staging 包 + 快速档 + 产物落 run-smoke/
#   OUT=/tmp/s1 bash smoke558.sh     # 换产物目录
#   BUILD_VARIANT=debug bash smoke558.sh
#
# 退出码：0 = 8 条全通过；1 = 有 fail/blocked；2 = 前置不满足（没设备 / 包没装）
#
# 纪律：冒烟**不得**为了过而放宽判据；新增/改动判据以 Tier 2 口径为准，冒烟只跟着换子集。
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${OUT:-$HERE/run-smoke}"
export OUT
export BUILD_VARIANT="${BUILD_VARIANT:-release}"
export ACCEPT_FAST="${ACCEPT_FAST:-1}"
export ACCEPT_GROUPS=smoke
export ADB="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
export ANDROID_SERIAL="${ANDROID_SERIAL:-emulator-5554}"
PKG="${PKG:-com.ehaier.zgq.shop.mall.staging}"

mkdir -p "$OUT"

# ── 前置：设备在 + 包已装（不要跑到一半才发现）────────────────────────
if ! "$ADB" -s "$ANDROID_SERIAL" get-state >/dev/null 2>&1; then
  printf 'smoke558: 没有可用设备（%s）。先起模拟器：bash snapshot558.sh load，或 emulator -avd Medium_Phone_API_35\n' "$ANDROID_SERIAL" >&2
  exit 2
fi
if ! "$ADB" -s "$ANDROID_SERIAL" shell pm list packages 2>/dev/null | grep -q "$PKG"; then
  printf 'smoke558: 设备上没有 %s。先装包：adb install -r apps/mobile/dist/android/multica-mobile-staging-0.1.0-vc1.apk\n' "$PKG" >&2
  exit 2
fi

# ── 计时并跑冒烟集 ─────────────────────────────────────────────────────
t0="$SECONDS"
bash "$HERE/acceptance558.sh"
rc=$?
elapsed=$(( SECONDS - t0 ))

printf '\n── 冒烟集结果（用时 %ss）──\n' "$elapsed" >&2
if [ -s "$OUT/results.tsv" ]; then
  awk -F'\t' '{printf "%-4s %-8s %s\n", $1, $2, substr($3, 1, 60)}' "$OUT/results.tsv" >&2
  n_all="$(wc -l < "$OUT/results.tsv" | tr -d ' ')"
  n_bad="$(awk -F'\t' '$2!="pass"' "$OUT/results.tsv" | wc -l | tr -d ' ')"
  printf '合计 %s 条，未通过 %s 条；逐条耗时见 %s/timings.tsv\n' "$n_all" "$n_bad" "$OUT" >&2
  if [ "$n_bad" -gt 0 ]; then
    printf '未通过：%s\n' "$(awk -F'\t' '$2!="pass"{printf "%s(%s) ", $1, $2}' "$OUT/results.tsv")" >&2
  fi
else
  printf 'smoke558: 没有产出结果表（脚本提前退出）\n' >&2
  exit 2
fi

[ "$rc" = 0 ] && [ "$n_bad" = 0 ] && exit 0
exit 1
