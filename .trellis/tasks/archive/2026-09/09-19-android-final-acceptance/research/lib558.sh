#!/usr/bin/env bash
# FEATURE-558 · Android 阶段 5 收尾验收 —— 观测/驱动库
#
# 本文件是 FEATURE-551 `research/lib551.sh` 的副本，相对它只改了三处：
#   · 标题/用法里的任务号；
#   · uiautomator dump 路径（fe551 → fe558，两个任务的脚本可能同时存在于工作区）；
#   · 文件末尾新增三个 558 补验所需原语：double_tap_xy / image_block_bounds / png_diff_ratio。
# 其余观测口径与 551 完全一致。
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
# 用法：source lib558.sh 后在驱动脚本里调用。可用环境变量覆盖 SERIAL / PKG / WS / OUT。
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

# PIL（Pillow）用的解释器。**必须显式挑**：登录 shell（`bash -lc`）里的 `python3`
# 是 `/usr/bin/python3`，没有 Pillow —— 所有像素判据（image_block_bounds / ink_ratio /
# luma / sample / png_diff_ratio）会静默返回空，把「图片没渲染」这种假结论写进结果表
# （2026-09-19 实测：B5 因此被误判 blocked，进程日志里是 ModuleNotFoundError: No module named 'PIL'）。
# 这里优先挑一个真能 import PIL 的解释器；PY_BIN 可覆盖。
if [ -z "${PY_BIN:-}" ]; then
  for _p in /opt/homebrew/bin/python3 python3; do
    if "$_p" -c "import PIL" >/dev/null 2>&1; then PY_BIN="$_p"; break; fi
  done
fi
PY_BIN="${PY_BIN:-python3}"
export PY_BIN

# dev-client 包注册的 scheme；dev 构建必须用它冷启才会去连 Metro
DEVCLIENT_SCHEME="exp+multica-mobile"
# 构建类型：debug（dev-client，JS 走 Metro）| release（内嵌 JS，不连 Metro）。
# 2026-09-19 起验收跑在 staging Release 上（用户批的方案 A）：没有 dev-client 的 Tools
# 悬浮球遮挡，也没有「冷启时连 Metro 拉 bundle」那几十秒到几分钟的停顿。
BUILD_VARIANT="${BUILD_VARIANT:-debug}"

# ── 无障碍树缓存（2026-09-19 提速，实测 3~5×）────────────────────────────
# 实测：单次 `uiautomator dump` ≈1.8s，其中 ≈0.94s 是每次冷启 uiautomator 进程的固定
# 成本（`adb shell uiautomator`（不带子命令）实测 0.937s），跟页面大小无关；而判据普遍是
# 「一次判断一次 dump」：`tab_bar_bottom` 量一个数要 4 次、`reset_to_tab_root` 一轮最多 6 次、
# `in_tab_root` 2 次…… 实测单条 E1 判据要 4 分 15 秒，整轮墙钟 ≈ dump 次数 × 1.8s。
#
# 所以按「界面世代」缓存：**同一世代内多次取树只 dump 一次**；任何会改界面的动作
# （tap / swipe / keyevent / 深链 / 输入 / 切系统栏）都把世代号 +1 让缓存失效。
# 语义不变：缓存只在「没有任何动作的同一瞬间」内复用，跨动作一律重新 dump。
#
# 纪律：**凡是要「等界面变化」的轮询循环，每轮必须 `ui_gen_bump`**（wait_for /
# wait_stable 已内置）。否则 45 次轮询会在一瞬间读完同一份缓存，把首屏慢渲染误判成 fail。
UI_GEN=0
UI_CACHE_GEN=-1
UI_CACHE=""
ui_gen_bump() { UI_GEN=$((UI_GEN + 1)); }

# dump 计数（跨子 shell 只能靠文件累加）：给「改前/改后」的耗时留证据。
# 未设 UI_DUMP_LOG 时是空操作，不引入任何开销。
_ui_dump_count() {
  [ -n "${UI_DUMP_LOG:-}" ] && printf '%s\n' "${SECONDS:-0}" >> "$UI_DUMP_LOG"
  return 0
}

