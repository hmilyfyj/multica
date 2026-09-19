#!/usr/bin/env bash
# FEATURE-548 · Android 输入/键盘/返回键 观测与驱动库
#
# 用法：   source lib.sh  后在驱动脚本里调用下面的函数。
#   SERIAL / PKG / WS 可用环境变量覆盖。
#
# 为什么要有这个库：本任务要在同一台模拟器上把「6 个输入场景 + 3 类返回路径」
# 各跑一遍，并且改动前后各测一次。手搓坐标既慢又会点空，所以统一成
# 「dump 无障碍树 → 按 text/content-desc/class 取 bounds → 点中心」，
# 所有坐标都是运行时测量出来的，脚本里不写死像素。
#
# 关键观测口径（这是本文件存在的第二个理由）：
#
#   1. 键盘顶边取 **应用窗口收到的 IME inset**，不是 Gboard 的窗口 frame。
#      `dumpsys window` 里 `Window{… InputMethod}` 的 frame 在安卓上恒为整屏
#      （fillxfill），量它只会得到 0 或屏高；真正反映占位的是 insets 状态里的
#      `InsetsSource type=ime frame=[l,t][r,b]`。注意它的两种形态：
#        键盘弹起 type=ime frame=[0,1517][1080,2400] visibleFrame=[0,1517][1080,2400]
#        键盘收起 type=ime frame=[0,0][0,0] visible=false
#      弹起时**没有** `visible=true` 这种 token，判据只能是「顶边是否为 0」。
#      上一轮脚本按 touchableRegion 取值，在聊天页拿到过 2400（=屏高）的假值。
#   2. 输入框位置取 uiautomator 里 `focused="true"` 节点的 bounds；输入法连接
#      建立后 Android 会把焦点节点标出来。
#   3. 根节点 bounds 用来判断窗口有没有被系统 resize：`adjustResize` 生效时键盘
#      弹起会把窗口压小，边到边下不生效、保持整屏。这条决定「避让该由谁做」。
set -uo pipefail

ADB_BIN="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
SERIAL="${ANDROID_SERIAL:-emulator-5554}"
PKG="${PKG:-ai.multica.mobile.dev}"
WS="${WS:-probe550}"
DUMP=/sdcard/fe548-ui.xml

adb_() { "$ADB_BIN" -s "$SERIAL" "$@"; }

# ── 无障碍树 ───────────────────────────────────────────────────────────
# 返回整棵树的 XML（一行一个 node）。uiautomator 偶尔在动画中说 "could not get
# idle state" 而失败，这里重试 3 次。
ui_dump() {
  local i xml
  for i in 1 2 3; do
    adb_ shell uiautomator dump "$DUMP" >/dev/null 2>&1
    xml="$(adb_ shell cat "$DUMP" 2>/dev/null)"
    [ -n "$xml" ] && { printf '%s' "$xml"; return 0; }
    sleep 1
  done
  return 1
}

# 把节点行拆开，便于逐行用 -F 精确匹配
ui_nodes() { ui_dump | tr '>' '\n'; }

# 注意：paste 默认用 TAB 分隔，这里一律 -d' '，否则下游 cut -d' ' 会整行不切。
_rects() { paste -d' ' - - - -; }

# 取某个属性的字面值对应的 bounds，输出 "x1 y1 x2 y2"
_bounds_of() {
  local attr="$1" needle="$2"
  ui_nodes | rg -F "$attr=\"$needle\"" | rg -o 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' \
    | head -1 | rg -o '[0-9]+' | _rects
}

# 第 n 个 EditText 的 bounds（1-based）
_bounds_edit() {
  ui_nodes | rg -o 'class="android\.widget\.EditText"[^/]*bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' \
    | rg -o '[0-9]+' | _rects | sed -n "${1:-1}p"
}

# 当前所有文本 / content-desc，用于失败排查
texts() { ui_nodes | rg -o 'text="[^"]+"' | sed 's/^text="//;s/"$//' | rg -v '^$'; }
descs() { ui_nodes | rg -o 'content-desc="[^"]+"' | sed 's/^content-desc="//;s/"$//' | rg -v '^$'; }

# 根节点（decor）bounds "x1 y1 x2 y2"，用于判断窗口是否被 resize
root_rect() {
  ui_dump | tr '<' '\n' | rg -o 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' \
    | head -1 | rg -o '[0-9]+' | _rects
}

# 已聚焦节点的 bounds "x1 y1 x2 y2"；未聚焦时为空
focused_rect() {
  ui_nodes | rg 'focused="true"' | rg -o 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' \
    | head -1 | rg -o '[0-9]+' | _rects
}

# ── 键盘 ───────────────────────────────────────────────────────────────
screen_height() { adb_ shell wm size 2>/dev/null | rg -o 'Physical size: [0-9]+x[0-9]+' | rg -o '[0-9]+$'; }

# 键盘顶边 y；键盘收起（顶边为 0）时返回屏高，等价「无遮挡边界」。
ime_top() {
  local line t
  line="$(adb_ shell dumpsys window 2>/dev/null \
    | rg -o 'type=ime frame=\[[0-9-]+,[0-9-]+\]\[[0-9-]+,[0-9-]+\]' | head -1)"
  t="$(printf '%s' "$line" | sed -E 's/.*frame=\[[0-9-]+,([0-9-]+)\].*/\1/')"
  if [ -z "$t" ] || [ "$t" = "0" ]; then screen_height; return; fi
  printf '%s' "$t"
}

ime_shown() { adb_ shell dumpsys input_method 2>/dev/null | rg -o 'mInputShown=[a-z]+' | head -1 | cut -d= -f2; }

