#!/usr/bin/env bash
# FEATURE-548 · Android 输入/键盘/系统导航取证驱动
#
# 用法:
#   ANDROID_SERIAL=emulator-5556 PKG=ai.multica.mobile.staging \
#     bash drive-input.sh <输出目录> [后端工作区 slug]
#
# 设计约束（都是实测踩出来的）：
#   1. 一律用 uiautomator 的 bounds 定位后再 tap，不写死坐标：同一页面在不同
#      设备/不同键盘高度下位置会变，写死坐标会静默点空。
#   2. 每个动作前先 `wait_for`，UI 未就绪就重试；直接 sleep 猜时长会漏掉转场。
#   3. 截图前先记录 IME 状态（`mInputShown`）——「键盘没弹出」和「键盘弹出但
#      输入框被盖住」是两类不同的缺陷，截图本身区分不了。
#   4. LogBox 红/黄条会盖住正文，每步之后先清掉它。
set -uo pipefail

ADB_BIN="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
SERIAL="${ANDROID_SERIAL:-emulator-5556}"
PKG="${PKG:-ai.multica.mobile.staging}"
WS="${2:-probe542}"

OUT="${1:?usage: drive-input.sh <out-dir> [workspace-slug]}"
mkdir -p "$OUT"

adb_() { "$ADB_BIN" -s "$SERIAL" "$@"; }

# ── 基础能力 ────────────────────────────────────────────────────────────

dump_ui() {
  local f=/sdcard/fe548-ui.xml
  adb_ shell rm -f "$f" >/dev/null 2>&1
  adb_ shell uiautomator dump "$f" >/dev/null 2>&1
  adb_ shell cat "$f" 2>/dev/null | tr '>' '\n'
}

# 打印每个匹配节点的 "x1 y1 x2 y2"（原始像素坐标）
bounds_for() {
  local kind="$1" needle="$2"
  dump_ui | rg -o "${kind}=\"${needle}\"[^/]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" \
    | rg -o 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' \
    | rg -o '[0-9]+' | paste - - - - | head -1
}

tap_bounds() {
  local b="$1"
  [ -n "$b" ] || return 1
  # shellcheck disable=SC2086
  set -- $b
  adb_ shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))
}

tap_text()     { tap_bounds "$(bounds_for text "$1")"; }
tap_desc()     { tap_bounds "$(bounds_for content-desc "$1")"; }

has_text() { dump_ui | rg -q "text=\"$1\""; }

wait_for() {
  local needle="$1" tries="${2:-20}"
  for _ in $(seq 1 "$tries"); do
    has_text "$needle" && return 0
    sleep 1
  done
  return 1
}

# LogBox 的 Dismiss（红/黄条会盖住正文）
clear_logbox() {
  for _ in 1 2 3; do
    tap_text "Dismiss" >/dev/null 2>&1 || break
    sleep 1
  done
}

# 键盘是否真的在屏上（区别于「输入框有没有被盖住」）
ime_shown() {
  adb_ shell dumpsys input_method 2>/dev/null \
    | rg -o 'mInputShown=[a-z]+' | head -1
}

# 当前焦点输入框的屏幕包围盒（y 区间），没有焦点框则输出空
focused_input_bounds() {
  adb_ shell dumpsys input_method 2>/dev/null \
    | rg -o 'mServedView=com\.facebook\.react\.views\.textinput\.ReactEditText\{[^}]*\}' \
    | rg -o '[0-9]+,[0-9]+-[0-9]+,[0-9]+' | head -1
}

# 键盘顶边（IME 窗口可见上沿），无键盘输出 2400
ime_top() {
  local line
  line="$(adb_ shell dumpsys window windows 2>/dev/null \
    | rg -A14 'InputMethod\}:' | rg -o 'touchable region=SkRegion\(\([0-9]+,[0-9]+' | head -1)"
  if [ -n "$line" ]; then
    echo "$line" | rg -o '[0-9]+$'
  else
    echo 2400
  fi
}

shot() {
  local name="$1"
  clear_logbox
  local ime focus
  ime="$(ime_shown)"
  focus="$(focused_input_bounds)"
  adb_ exec-out screencap -p > "$OUT/$name.png"
  printf '%-28s %-22s focus=%s\n' "$name" "$ime" "${focus:-none}" | tee -a "$OUT/state.log"
}

# 用深链切路由（dev 包里这是唯一稳的跳转方式，见 FEATURE-547 research）
goto() {
  adb_ shell am start -n "$PKG/.MainActivity" -a android.intent.action.VIEW \
    -d "multica://$WS/$1" >/dev/null 2>&1
  sleep "${2:-4}"
}

# ── 环境记录 ────────────────────────────────────────────────────────────

{
  echo "device_model=$(adb_ shell getprop ro.product.model | tr -d '\r')"
  echo "android_release=$(adb_ shell getprop ro.build.version.release | tr -d '\r')"
  echo "api_level=$(adb_ shell getprop ro.build.version.sdk | tr -d '\r')"
  echo "package=$PKG"
  echo "ime=$(adb_ shell settings get secure default_input_method | tr -d '\r')"
  echo "hw_keyboard=$(adb_ shell dumpsys input 2>/dev/null | rg -c 'qwerty' || true)"
  echo "wm_size=$(adb_ shell wm size | tr -d '\r')"
} | tee "$OUT/env.txt"

: > "$OUT/state.log"

echo "== 1 登录（邮箱输入框 + Send code）" >&2
shot 01-login-rest
tap_text "you@example.com" || tap_text "Sign in to Multica"
sleep 3
shot 02-login-ime

echo "== 2 验证码（OTP + Verify）" >&2
tap_text "Send code" || true
sleep 6
shot 03-verify-ime

echo "== 3 聊天（composer 在底部，父级 KAV 在 Android 是空操作）" >&2
tap_text "Chat" || true
sleep 5
tap_desc "Type a message…" || tap_desc "Message…" || true
sleep 6
shot 04-chat-ime

echo "== 4 评论（composer 走 KeyboardStickyView）" >&2
goto "issue/$ISSUE" 6
tap_desc "Add a comment, @ to mention…" || true
sleep 6
shot 05-comment-ime

echo "== 5 新建 issue（表单 + 悬浮 mention bar）" >&2
goto "new-issue" 6
tap_text "Issue title" || true
sleep 5
shot 06-newissue-ime

echo "== 6 编辑 issue（描述编辑器）" >&2
goto "issue/$ISSUE/edit" 6
tap_text "Issue title" || true
sleep 5
shot 07-editissue-ime

echo "done; see $OUT/state.log" >&2