adb_() {
  case "$*" in
    *" input "*|*" am start "*|*" am force-stop "*|*" am kill "*|*" cmd overlay "*|*" settings put "*|*" svc "*|*" pm clear "*|*" ime set "*)
      ui_gen_bump ;;
  esac
  "$ADB_BIN" -s "$SERIAL" "$@"
}

# ── 无障碍树 ───────────────────────────────────────────────────────────
DUMP=/sdcard/fe558-ui.xml

# 单次 dump 的硬上限（秒）。`uiautomator` 在「界面永远不 idle」的页面上会**一直挂住**：
# 2026-09-19 实测在 PROB-1 详情页卡了 11 分钟（设备侧 uiautomator 停在 `__arm64_sys_nanosleep`，
# 本地 adb 与整轮验收一起僵住、没有任何日志与产物）。所以要给每次尝试加上限：到点先杀本地
# 客户端，再**单独清掉设备侧的 uiautomator**（它不会随本地 adb 一起退出），否则下一次尝试会撞上它。
# 实现是 0.2s 粒度的轮询（不用看门狗子进程：在命令替换里 `wait` 的行为不稳），健康路径只多 ~0.1s。
# 上限别调太大：**持续动画的页面（如聊天的工作中 pill）会让每次 dump 都等到上限**，
# 8s × 3 次重试 = 每次取树 ~24s，整轮被判据的等待次数放大（2026-09-19 实测 C8d 因此变得很慢）。
DUMP_TIMEOUT_SECS="${DUMP_TIMEOUT_SECS:-5}"
_dump_bounded() {
  local p i=0 max
  max=$(( DUMP_TIMEOUT_SECS * 5 ))   # 每轮 0.2s，健康路径只多花 ~0.1s
  adb_ shell rm -f "$DUMP" >/dev/null 2>&1
  adb_ shell uiautomator dump "$DUMP" >/dev/null 2>&1 &
  p=$!
  while kill -0 "$p" 2>/dev/null; do
    i=$(( i + 1 ))
    if [ "$i" -ge "$max" ]; then
      kill "$p" 2>/dev/null
      adb_ shell pkill -f uiautomator >/dev/null 2>&1
      wait "$p" 2>/dev/null
      return 1
    fi
    sleep 0.2
  done
  wait "$p" 2>/dev/null
  return $?
}

ui_dump() {
  local i xml
  for i in 1 2 3; do
    if [ "${DUMP_TIMEOUT_SECS:-0}" = 0 ]; then
      adb_ shell rm -f "$DUMP" >/dev/null 2>&1
      adb_ shell uiautomator dump "$DUMP" >/dev/null 2>&1
    else
      _dump_bounded || continue
    fi
    _ui_dump_count
    xml="$(adb_ shell cat "$DUMP" 2>/dev/null)"
    [ -n "$xml" ] && { printf '%s' "$xml"; return 0; }
  done
  return 1
}

# 带缓存的无障碍树（世代号见 `adb_` 上方说明）。dump 失败时**不写缓存**、返回非 0，
# 绝不把上一次的界面当这一次的结果（文件头第 2 条）。本库不设 pipefail，所以判空而不是判管道退出码。
ui_nodes() {
  if [ "$UI_CACHE_GEN" = "$UI_GEN" ]; then printf '%s' "$UI_CACHE"; return 0; fi
  local t
  t="$(ui_dump | tr '>' '\n')"
  [ -n "$t" ] || return 1
  UI_CACHE="$t"
  UI_CACHE_GEN="$UI_GEN"
  printf '%s' "$t"
}
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
# issue 详情页的通用判据：⋯ 按钮（content-desc=`Issue actions`）在**任意** issue 详情页都有。
# 旧版只认 `Activity` 与 PROB-1 的标题，于是 C4b 从收件箱点开 PROB-2 时必然等满 45 次 ≈
# 90s（2026-09-19 实测，靠新增的等待进度行才看出来：`WAIT 75s 等 on_issue_detail（第 16/45 次仍未命中）`
# 而屏幕上详情页早已渲染）。判定本身没错（C4b 另有 `any_text Activity PRB-2 长文档性能夹具` 兜底），
# 但每次白等一分半。
on_issue_detail() { has_desc "Issue actions" || any_text "Activity" "PROB Markdown 语法全覆盖"; }

