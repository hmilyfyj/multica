#!/usr/bin/env bash
# FEATURE-551 · Android 全量回归验收 —— 观测/驱动库
#
# 沿用 FEATURE-548 `.trellis/tasks/09-18-android-input-keyboard-nav/research/lib.sh`
# 与 549/550 的 `capture-visual.sh` / `set-theme.sh` 的观测口径：
#   · 键盘顶边取 **应用窗口收到的 IME inset** 的 frame 顶边（不是 Gboard 的窗口 frame）
#   · 焦点输入框取 uiautomator 里 `focused="true"` 的节点 bounds
#   · 窗口是否被系统 resize 看根节点 bounds
#   · 「在 tab 根」判据 = 无障碍树里同时有 `My Issues` 与 `More`
#   · 主题复验取正文中心像素亮度：浅色 > 180、深色 < 80
# 并按 FEATURE-557 之后的品牌化包名重设默认值。
#
# 用法：source lib551.sh 后在驱动脚本里调用。可用环境变量覆盖 SERIAL / PKG / WS / OUT。
#
# 五条实测踩出来的约束（前几轮脚本缺陷全出在这里）：
#   1. **不要 `set -o pipefail`。** 无障碍树大起来之后 `ui_nodes | grep -qF …` 的返回值会被
#      SIGPIPE 污染：grep -q 命中即退出，上游还在写 → 上游 exit 141 → pipefail 把整条管道
#      判成失败。实测 `n=200000` 时 `rc=141`、`n=100` 时 `rc=0`，即**页面越大越容易漏判**，
#      而 issue 详情带长 Markdown 正文时正是大页面。本库只 `set -u`。
#   2. **dump 必须先删旧文件**。`uiautomator dump` 在动画中说「could not get idle state」
#      会失败，此时 `cat` 会拿回**上一次**的 XML —— 静默返回过期界面，判据全错。
#      所以 ui_dump 先 `rm`，失败就重试，拿不到就返回非 0，绝不返回旧内容。
#   3. **原生 Alert 会盖住整屏**。服务端 500 会让 RN 弹一个原生对话框，此时 uiautomator
#      只 dump 对话框窗口，之后所有断言都落到错误内容上（实测把 C8/C9/C10 一起带崩）。
#      每个「回到干净路由」的动作前先 `dismiss_dialog`。
#   4. **左滑不能从屏幕右缘起手**。手势导航把右缘 ~20dp 划为系统返回区，从 x=W-60 起手
#      会触发系统 BACK（实测把应用直接退到桌面）。起点取 `W-200`。
#   5. **一次 dump ≈ 2.0s**（换 `exec-out ... /dev/tty` 同为 2.0s，dump 自身启动占绝大头），
#      所以 wait_for 里不再额外 sleep；N 次 ≈ 2N 秒。
set -u

ADB_BIN="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
SERIAL="${ANDROID_SERIAL:-emulator-5554}"
PKG="${PKG:-com.ehaier.zgq.shop.mall.staging}"
WS="${WS:-probe550}"

# dev-client 包注册的 scheme；dev 构建必须用它冷启才会去连 Metro
DEVCLIENT_SCHEME="exp+multica-mobile"

adb_() { "$ADB_BIN" -s "$SERIAL" "$@"; }

# ── 无障碍树 ───────────────────────────────────────────────────────────
DUMP=/sdcard/fe551-ui.xml

ui_dump() {
  local i xml
  for i in 1 2 3; do
    adb_ shell rm -f "$DUMP" >/dev/null 2>&1
    adb_ shell uiautomator dump "$DUMP" >/dev/null 2>&1
    xml="$(adb_ shell cat "$DUMP" 2>/dev/null)"
    [ -n "$xml" ] && { printf '%s' "$xml"; return 0; }
  done
  return 1
}