# 收 IME。注意必须无条件成功返回：调用方常写 `close_ime && …`，返回 1 会打断整条链。
close_ime() {
  if [ "$(ime_shown)" = "true" ]; then
    adb_ shell input keyevent KEYCODE_BACK >/dev/null 2>&1
    sleep 1
  fi
  return 0
}

# 模拟器上输入法偶尔「有输入连接但不弹键盘」（mServedInputConnection 非空、
# mInputShown=false）。重新 `ime set` 同一个 IME 即可恢复，实测一次生效。
reset_ime() {
  adb_ shell ime set com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME >/dev/null 2>&1
  sleep 3
  return 0
}

# 点目标控件并等键盘：第一次点完没弹就重置一次 IME 再点第二次。
# 注意第二次点常常「匹配不到」——第一次点击其实已经聚焦、控件文案/结构已变；
# 所以点击失败不作为失败条件，只以「键盘是否弹出」为准。
# 用法: focus_with_ime tap_desc "Message…"
focus_with_ime() {
  local try
  for try in 1 2; do
    "$@" >/dev/null 2>&1 || echo "  (tap matched nothing: $*)"
    sleep 4
    [ "$(ime_shown)" = "true" ] && { sleep 1; return 0; }
    [ "$try" = 1 ] && { echo "  (no keyboard after tap, resetting IME)"; reset_ime; }
  done
  echo "  (keyboard never opened)"
  return 1
}

# ── 应用存活 ───────────────────────────────────────────────────────────
# 应用 UI 是否在渲染：无障碍树里除了 expo-dev-client 的 "Tools" 悬浮按钮之外
# 还有本应用自己的内容。实测应用偶发落到「JS 在跑、但路由栈渲染为空」的状态
# （截图只剩状态栏 + dev-client 的 Tools），此时所有点击都落空，必须先恢复。
app_alive() { [ "$(texts | rg -v '^Tools$' | wc -l)" -gt 2 ]; }

# 恢复 dev-client 到本任务的 Metro 并等 bundle。别的任务崩溃后残留的 Metro
# 曾把应用带走（截图里出现 "Loading from <别的端口>"）。
point_at_metro() {
  local port="${1:-8081}"
  adb_ shell am start -n "$PKG/.MainActivity" -a android.intent.action.VIEW \
    -d "${PKG}://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A${port}" >/dev/null 2>&1
  sleep 22
  return 0
}

# 保证应用处于可交互状态；否则冷启一次再试。
ensure_app() {
  local i
  app_alive && return 0
  for i in 1 2; do
    echo "  (app UI empty, cold restart attempt $i)"
    adb_ shell am force-stop "$PKG" >/dev/null 2>&1
    sleep 2
    point_at_metro
    app_alive && return 0
  done
  echo "  (app still not rendering)"
  return 1
}

# ── 深链 ───────────────────────────────────────────────────────────────
# 深链切路由。必须带 -n，dev/staging 两个包同注册 multica scheme，裸 VIEW 会弹选择器。
goto() {
  adb_ shell am start -n "$PKG/.MainActivity" -a android.intent.action.VIEW -d "multica://$WS/$1" >/dev/null 2>&1
  return 0
}

# ── 交互 ───────────────────────────────────────────────────────────────
_tap_bounds() {
  local b="$1" x1 y1 x2 y2
  [ -n "$b" ] || return 1
  # shellcheck disable=SC2086
  set -- $b
  x1=$1; y1=$2; x2=$3; y2=$4
  adb_ shell input tap $(( (x1 + x2) / 2 )) $(( (y1 + y2) / 2 ))
}

tap_text() { _tap_bounds "$(_bounds_of text "$1")"; }
tap_desc() { _tap_bounds "$(_bounds_of content-desc "$1")"; }
tap_edit() { _tap_bounds "$(_bounds_edit "${1:-1}")"; }
tap_xy() { adb_ shell input tap "$1" "$2"; return 0; }
press_back() { adb_ shell input keyevent KEYCODE_BACK >/dev/null 2>&1; return 0; }

# ── 一次观测 ───────────────────────────────────────────────────────────
# probe <out-dir> <name>
# 写一张截图 + 追加一行到 state.log：
#   <name>  <判定>  imeTop=<y> focus=[x1 y1 x2 y2] root=[x1 y1 x2 y2]
# 判定：visible（焦点输入框整块在键盘上方）/ partial（被键盘切开）/
#       covered（整块在键盘下方）/ no-ime（键盘没弹，本次作废）
probe() {
  local out="$1" name="$2"
  local ime_top_v shown root focus verdict y1 y2 line

  ime_top_v="$(ime_top)"
  shown="$(ime_shown)"
  root="$(root_rect)"
  focus="$(focused_rect)"
  adb_ exec-out screencap -p > "$out/$name.png"

  verdict=no-ime
  if [ "$shown" = "true" ] && [ -n "$focus" ]; then
    y1="$(printf '%s' "$focus" | cut -d' ' -f2)"
    y2="$(printf '%s' "$focus" | cut -d' ' -f4)"
    if [ "$y2" -le "$ime_top_v" ]; then verdict=visible
    elif [ "$y1" -ge "$ime_top_v" ]; then verdict=covered
    else verdict=partial; fi
  fi

  line="$(printf '%-30s %-8s imeTop=%-5s focus=[%-20s] root=[%s]' \
    "$name" "$verdict" "$ime_top_v" "${focus:-none}" "${root:-none}")"
  printf '%s\n' "$line" >> "$out/state.log"
  printf '%s\n' "$line"
}