# 原生 Alert 的按钮（标题与按钮同名时必须用它；1=positive，2=negative）
tap_dialog_button() {
  local which="${1:-1}" b
  b="$(ui_nodes | sed -n "s/.*resource-id=\"android:id\/button$which\".*bounds=\"\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]\".*/\1 \2 \3 \4/p" | head -1)"
  [ -n "$b" ] || return 1
  _tap_bounds "$b"
}

# 按 resource-id 取节点并点中心（原生对话框的按钮 id 不一定叫 buttonN）
tap_resource_id() {
  local b
  b="$(ui_nodes | sed -n "s/.*resource-id=\"$1\".*bounds=\"\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]\".*/\1 \2 \3 \4/p" | head -1)"
  [ -n "$b" ] || return 1
  _tap_bounds "$b"
}

# 有任何原生对话框就点掉（见文件头第 3 条）；没有对话框时是空操作。
#
# 额外覆盖 ANR 对话框：系统的「… isn't responding」用 `android:id/aerr_wait` /
# `aerr_close` 两个 id，**不是** button1/2，所以老实现只会空转，后续所有断言
# 都落在弹窗上。这里显式识别：记一行到 anr.log（ANR 本身是缺陷信号，不能静默吞掉），
# 再点 Wait 让流程继续，保证其余条目仍有结论。
dismiss_dialog() {
  local i
  if ui_nodes | grep -q 'resource-id="android:id/aerr_wait"'; then
    printf '%s ANR dialog: %s\n' "$(date -u +%H:%M:%S)" "$(texts | head -1)" >> "${OUT:-/tmp}/anr.log"
    tap_resource_id 'android:id/aerr_wait' >/dev/null 2>&1
    sleep 3
  fi
  for i in 1 2 3; do
    tap_dialog_button 1 >/dev/null 2>&1 || return 0
    sleep 2
  done
  return 0
}

# ── 等待（一律轮询，不用固定 sleep 猜时长）─────────────────────────────
#
# `ACCEPT_FAST=1` 时启用快速档（**不设该变量时行为与原来一致**，见 `fast558.sh`）：
#   1. 手势后的短等待上限压到 8 次（≈16s）——实测 app 手势响应 < 2s，而失败条目
#      要等满判定源写的 20 次 ≈ 40s 才被判 fail；一轮 16 条 fail/blocked 光等超时
#      就是 15~25 分钟（2026-09-19 实测：主跑 57 分钟里 4 条慢判据占 27 分钟）。
#   2. 判定源里**显式写了 > 20 次的长等待**（如 issue 首屏 45 次 ≈ 90s）不受影响 ——
#      那些是首屏串 8 个接口的正常耗时，压了会把 pass 判成 fail。
#   3. 出现 ANR / 系统无响应对话框就立刻收手（第 4 次轮询起才查，避免给快路径加开销）。
# 只改「等多久」，不改任何判据；判定差异一律以未开 FAST 的那次为准。
anr_terminal_state() {
  adb_ shell dumpsys window 2>/dev/null | grep -qE 'aerr_wait|aerr_close'
}

# 等待可见化（2026-09-19 用户反馈「卡在某个页面很久，不知道在等啥」）：
# 等待到第 WAIT_TRACE_AFTER 次轮询仍未命中，就按 WAIT_TRACE_EVERY 秒的节奏报一行
# 「在等什么、等了多久、第几次」；用满上限时补一行超时归因。`WAIT_TRACE=0` 可关。
# 行首刻意不用 `[`：`[pass]/[fail]` 是判定行的专属前缀，结果展示走 `grep -E '^\['`，
# 混进去会让「等待进度」和「验收结论」在日志里分不开。
WAIT_TRACE="${WAIT_TRACE:-1}"
WAIT_TRACE_AFTER="${WAIT_TRACE_AFTER:-4}"
WAIT_TRACE_EVERY="${WAIT_TRACE_EVERY:-10}"
wait_trace() { [ "$WAIT_TRACE" = 1 ] && printf '%s %ss %s\n' "$1" "$2" "$3" >&2; return 0; }