ui_nodes() { ui_dump | tr '>' '\n'; }
_rects() { paste -d' ' - - - -; }
_bounds_list() { local attr="$1" needle="$2"; ui_nodes | grep -F "$attr=\"$needle\"" | grep -o 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' | grep -o '[0-9]*' | _rects; }

# 取某个属性的字面值对应的 bounds（第 n 个匹配，默认第 1 个），输出 "x1 y1 x2 y2"
_bounds_of_nth() { _bounds_list "$1" "$2" | sed -n "${3:-1}p"; }
_bounds_of_last() { _bounds_list "$1" "$2" | tail -1; }
_bounds_of() { _bounds_of_nth "$1" "$2" 1; }

# 第 n 个 EditText 的 bounds（1-based）
_bounds_edit() {
  ui_nodes | grep -o 'class="android\.widget\.EditText"[^/]*bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' \
    | grep -o '[0-9]*' | _rects | sed -n "${1:-1}p"
}

texts() { ui_nodes | grep -o 'text="[^"]*"' | sed 's/^text="//;s/"$//' | grep -v '^$'; }
descs() { ui_nodes | grep -o 'content-desc="[^"]*"' | sed 's/^content-desc="//;s/"$//' | grep -v '^$'; }

# 字面量包含判断：走 bash 参数展开而不是管道 + grep -q（见文件头第 1 条）。
# `${t#*"$n"}` 里的 "$n" 是带引号的，不参与 glob，所以 `*`/`[` 等字符按字面处理。
_contains() {
  local t="$1" n="$2"
  [ "${t#*"$n"}" != "$t" ]
}

has_text() { _contains "$(ui_nodes)" "text=\"$1\""; }
has_desc() { _contains "$(ui_nodes)" "content-desc=\"$1\""; }
any_text() { local t n; t="$(ui_nodes)"; for n in "$@"; do _contains "$t" "text=\"$n\"" && return 0; done; return 1; }
any_desc() { local t n; t="$(ui_nodes)"; for n in "$@"; do _contains "$t" "content-desc=\"$n\"" && return 0; done; return 1; }

# 选择器（formSheet）已打开的统一判据：
#   有搜索栏的那几个 → content-desc="Clear search"；
#   没有搜索栏的（status / priority / due-date）→ 只在自己列表里出现的选项词。
# 不能拿 "Priority"/"Project" 这类词当判据：它们在未打开的新建页上作为 chip 也在。
picker_open() {
  has_desc "Clear search" \
    || any_text "Backlog" "Cancelled" "Cancel" "In Review" "Blocked" \
                "Urgent" "No priority" "No project" "Done" "Clear"
}

# 根节点（decor）bounds，用来看窗口有没有被系统 resize
root_rect() { ui_dump | tr '<' '\n' | grep -o 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' | head -1 | grep -o '[0-9]*' | _rects; }
# 已聚焦节点 bounds；未聚焦时为空
focused_rect() { ui_nodes | grep 'focused="true"' | grep -o 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' | head -1 | grep -o '[0-9]*' | _rects; }

# 当前聚焦窗口（「应用没被弹到后台」的判据）
current_focus() { adb_ shell dumpsys window 2>/dev/null | grep -o 'mCurrentFocus=Window{[^}]*}' | head -1; }
app_focused() { _contains "$(current_focus)" "$PKG"; }

# 是否停在 issue 详情（标题或时间线分节标题出现即可）
on_issue_detail() { any_text "Activity" "PROB Markdown 语法全覆盖"; }

# 原生 Alert 的按钮（标题与按钮同名时必须用它；1=positive，2=negative）
tap_dialog_button() {
  local which="${1:-1}" b
  b="$(ui_nodes | sed -n "s/.*resource-id=\"android:id\/button$which\".*bounds=\"\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]\".*/\1 \2 \3 \4/p" | head -1)"
  [ -n "$b" ] || return 1
  _tap_bounds "$b"
}

# 有任何原生对话框就点掉（见文件头第 3 条）；没有对话框时是空操作。
dismiss_dialog() {
  local i
  for i in 1 2 3; do
    tap_dialog_button 1 >/dev/null 2>&1 || return 0
    sleep 2
  done
  return 0
}

# ── 等待（一律轮询，不用固定 sleep 猜时长）─────────────────────────────
wait_for() {
  local tries="$1"; shift
  local i
  for i in $(seq 1 "$tries"); do
    "$@" >/dev/null 2>&1 && return 0
  done
  return 1
}

wait_text() { local n="$1" t="$2"; wait_for "$n" has_text "$t"; }
wait_desc() { local n="$1" t="$2"; wait_for "$n" has_desc "$t"; }
# issue 详情首屏在 Debug + 本地后端下要串 8 个接口，实测 ~90s 才齐
wait_issue_detail() { wait_for 45 on_issue_detail; }

# 画面稳定：连续两次 dump 的文本集合一致（转场结束）
wait_stable() {
  local tries="${1:-15}" prev cur i
  prev="$(texts | md5)"
  for i in $(seq 1 "$tries"); do
    sleep 1
    cur="$(texts | md5)"
    [ "$cur" = "$prev" ] && return 0
    prev="$cur"
  done
  return 1
}

# ── 键盘 / 系统栏 ──────────────────────────────────────────────────────
screen_height() { adb_ shell wm size 2>/dev/null | grep -o 'Physical size: [0-9]*x[0-9]*' | grep -o '[0-9]*$'; }
screen_width()  { adb_ shell wm size 2>/dev/null | grep -o 'Physical size: [0-9]*x' | grep -o '[0-9]*'; }

# 键盘顶边 y = 应用窗口收到的 IME inset 的 frame 顶边；收起时返回屏高。
ime_top() {
  local line t
  line="$(adb_ shell dumpsys window 2>/dev/null | grep -o 'type=ime frame=\[[0-9-]*,[0-9-]*\]\[[0-9-]*,[0-9-]*\]' | head -1)"
  t="$(printf '%s' "$line" | sed -E 's/.*frame=\[[0-9-]+,([0-9-]+)\].*/\1/')"
  if [ -z "$t" ] || [ "$t" = "0" ]; then screen_height; return; fi
  printf '%s' "$t"
}

# 键盘是否占位。`mInputShown` 在模拟器上偶发假阴性，所以以 **IME inset 是否非零** 为准
# （548 lib.sh 的注释已经写明：弹起时判据只能是「顶边是否为 0」）。
ime_up() { [ "$(ime_top)" -lt "$(screen_height)" ]; }
ime_shown() { adb_ shell dumpsys input_method 2>/dev/null | grep -o 'mInputShown=[a-z]*' | head -1 | cut -d= -f2; }

close_ime() {
  if ime_up || [ "$(ime_shown)" = "true" ]; then
    adb_ shell input keyevent KEYCODE_BACK >/dev/null 2>&1
    sleep 1
  fi
  return 0
}

reset_ime() {
  adb_ shell ime set com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME >/dev/null 2>&1
  sleep 3
  return 0
}

sysbar_frame() {
  local type="$1" line
  line="$(adb_ shell dumpsys window 2>/dev/null \
    | grep -o "type=$type frame=\[[0-9-]*,[0-9-]*\]\[[0-9-]*,[0-9-]*\]" | head -1)"
  [ -n "$line" ] && printf '%s' "$line" || printf 'type=%s frame=[0,0][0,0]' "$type"
}
nav_bars_top() {
  local f t
  f="$(sysbar_frame navigationBars)"
  t="$(printf '%s' "$f" | sed -E 's/.*frame=\[[0-9-]+,([0-9-]+)\].*/\1/')"
  if [ -z "$t" ] || [ "$t" = "0" ]; then screen_height; return; fi
  printf '%s' "$t"
}

# ── 应用存活 / 路由 ────────────────────────────────────────────────────
app_alive() { [ "$(texts | grep -v '^Tools$' | wc -l | tr -d ' ')" -gt 2 ]; }

# 「在 tab 根」判据（549 capture-visual.sh 同款）
in_tab_root() { any_text "My Issues" && has_text "More"; }

# 把应用拉回前台（被系统返回手势误退到桌面时先兜回来）
ensure_foreground() {
  app_focused && return 0
  adb_ shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
  sleep 3
  return 0
}

# 带 workspace 段的深链
goto() {
  ensure_foreground
  dismiss_dialog
  adb_ shell am start -n "$PKG/.MainActivity" -a android.intent.action.VIEW -d "multica://$WS/$1" >/dev/null 2>&1
  return 0
}
# 不带 workspace 段的深链（/login、/verify 等）
goto_raw() {
  ensure_foreground
  dismiss_dialog
  adb_ shell am start -n "$PKG/.MainActivity" -a android.intent.action.VIEW -d "multica://$1" >/dev/null 2>&1
  return 0
}

# tab 根判据 + BACK 弹栈，最多 6 次；最后落回 inbox（549/550 同款）
reset_to_tab_root() {
  local i
  dismiss_dialog
  for i in 1 2 3 4 5 6; do
    in_tab_root && { goto inbox; sleep 3; return 0; }
    adb_ shell input keyevent KEYCODE_BACK >/dev/null 2>&1
    sleep 2
    dismiss_dialog
  done
  goto inbox
  sleep 3
  return 1
}

# dev-client 冷启：dev 构建必须用 dev-client intent，否则停在服务器列表页。
cold_start() {
  local port="${1:-8081}"
  adb_ shell am force-stop "$PKG" >/dev/null 2>&1
  sleep 2
  adb_ shell am start -n "$PKG/.MainActivity" -a android.intent.action.VIEW \
    -d "$DEVCLIENT_SCHEME://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A$port" >/dev/null 2>&1
  wait_text 15 "Continue" && tap_text "Continue" >/dev/null 2>&1
  return 0
}

# ── 交互 ───────────────────────────────────────────────────────────────
_tap_bounds() {
  local b="$1" x1 y1 x2 y2
  [ -n "$b" ] || return 1
  set -- $b
  x1=$1; y1=$2; x2=$3; y2=$4
  adb_ shell input tap $(( (x1 + x2) / 2 )) $(( (y1 + y2) / 2 ))
}

tap_text()      { _tap_bounds "$(_bounds_of_nth text "$1" 1)"; }
tap_text_last() { _tap_bounds "$(_bounds_of_last text "$1")"; }
tap_desc()      { _tap_bounds "$(_bounds_of content-desc "$1")"; }
tap_edit()      { _tap_bounds "$(_bounds_edit "${1:-1}")"; }
tap_xy()        { adb_ shell input tap "$1" "$2"; return 0; }
press_back()    { adb_ shell input keyevent KEYCODE_BACK >/dev/null 2>&1; sleep 1; return 0; }
type_text()     { adb_ shell input text "$1" >/dev/null 2>&1; sleep 1; return 0; }
key_home()      { adb_ shell input keyevent KEYCODE_HOME >/dev/null 2>&1; sleep 1; return 0; }

# 长按（RN 的 onLongPress + delayLongPress=500，普通 input tap 不触发）
long_press_bounds() {
  local b="$1" x1 y1 x2 y2
  [ -n "$b" ] || return 1
  set -- $b
  x1=$1; y1=$2; x2=$3; y2=$4
  adb_ shell input swipe $(( (x1 + x2) / 2 )) $(( (y1 + y2) / 2 )) $(( (x1 + x2) / 2 )) $(( (y1 + y2) / 2 )) 800 >/dev/null 2>&1
  sleep 2
}
long_press_text() { long_press_bounds "$(_bounds_of text "$1")"; }
long_press_desc() { long_press_bounds "$(_bounds_of content-desc "$1")"; }

# 点目标并等键盘（模拟器上 IME 偶发「有连接不弹键盘」，重置一次再点）
focus_with_ime() {
  local try
  for try in 1 2; do
    "$@" >/dev/null 2>&1 || true
    sleep 4
    ime_up && { sleep 1; return 0; }
    [ "$try" = 1 ] && reset_ime
  done
  return 1
}

swipe() { adb_ shell input swipe "$1" "$2" "$3" "$4" "${5:-300}" >/dev/null 2>&1; sleep 1; return 0; }

# 左滑某一行（ReanimatedSwipeable 的 rightThreshold 是 dp：80dp @420dpi ≈ 210px）。
# 两个约束同时要满足：拖拽距离远大于 210px，且**起点不能落在右缘的系统返回手势区**
# （手势导航把边缘 ~20dp 划给系统 BACK，实测从 W-60 起手会把应用直接退到桌面）。
swipe_left_text() {
  local b y1 y2 cy w x1
  b="$(_bounds_of text "$1")"
  [ -n "$b" ] || return 1
  set -- $b
  y1=$2; y2=$4
  cy=$(( (y1 + y2) / 2 ))
  w="$(screen_width)"
  x1=$(( w - 200 ))
  adb_ shell input swipe "$x1" "$cy" 120 "$cy" 450 >/dev/null 2>&1
  sleep 2
}

# 页面内向上滑直到滚到底（连续两次文本集合不变）
scroll_to_bottom() {
  local max="${1:-8}" i before after h
  h="$(screen_height)"
  for i in $(seq 1 "$max"); do
    before="$(texts | md5)"
    swipe 540 $(( h * 3 / 4 )) 540 $(( h / 4 )) 250
    sleep 1
    after="$(texts | md5)"
    [ "$before" = "$after" ] && return 0
  done
  return 1
}

# 一直滚到某个文本出现（虚拟化列表上「文本集合不变」会提前收敛，见 remeasure 注释）
scroll_until_text() {
  local needle="$1" max="${2:-25}" i
  for i in $(seq 1 "$max"); do
    has_text "$needle" && return 0
    swipe 540 1900 540 700 220
    sleep 1
  done
  return 1
}

# 把某个文本滚进可视区再点（元素在树里但 y 可能在屏外）
tap_text_in_view() {
  local needle="$1" tries="${2:-6}" i h y2
  h="$(screen_height)"
  for i in $(seq 1 "$tries"); do
    y2="$(_bounds_of text "$needle" | awk '{print $4}')"
    if [ -n "$y2" ] && [ "$y2" -le "$h" ]; then tap_text "$needle"; return 0; fi
    swipe 540 $(( h * 3 / 4 )) 540 $(( h / 4 )) 250
    sleep 1
  done
  return 1
}

# ── 取证 ───────────────────────────────────────────────────────────────
OUT="${OUT:-.}"

shot() { adb_ exec-out screencap -p > "$OUT/$1.png" 2>/dev/null; }

# 一次输入场景观测：截图 + state.log 一行
# 判定 visible（焦点输入框整块在键盘上方）/ partial / covered / no-ime
probe_ime() {
  local name="$1" ime_top_v focus root verdict y1 y2 line
  ime_top_v="$(ime_top)"; root="$(root_rect)"; focus="$(focused_rect)"
  shot "$name"
  verdict=no-ime
  if ime_up && [ -n "$focus" ]; then
    y1="$(printf '%s' "$focus" | cut -d' ' -f2)"
    y2="$(printf '%s' "$focus" | cut -d' ' -f4)"
    if   [ "$y2" -le "$ime_top_v" ]; then verdict=visible
    elif [ "$y1" -ge "$ime_top_v" ]; then verdict=covered
    else verdict=partial; fi
  fi
  line="$(printf '%-34s %-8s imeTop=%-5s focus=[%-18s] root=[%s]' "$name" "$verdict" "$ime_top_v" "${focus:-none}" "${root:-none}")"
  printf '%s\n' "$line" >> "$OUT/state.log"
  printf '%s\n' "$line"
}

# 没有可聚焦节点的输入场景（例如 OTP 是 opacity:0 的隐藏 TextInput，无障碍树里没有
# focused 节点）：改判「同屏最下方的关键控件是否整块在键盘顶边之上」。
# probe_elem_ime <name> <kind:text|desc> <needle>
probe_elem_ime() {
  local name="$1" kind="$2" needle="$3" ime_top_v b verdict y1 y2 line
  ime_top_v="$(ime_top)"
  b="$(_bounds_of "$kind" "$needle")"
  shot "$name"
  verdict=no-ime
  if ime_up && [ -n "$b" ]; then
    y1="$(printf '%s' "$b" | cut -d' ' -f2)"
    y2="$(printf '%s' "$b" | cut -d' ' -f4)"
    if   [ "$y2" -le "$ime_top_v" ]; then verdict=visible
    elif [ "$y1" -ge "$ime_top_v" ]; then verdict=covered
    else verdict=partial; fi
  fi
  line="$(printf '%-34s %-8s imeTop=%-5s %s=[%-18s]' "$name" "$verdict" "$ime_top_v" "$needle" "${b:-none}")"
  printf '%s\n' "$line" >> "$OUT/state.log"
  printf '%s\n' "$line"
}

# 逐条结论：check <编号> <判定> <说明>
check() {
  local id="$1" verdict="$2" detail="${3:-}"
  printf '%s\t%s\t%s\n' "$id" "$verdict" "$detail" >> "$OUT/results.tsv"
  printf '[%-7s] %-6s %s\n' "$verdict" "$id" "$detail"
}

# 像素采样：sample <png> <x> <y> → "r g b"
sample() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys
from PIL import Image
img = Image.open(sys.argv[1]).convert("RGB")
print(*img.getpixel((int(sys.argv[2]), int(sys.argv[3]))))
PY
}

# 区域平均亮度：luma <png> <x1> <y1> <x2> <y2>
luma() {
  python3 - "$@" <<'PY'
import sys
from PIL import Image
img = Image.open(sys.argv[1]).convert("RGB")
box = tuple(int(v) for v in sys.argv[2:6])
r = img.crop(box).resize((1, 1), Image.BOX).getpixel((0, 0))
print(int(0.2126*r[0] + 0.7152*r[1] + 0.0722*r[2]))
PY
}

screen_lum() {
  local w h
  w="$(screen_width)"; h="$(screen_height)"
  luma "$1" $(( w / 2 - 20 )) $(( h * 625 / 1000 )) $(( w / 2 + 20 )) $(( h * 625 / 1000 + 40 ))
}

# 主题：走 设置 → Appearance 的三行（549 实测 `cmd uimode night` 不可靠）
set_theme() {
  local want="$1"
  reset_to_tab_root || true
  goto more/settings
  wait_stable 8 || true
  tap_text_in_view "$want" 8 || tap_text "$want"
  sleep 3
  return 0
}
