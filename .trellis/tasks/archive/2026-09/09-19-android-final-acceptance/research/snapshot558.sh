#!/usr/bin/env bash
# FEATURE-558 · AVD 快照：把「已装 Release 包 + 已登录」的状态存下来，之后秒级复用
#
# 为什么值得：一次冒烟 3~4 分钟里，boot（~20s）+ 装包（~2s）+ 登录（60~90s）是纯固定开销；
# 快照把这些一次性做完，之后每次冒烟只剩判据本身（Tier 1 的 5 分钟预算里最不稳的一段就是它）。
#
# 用法：
#   bash snapshot558.sh boot     # 冷启模拟器（还没有快照时用这个）
#   bash snapshot558.sh save     # 把**当前**状态（已登录）存成快照 smoke-ready
#   bash snapshot558.sh load     # 用快照启动（秒级），不存在则回退到冷启并提示
#   bash snapshot558.sh list     # 列出快照（读磁盘，不要求模拟器在跑）
#   bash snapshot558.sh kill     # 关掉模拟器
#
# 启动参数带 `-no-snapshot-save`：退出时不要自动覆盖快照；显式 `save` 仍然有效（实测 OK）。
set -u

AVD="${AVD:-Medium_Phone_API_35}"
SNAP="${SNAP:-smoke-ready}"
EMU="${EMULATOR:-$HOME/Library/Android/sdk/emulator/emulator}"
ADB="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
SERIAL="${ANDROID_SERIAL:-emulator-5554}"
BOOT_TIMEOUT="${BOOT_TIMEOUT:-180}"   # 秒
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

# AVD 数据目录：`Medium_Phone_API_35` 的目录其实叫 `Medium_Phone.avd`（由 .ini 的 path= 指定），
# 不能靠名字猜 —— 快照目录在 <数据目录>/snapshots/<name>/。
avd_data_dir() {
  local ini="$HOME/.android/avd/$AVD.ini" p
  if [ -f "$ini" ]; then
    p="$(grep -m1 '^path=' "$ini" | cut -d= -f2-)"
    case "$p" in
      /*) printf '%s' "$p" ;;
      "") printf '%s/.android/avd/%s.avd' "$HOME" "$AVD" ;;
      *) printf '%s/%s' "$HOME" "$p" ;;
    esac
  else
    printf '%s/.android/avd/%s.avd' "$HOME" "$AVD"
  fi
}
SNAPDIR="$(avd_data_dir)/snapshots/$SNAP"

wait_boot() {
  local i=0 max=$(( BOOT_TIMEOUT / 2 ))
  while [ "$i" -lt "$max" ]; do
    [ "$("$ADB" -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && return 0
    sleep 2
    i=$(( i + 1 ))
  done
  return 1
}

wait_dead() {
  local i=0
  while [ "$i" -lt 30 ]; do
    "$ADB" -s "$SERIAL" get-state >/dev/null 2>&1 || return 0
    sleep 1
    i=$(( i + 1 ))
  done
  return 0
}

case "${1:-}" in
  boot)
    nohup "$EMU" -avd "$AVD" -memory 4096 -cores 4 -no-snapshot-save -no-boot-anim \
      > /tmp/fe558-emulator.log 2>&1 &
    wait_boot && printf 'boot ok（%s 已就绪）\n' "$SERIAL" || { printf 'boot 超时，见 /tmp/fe558-emulator.log\n' >&2; exit 1; }
    ;;
  load)
    "$ADB" -s "$SERIAL" emu kill >/dev/null 2>&1 || true
    wait_dead
    if [ ! -d "$SNAPDIR" ]; then
      printf '没有快照 %s（%s），回退冷启：先跑一次 smoke558.sh 再 save\n' "$SNAP" "$SNAPDIR" >&2
      exec bash "$SELF" boot
    fi
    nohup "$EMU" -avd "$AVD" -snapshot "$SNAP" -no-snapshot-save -memory 4096 -cores 4 \
      > /tmp/fe558-emulator.log 2>&1 &
    wait_boot && printf 'load ok（快照 %s，%s 已就绪）\n' "$SNAP" "$SERIAL" || { printf 'load 超时\n' >&2; exit 1; }
    ;;
  save)
    if "$ADB" -s "$SERIAL" get-state >/dev/null 2>&1; then
      "$ADB" -s "$SERIAL" emu avd snapshot save "$SNAP" 2>&1 | tail -2
      if [ -d "$SNAPDIR" ]; then
        printf '已保存快照 %s → %s（下次 `bash snapshot558.sh load` 秒级复用）\n' "$SNAP" "$SNAPDIR"
      else
        printf 'save 返回了，但没在 %s 看到快照，请检查\n' "$SNAPDIR" >&2
        exit 1
      fi
    else
      printf 'save 失败：模拟器没在跑（先 boot/load）\n' >&2
      exit 1
    fi
    ;;
  list)
    if [ -d "$(avd_data_dir)/snapshots" ]; then
      ls -1 "$(avd_data_dir)/snapshots"
    else
      printf '快照目录不存在：%s\n' "$(avd_data_dir)/snapshots"
    fi
    ;;
  kill)
    "$ADB" -s "$SERIAL" emu kill 2>&1 | tail -1
    wait_dead
    printf '已关闭 %s\n' "$SERIAL"
    ;;
  *)
    printf '用法：bash snapshot558.sh {boot|save|load|list|kill}\n' >&2
    exit 2
    ;;
esac