wait_for() {
  local tries="$1"; shift
  local i t0 next el
  t0="$SECONDS"
  next="$WAIT_TRACE_AFTER"
  if [ "${ACCEPT_FAST:-0}" = 1 ] && [ "$tries" -le 20 ] && [ "$tries" -gt "${ACCEPT_FAST_TRIES:-8}" ]; then
    tries="${ACCEPT_FAST_TRIES:-8}"
  fi
  for i in $(seq 1 "$tries"); do
    ui_gen_bump   # 轮询的意义就是等界面变化：每轮必须重新 dump（缓存见 adb_ 上方）
    "$@" >/dev/null 2>&1 && return 0
    el=$(( SECONDS - t0 ))
    if [ "${ACCEPT_FAST:-0}" = 1 ] && [ "$i" -ge 4 ] && anr_terminal_state; then
      printf '%s wait_for 提前收手（ANR 终态）：%s\n' "$(date -u +%H:%M:%S)" "$*" >> "${OUT:-/tmp}/fast-abort.log"
      wait_trace "WAITTMO" "$el" "ANR 终态提前收手（第 $i/$tries 次）：$*"
      return 1
    fi
    if [ "$i" -ge "$WAIT_TRACE_AFTER" ] && [ "$el" -ge "$next" ]; then
      wait_trace "WAIT" "$el" "等 $*（第 $i/$tries 次仍未命中）"
      next=$(( next + WAIT_TRACE_EVERY ))
    fi
  done
  wait_trace "WAITTMO" "$(( SECONDS - t0 ))" "$* 未命中（$tries 次轮询用满）"
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
    ui_gen_bump   # 同上：要看到「变了没有」，每轮都得重新 dump
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

# 被抢前台/被误判的现场留痕（判据之外的插曲，结论里要能看见发生了多少次）
note_interruption() {
  printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*" >> "${OUT:-.}/interruptions.log"
}

# dev-client 的「Development servers」页：**同样是本包、同样有文本节点**，
# 只看包名/文本条数会把它当成应用界面。2026-09-19 实测：V3 之后到 E3 的全部判据都落在
# 这个页面上（run/v3-dark-settings.png、run/e1-tabbar-gesture.png 就是它），结论全是假的。
dev_launcher_shown() { any_text "New development server" "DEVELOPMENT SERVERS"; }

# 「应用界面真的在前台」的完整判据：本包 + 不是 dev launcher + 有实际内容
app_ui_up() { app_focused && ! dev_launcher_shown && app_alive; }

# 冷启 / 回前台的统一入口。debug 构建**必须带 dev-client 的 url**：只发
# `am start -n PKG/.MainActivity` 会把 dev launcher 带回前台（2026-09-19 的假结论就是这么来的）。
# release 构建内嵌 JS，起 launcher activity 就是应用本身，也不依赖 8081 上的 bundler。
METRO_PORT="${METRO_PORT:-8081}"
app_launch() {
  if [ "$BUILD_VARIANT" = release ]; then
    adb_ shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
    return 0
  fi
  adb_ shell am start -n "$PKG/.MainActivity" -a android.intent.action.VIEW \
    -d "$DEVCLIENT_SCHEME://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A$METRO_PORT" >/dev/null 2>&1
}

# 轻量守卫（给每次 tap / 截图用）：只在前台既不是本包、也不是输入法时才动手。
# `dumpsys window` ≈0.2s，不 dump 树，所以可以挂在热路径上。
# 实测 2026-09-19 C8：系统设置页（Display over other apps）抢了前台，之后所有判据全判错。
app_guard() {
  local f
  f="$(current_focus)"
  case "$f" in
    *"$PKG"*) return 0 ;;
    *nputMethod*|*inputmethod*) return 0 ;;
  esac
  note_interruption "前台不是本包：${f:-（取不到）}"
  adb_ shell input keyevent KEYCODE_BACK >/dev/null 2>&1
  sleep 1
  app_focused && return 0
  app_launch
  wait_for 40 app_ui_up || true
  return 0
}

# 「在 tab 根」判据（549 capture-visual.sh 同款）
in_tab_root() { any_text "My Issues" && has_text "More"; }

# 把应用界面拉回前台（被系统返回手势误退到桌面 / 停在 dev launcher 时先兜回来）
ensure_foreground() {
  app_ui_up && return 0
  note_interruption "应用界面不在前台，拉回应用（focus=$(current_focus | head -c 60)）"
  app_launch
  wait_for 40 app_ui_up || true
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
  # 先确认应用界面在前台：否则下面的 BACK 会按在桌面/dev launcher 上，越按越乱
  ensure_foreground
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

# 冷启：debug 构建必须用 dev-client intent（否则停在服务器列表页）；release 直接起应用，
# 没有 dev-client launcher 的 "Continue" 按钮，不能等它。
cold_start() {
  local port="${1:-$METRO_PORT}"
  adb_ shell am force-stop "$PKG" >/dev/null 2>&1
  sleep 2
  METRO_PORT="$port" app_launch
  if [ "$BUILD_VARIANT" != release ]; then
    wait_text 15 "Continue" && tap_text "Continue" >/dev/null 2>&1
  fi
  return 0
}

# ── 交互 ───────────────────────────────────────────────────────────────
_tap_bounds() {
  local b="$1" x1 y1 x2 y2
  [ -n "$b" ] || return 1
  app_guard   # 点之前确认前台还是我们的应用（见 app_guard 注释）
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

# 截图前先确认前台是本应用：证据要么可信，要么当场发现被抢前台（记 interruptions.log）。
# 故意要在后台/桌面取证的地方（如 V2 的 launcher 帧）用 shot_bg。
shot()    { app_guard; adb_ exec-out screencap -p > "$OUT/$1.png" 2>/dev/null; }
shot_bg() { adb_ exec-out screencap -p > "$OUT/$1.png" 2>/dev/null; }

# 一次输入场景观测：截图 + state.log 一行
# 判定 visible（焦点输入框整块在键盘上方）/ partial / covered / no-ime
probe_ime() {
  local name="$1" ime_top_v focus root verdict y1 y2 line
  ime_top_v="$(ime_top)"; root="$(root_rect)"; focus="$(focused_rect)"
  shot "$name"
  verdict=no-ime
  if ime_up && [ -n "$focus" ]; then
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
# 每条判定的耗时（相邻两次 check 之差 = 本条目实际花费，含它自己的等待与截图）。
# 落成一行一行的 timings.tsv，收尾在 summary.txt 里给「最慢 N 条」——
# 「慢在哪」要能对着数字说，不靠体感（2026-09-19 用户反馈）。
CHECK_T0="${CHECK_T0:-$SECONDS}"
CHECK_SLOW_SECS="${CHECK_SLOW_SECS:-60}"
CHECK_PREFIX="${CHECK_PREFIX:-}"   # 定向重查时设成「重测：」，让结果表里能区分重查行

check() {
  local id="$1" verdict="$2" detail="${CHECK_PREFIX}${3:-}" secs
  secs=$(( SECONDS - CHECK_T0 ))
  CHECK_T0="$SECONDS"
  printf '%s\t%s\t%s\n' "$id" "$verdict" "$detail" >> "$OUT/results.tsv"
  printf '%s\t%s\t%s\n' "$id" "$verdict" "$secs" >> "$OUT/timings.tsv"
  printf '[%-7s] %-6s %s\n' "$verdict" "$id" "$detail"
  [ "$secs" -ge "$CHECK_SLOW_SECS" ] && printf 'SLOW   %s 用了 %ss（本条判定 + 它自己的等待）\n' "$id" "$secs" >&2
  return 0
}

# 像素采样：sample <png> <x> <y> → "r g b"
sample() {
  "$PY_BIN" - "$1" "$2" "$3" <<'PY'
import sys
from PIL import Image
img = Image.open(sys.argv[1]).convert("RGB")
print(*img.getpixel((int(sys.argv[2]), int(sys.argv[3]))))
PY
}

# 区域平均亮度：luma <png> <x1> <y1> <x2> <y2>
luma() {
  "$PY_BIN" - "$@" <<'PY'
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


# ══════════════════════════════════════════════════════════════════════
# FEATURE-558 新增原语（551 没有的三个 + 假 daemon 模式开关）
# ══════════════════════════════════════════════════════════════════════

# 双击。<x> <y> 为点击点。
#
# 为什么不能直接连调两次 `tap_xy`：每次 `adb shell input tap` 都要在设备上新起一个
# `input` 进程，两次外部调用的间隔实测常在 300ms 上下，而 react-native-image-viewing
# 的双击判定窗口正是 300ms（`dist/hooks/usePanResponder.js:16` DOUBLE_TAP_DELAY=300，
# 依据 `Date.now() - lastTapTS`）。超窗就退化成两次单击，缩放永远不触发。
# 这里把两次点击放进**同一次** adb shell 调用，两个 `input` 进程在设备上背靠背启动。
double_tap_xy() {
  local x="$1" y="$2"
  adb_ shell "input tap $x $y; input tap $x $y" >/dev/null 2>&1
  return 0
}

# 图片块定位。夹具图是黑白棋盘格（见 make-fixture-images.py），在浅色正文里
# 表现为一条高对比带。扫描截图，按行统计「暗像素占比」，取最长的一条连续行带，
# 再在该带内取暗像素的横向范围，输出 "x1 y1 x2 y2"（找不到输出空串）。
#
# 为什么不用无障碍树：MarkdownImage 的 Pressable 没有 accessibilityLabel，
# uiautomator dump 里没有可定位的图片节点（551 因此只能把 B5 记为未覆盖）。
image_block_bounds() {
  "$PY_BIN" - "$1" <<'PY'
import sys
from PIL import Image

img = Image.open(sys.argv[1]).convert("L")
w, h = img.size
px = img.load()
step = 8
dark = 100
rows = []
for y in range(h):
    n = 0
    for x in range(0, w, step):
        if px[x, y] < dark:
            n += 1
    rows.append(n)
min_row_hits = max(12, (w // step) // 5)
runs = []
start = None
for y, n in enumerate(rows):
    if n >= min_row_hits:
        if start is None:
            start = y
    elif start is not None:
        runs.append((start, y - 1))
        start = None
if start is not None:
    runs.append((start, h - 1))
if not runs:
    print("")
    sys.exit(0)
y1, y2 = max(runs, key=lambda r: r[1] - r[0])
if y2 - y1 < 40:          # 太薄的一条线，不是图片块
    print("")
    sys.exit(0)
xs = [x for y in range(y1, y2 + 1, 4) for x in range(0, w, 4) if px[x, y] < dark]
if not xs:
    print("")
    sys.exit(0)
print(f"{min(xs)} {y1} {max(xs)} {y2}")
PY
}

# 两张截图的差异像素占比（0~1，采样步长 4）。用来判定「双击缩放是否真的发生」：
# 图片被放大后，视口内的图案整体位移/放大，差异占比远高于噪声（实测阈值 0.05 足够）。
png_diff_ratio() {
  "$PY_BIN" - "$1" "$2" <<'PY'
import sys
from PIL import Image

a = Image.open(sys.argv[1]).convert("RGB")
b = Image.open(sys.argv[2]).convert("RGB")
if a.size != b.size:
    print("-1")
    sys.exit(0)
pa, pb = a.load(), b.load()
w, h = a.size
step = 4
diff = total = 0
for y in range(0, h, step):
    for x in range(0, w, step):
        ca, cb = pa[x, y], pb[x, y]
        total += 1
        if abs(ca[0] - cb[0]) + abs(ca[1] - cb[1]) + abs(ca[2] - cb[2]) > 30:
            diff += 1
print(round(diff / max(1, total), 4))
PY
}

# 假 runtime daemon 的模式（success / fail / pending）。daemon 每轮认领前读一次该文件，
# 于是脚本能在不重启它的前提下切换行为；文件不存在时 daemon 回退到环境变量。
write_mode() {
  [ -n "${FAKE_MODE_FILE:-}" ] || return 0
  printf '%s\n' "$1" > "$FAKE_MODE_FILE"
  return 0
}

# 无障碍树文本值 / 描述值的**正则**匹配。
#
# has_text 是「整值精确匹配」（它找的是 `text="<needle>"` 字面量，含收尾引号），
# 而聊天气泡上方的状态 pill 是「文案 · 计时」，例如 `Thinking · 3s`
# （`components/chat/status-pill.tsx` 渲染 label + ` · Ns`），整值匹配永远打不中。
# 需要按前缀/正则判定的地方用这两个。
texts_re() { texts | grep -E -- "$1"; }
has_text_re() { texts | grep -qE -- "$1"; }
has_desc_re() { descs | grep -qE -- "$1"; }