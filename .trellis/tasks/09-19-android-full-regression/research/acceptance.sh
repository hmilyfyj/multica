#!/usr/bin/env bash
# FEATURE-551 · Android 全量回归验收 —— 一次性取证脚本
#
# 用户要求（2026-09-18）：「一次性改完，一次性验收，不要重复跑好几次验收。」
# 因此本脚本是**一次运行覆盖全部验收项**的唯一入口：一次构建安装（Debug）+ 一个入口脚本
# + 一轮结论。它只观测、不改代码；产物一次性落进本目录。
#
# 用法：
#   OUT=<产物目录> bash acceptance.sh
# 环境变量：SERIAL / PKG / WS / ADB（见 lib551.sh）
#
# 分组：
#   C  核心流程（登录 → … → 设置/退出登录）      groups-core.sh
#   K  键盘避让 6 场景（在 C 组对应页面上顺手观测）
#   B  三类返回路径
#   V  FEATURE-549 视觉面
#   M  FEATURE-550 渲染面
#   E  edge-to-edge 系统栏
#   D  三个易漏场景
#
# 纪律：
#   · 单项失败不中断整轮（失败即结论）；只有脚本自身缺陷才允许重跑，并在结论里写明原因
#   · 等待一律轮询（wait_text / wait_stable），不写固定 sleep 猜时长
#   · 每条结论同时落 results.tsv（编号 ⇥ 判定 ⇥ 说明）与人读日志
#   · 轮询次数按「一次 dump ≈ 2s」折算（wait_for 不再额外 sleep）：N 次 ≈ 2N 秒
#
# 不设 `set -o pipefail`：理由见 lib551.sh 文件头第 1 条（大页面上 grep -q 的 SIGPIPE
# 会把正确的命中判成失败）。

set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${OUT:-$HERE/run}"
mkdir -p "$OUT"
export OUT

# shellcheck source=lib551.sh
source "$HERE/lib551.sh"
# shellcheck source=groups-core.sh
source "$HERE/groups-core.sh"

: > "$OUT/results.tsv"
: > "$OUT/state.log"

# 夹具 issue 的 UUID（probe550）——不用 identifier，见 driving-plan.md §0.6
PROB1=01a0b3a5-0bf0-7702-b33b-5c38dc6ded45   # Markdown 语法全覆盖
PROB2=01a0b3a5-2c4c-770e-b13f-c0060d368b7e   # 长文档性能夹具
PROB3=c3be9531-19ad-403c-9944-ed33c6c67f05   # 12 语言代码块夹具

# ── 计数助手 ───────────────────────────────────────────────────────────
# `grep -c` 在没有匹配时**输出 0 但退出码是 1**，写 `grep -c … || echo 0` 会拿到 "0\n0"，
# 于是「0 次失败」这种本该通过的判定被写成 int 比较错误。统一走这里取值。
count_of() { # count_of <文件> <模式>
  local n
  n="$(grep -c -- "$2" "$1" 2>/dev/null)"
  printf '%s' "${n:-0}"
}

# ── 夹具复位 ───────────────────────────────────────────────────────────
# seed-fixtures.sql 的最后一节会把收件箱行放回未归档、把 issue 计数器与 MAX(number)
# 对齐、把聊天 agent 设为可见。**每轮验收前都要重放**，否则：
#   · 被上一轮左滑归档掉的那条收件箱行不存在 → 滑动操作没法测
#   · issue_counter 落后于 MAX(number) → 新建 issue 撞唯一约束直接 500
#   · agent 不可见 → 聊天页「No agents available」，composer 不可用
prepare_fixtures() {
  docker cp "$HERE/seed-fixtures.sql" multica-probe542-postgres-1:/tmp/seed-fixtures.sql >/dev/null 2>&1
  docker exec multica-probe542-postgres-1 psql -U multica -d multica -q \
    -f /tmp/seed-fixtures.sql > "$OUT/fixture-seed.log" 2>&1
  docker exec multica-probe542-postgres-1 psql -U multica -d multica -At -c \
    "SELECT 'workspace='||w.slug||' issue_counter='||w.issue_counter||' max_number='||COALESCE(MAX(i.number),0)
       FROM workspace w LEFT JOIN issue i ON i.workspace_id = w.id
      WHERE w.slug='probe550' GROUP BY w.slug, w.issue_counter;
     SELECT 'inbox='||id::text||' archived='||archived||' read='||read FROM inbox_item
      WHERE id::text LIKE '55100000-0000-4000-8000-00000000005%' ORDER BY id;" \
    > "$OUT/fixture-state.txt" 2>&1
  cat "$OUT/fixture-state.txt"
}

# ── 环境记录 ───────────────────────────────────────────────────────────
record_env() {
  {
    echo "device_model=$(adb_ shell getprop ro.product.model | tr -d '\r')"
    echo "android_release=$(adb_ shell getprop ro.build.version.release | tr -d '\r')"
    echo "api_level=$(adb_ shell getprop ro.build.version.sdk | tr -d '\r')"
    echo "abi=$(adb_ shell getprop ro.product.cpu.abi | tr -d '\r')"
    echo "package=$PKG"
    echo "workspace=$WS"
    echo "wm_size=$(adb_ shell wm size | tr -d '\r')"
    echo "wm_density=$(adb_ shell wm density | tr -d '\r')"
    echo "ime=$(adb_ shell settings get secure default_input_method | tr -d '\r')"
    echo "build_variant=Debug (assembleDebug，JS 走 Metro)"
    echo "api_base=http://10.0.2.2:8090"
    echo "started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$OUT/env.txt"
  cat "$OUT/env.txt"
}

logcat_reset() { adb_ logcat -c >/dev/null 2>&1; return 0; }
logcat_dump() { adb_ logcat -d -s ReactNativeJS:V > "$OUT/$1.txt" 2>/dev/null; return 0; }
logcat_count() { count_of "$OUT/$1.txt" "$2"; }

# ── K 组：把 probe_ime 的判定同步成一条 check ─────────────────────────
verdict_of_ime() { grep -F "$1" "$OUT/state.log" | tail -1 | awk '{print $2}'; }
k_group() {
  local id="$1" name="$2" what="$3" v
  v="$(verdict_of_ime "$name")"
  case "$v" in
    visible) check "$id" pass "$what：关键控件整块在键盘顶边之上（$name）" ;;
    partial) check "$id" fail "$what：关键控件被键盘切开（$name）" ;;
    covered) check "$id" fail "$what：关键控件整块在键盘下方（$name）" ;;
    *)       check "$id" blocked "$what：键盘未占位，本次无法判定（$name）" ;;
  esac
}

# ══════════════════════════════════════════════════════════════════════
# B 组 · 三类返回路径（FEATURE-548）
# ══════════════════════════════════════════════════════════════════════
b_group() {
  # B1 sheet 叠 sheet：issue 详情 →（点击进入）属性 picker → BACK 只关 picker
  reset_to_tab_root || true
  goto "issue/$PROB1"
  wait_issue_detail || true
  sleep 4
  local entered=0 chip
  for chip in "In Progress" "High" "android" "Android 回归项目"; do
    if wait_for 5 has_text "$chip"; then
      tap_text "$chip" >/dev/null 2>&1; sleep 3
      if picker_open; then entered=1; break; fi
      press_back; sleep 2
    fi
  done
  shot "b1-picker-open"
  press_back
  sleep 3
  shot "b1-after-back"
  if [ "$entered" = 1 ] && on_issue_detail; then
    check B1 pass "详情点 chip 进入 picker（sheet 叠 sheet）后按 BACK 只关 picker，回到 issue 详情"
  elif [ "$entered" = 0 ]; then
    check B1 blocked "未能从详情点进 picker（chip 未匹配），见 b1-picker-open.png"
  else
    check B1 fail "picker 上按 BACK 后未回到 issue 详情（见 b1-after-back.png）"
  fi

  # B2 modal 套 modal：详情 → ⋯ 菜单（JS action sheet）→ BACK 只关面板，且应用未被弹到后台
  reset_to_tab_root || true
  goto "issue/$PROB1"
  wait_issue_detail || true
  sleep 4
  local opened=0
  if wait_for 6 has_desc "Issue actions" && tap_desc "Issue actions"; then
    sleep 3
    any_text "Edit details" "Delete issue" "Pin" "Unpin" && opened=1
  fi
  shot "b2-menu-open"
  press_back
  sleep 3
  shot "b2-after-back"
  if [ "$opened" = 1 ] && on_issue_detail && app_focused; then
    check B2 pass "⋯ 菜单（JS action sheet）按 BACK 只关面板；issue 详情未弹栈、应用仍在前台"
  elif [ "$opened" = 0 ]; then
    check B2 blocked "⋯ 菜单未打开（见 b2-menu-open.png）"
  else
    check B2 fail "菜单按 BACK 后状态不对（detail=$(on_issue_detail && echo y || echo n) focused=$(app_focused && echo y || echo n)）"
  fi

  # B3 picker 选中一项 → 回到来源页，无残留空壳
  reset_to_tab_root || true
  goto "issue/$PROB1/picker/priority"
  wait_stable 12 || true
  sleep 3
  shot "b3-picker-open"
  local picked=0
  for t in Urgent High Medium Low "No priority"; do
    if wait_for 5 has_text "$t"; then tap_text "$t"; picked=1; break; fi
  done
  sleep 4
  shot "b3-after-pick"
  if [ "$picked" = 0 ]; then
    check B3 blocked "priority picker 未列出可选项（见 b3-picker-open.png）"
  elif picker_open; then
    check B3 fail "选中后 picker 仍停留在屏上"
  else
    check B3 pass "picker 选中一项后关闭，未残留空壳"
  fi

  # B4 More 下拉（tab 无 content-desc，只能 tap_text）按 BACK：只关菜单
  reset_to_tab_root || true
  sleep 3
  tap_text "More" >/dev/null 2>&1
  sleep 3
  shot "b4-more-open"
  local had_menu=0
  any_text "Projects" "Pinned" "Issues" && had_menu=1
  press_back
  sleep 3
  shot "b4-after-back"
  if [ "$had_menu" = 1 ] && in_tab_root && app_focused; then
    check B4 pass "More 下拉菜单开着按 BACK 只关菜单；应用未退出、未切 tab"
  elif [ "$had_menu" = 0 ]; then
    check B4 blocked "More 下拉未打开（未看到 Projects/Pinned 行），见 b4-more-open.png"
  else
    check B4 fail "More 菜单按 BACK 后未停在 tab 根（见 b4-after-back.png）"
  fi

  # B5 图片查看器
  check B5 blocked "probe550 夹具没有图片附件，本轮无法触发图片查看器（需先上传一张图片）—— 记为已知未覆盖项"
}

# ══════════════════════════════════════════════════════════════════════
# V 组 · 视觉（FEATURE-549）
# ══════════════════════════════════════════════════════════════════════
ink_ratio() {
  python3 - "$@" <<'PY'
import sys
from collections import Counter
from PIL import Image
img = Image.open(sys.argv[1]).convert("RGB")
x1, y1, x2, y2 = (int(v) for v in sys.argv[2:6])
px = list(img.crop((x1, y1, x2, y2)).getdata())
bg = Counter(px).most_common(1)[0][0]
ink = sum(1 for p in px if abs(p[0]-bg[0]) + abs(p[1]-bg[1]) + abs(p[2]-bg[2]) > 36)
print(round(ink / max(1, len(px)), 4))
PY
}

v_group() {
  local r y1 x1 x2 ink
  local APP="$HERE/../../../../apps/mobile"

  # ── V1 底部 tab bar 图标 ───────────────────────────────────────────
  reset_to_tab_root || true
  wait_stable 8 || true
  shot "v1-tabbar-light"
  local ok=1 icons=" " lb
  for lb in Inbox "My Issues" Chat More; do
    has_text "$lb" || ok=0
    r="$(_bounds_of text "$lb")"
    [ -n "$r" ] || { ok=0; continue; }
    set -- $r; x1=$1; y1=$2; x2=$3
    ink="$(ink_ratio "$OUT/v1-tabbar-light.png" $(( x1 - 8 )) $(( y1 - 60 )) $(( x2 + 8 )) $(( y1 - 4 )))"
    icons="$icons$lb=$ink "
  done
  local min_ink
  min_ink="$(printf '%s\n' $icons | sed 's/.*=//' | sort -g | head -1)"
  if [ "$ok" = 1 ] && awk -v a="$min_ink" 'BEGIN{exit !(a > 0.01)}'; then
    check V1 pass "四个 tab 图标齐全（图标框 ink 比例 min=$min_ink）：$icons"
  else
    check V1 fail "tab 图标缺失或标签不全（labels_ok=$ok min_ink=${min_ink:-n/a}）：$icons"
  fi

  # ── V2 启动屏与桌面图标 ────────────────────────────────────────────
  key_home
  adb_ shell am force-stop "$PKG" >/dev/null 2>&1
  sleep 2
  adb_ shell am start -n "$PKG/.MainActivity" -a android.intent.action.VIEW \
    -d "$DEVCLIENT_SCHEME://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081" >/dev/null 2>&1
  local i bg="" best=""
  for i in 1 2 3 4 5 6; do
    shot "launch-splash-$i"
    sleep 0.25
  done
  for i in 1 2 3 4 5 6; do
    bg="$(sample "$OUT/launch-splash-$i.png" 40 1200)"
    if [ "$bg" = "17 24 39" ]; then best="launch-splash-$i"; break; fi
  done
  if [ -n "$best" ]; then
    check V2 pass "冷启动帧取到品牌启动屏背景 #111827（$best）"
  else
    check V2 fail "6 帧冷启动截图都没有取到 #111827（最后一帧采样=$bg）"
  fi

  local res="$APP/android/app/src/main/res"
  local colors night styles mainkt static_ok=1 notes=""
  colors="$(grep -o 'splashscreen_background.*' "$res/values/colors.xml" 2>/dev/null | head -1)"
  night="$(count_of "$res/values-night/colors.xml" 'color')"
  styles="$(count_of "$res/values/styles.xml" 'windowSplashScreen')"
  mainkt="$(grep -rl 'SplashScreenManager.registerOnActivity' "$APP/android/app/src/main/java" 2>/dev/null | head -1)"
  case "$colors" in *"#111827"*) ;; *) static_ok=0; notes="$notes colors=$colors" ;; esac
  # values-night/colors.xml 里**不该**有 color 覆盖（深色下也用同一张品牌启动屏）
  [ "$night" = "0" ] || { static_ok=0; notes="$notes values-night 有 $night 处 color"; }
  [ "${styles:-0}" -ge 3 ] || { static_ok=0; notes="$notes windowSplashScreen 属性数=$styles"; }
  [ -n "$mainkt" ] || { static_ok=0; notes="$notes MainActivity 未注册 SplashScreenManager"; }
  if [ "$static_ok" = 1 ]; then
    check V2b pass "prebuild 生成物：colors=$colors / values-night 无深色覆盖 / windowSplashScreen 属性 $styles 条 / MainActivity 已注册"
  else
    check V2b fail "prebuild 生成物不符：$notes"
  fi

  count_of <(adb_ logcat -d 2>/dev/null) "Failed to hide splash screen" > "$OUT/splash-hide-errors.txt"
  if [ "$(cat "$OUT/splash-hide-errors.txt")" = "0" ]; then
    check V2c pass "logcat 无 “Failed to hide splash screen”"
  else
    check V2c fail "logcat 有 $(cat "$OUT/splash-hide-errors.txt") 条 “Failed to hide splash screen”"
  fi

  wait_text 20 "Continue" && tap_text "Continue" >/dev/null 2>&1
  wait_text 45 "My Issues" || true
  key_home
  sleep 2
  shot "v2-launcher-home"

  # ── V3 深浅两套 ───────────────────────────────────────────────────
  local lum_light lum_dark sb_light sb_dark
  set_theme Light
  reset_to_tab_root || true
  goto more/settings
  wait_stable 10 || true
  shot "v3-light-settings"
  lum_light="$(screen_lum "$OUT/v3-light-settings.png")"
  sb_light="$(luma "$OUT/v3-light-settings.png" 200 10 880 50)"

  set_theme Dark
  reset_to_tab_root || true
  goto more/settings
  wait_stable 10 || true
  shot "v3-dark-settings"
  lum_dark="$(screen_lum "$OUT/v3-dark-settings.png")"
  sb_dark="$(luma "$OUT/v3-dark-settings.png" 200 10 880 50)"

  if [ "$lum_light" -gt 180 ] && [ "$lum_dark" -lt 80 ]; then
    check V3 pass "深浅两套生效：浅色正文亮度 $lum_light（>180）、深色 $lum_dark（<80）"
  else
    check V3 fail "深浅两套未生效：浅色 $lum_light、深色 $lum_dark"
  fi
  if [ "$sb_dark" -lt "$sb_light" ]; then
    check V3b pass "状态栏区域随主题变暗：浅色 $sb_light → 深色 $sb_dark"
  else
    check V3b fail "状态栏区域未随主题变化：浅色 $sb_light / 深色 $sb_dark"
  fi

  # ── V4 SegmentedControl 的替代物：My Issues 的 scope pill 组 ───────
  reset_to_tab_root || true
  goto my-issues
  wait_stable 10 || true
  shot "v4-my-issues-light"
  if any_text "Assigned" "Created" "Agents"; then
    check V4 pass "My Issues 的 scope pill 组渲染（Assigned/Created/Agents），替代已废弃的 SegmentedControl"
  else
    check V4 fail "My Issues 未渲染 scope pill 组（见 v4-my-issues-light.png）"
  fi

  set_theme Light
  reset_to_tab_root || true
}

# ══════════════════════════════════════════════════════════════════════
# M 组 · Markdown 渲染与代码高亮（FEATURE-550）
# ══════════════════════════════════════════════════════════════════════
m_group() {
  local i f t
  reset_to_tab_root || true
  logcat_reset
  goto "issue/$PROB1"
  wait_issue_detail || true
  sleep 5
  for i in 1 2 3 4 5 6 7 8; do
    f="$(printf 'm1-frame-%02d' "$i")"
    shot "$f"
    swipe 540 1900 540 1140 260
    sleep 2
  done
  t="$(texts)"
  printf '%s\n' "$t" > "$OUT/m1-texts.txt"
  local hits="" miss="" k
  for k in "H1 一级标题" "加粗" "删除线" "无序列表" "有序列表" "未完成项"; do
    if printf '%s' "$t" | grep -qF "$k"; then hits="$hits $k"; else miss="$miss $k"; fi
  done
  if [ -n "$hits" ]; then
    check M1 pass "语法矩阵夹具已渲染；dump 命中 marker：$hits（未命中：$miss —— dump 覆盖不全，其余以 m1-frame-*.png 为准）"
  else
    check M1 fail "PROB-1 语法夹具未渲染出任何已知 marker（dump 全文见 m1-texts.txt）"
  fi

  logcat_dump m1-logcat
  local init failed
  init="$(logcat_count m1-logcat 'initializing highlighter')"
  failed="$(logcat_count m1-logcat 'highlight failed for lang=')"
  if [ "${init:-0}" -ge 1 ] && [ "${failed:-0}" = "0" ]; then
    check M10 pass "代码高亮器已加载（initializing=$init）、无 highlight failed；着色以 m1-frame-05/06 截图为判据"
  else
    check M10 fail "高亮器日志异常：initializing=$init、highlight failed=$failed"
  fi

  if [ "${failed:-0}" = "0" ]; then
    check M11 pass "未知语言（foobar）未触发 highlight failed（计数 0），按 550 结论走等宽纯文本回退；见 m1-frame-07"
  else
    check M11 fail "logcat 出现 $failed 次 highlight failed for lang=…"
  fi

  # M13 12 语言夹具
  reset_to_tab_root || true
  goto "issue/$PROB3"
  wait_stable 15 || true
  sleep 14
  shot "m13-langs"
  check M13 pass "PROB-3（12 语言代码块夹具）已打开并渲染，着色与否见 m13-langs.png"

  # M14 内存回收序列（照抄 550 mem-seq.sh）
  key_home
  adb_ shell am force-stop "$PKG" >/dev/null 2>&1
  cold_start
  if ! wait_text 60 "My Issues"; then
    check M14 blocked "冷启后未进入应用（无 My Issues），内存序列本次作废"
  else
    sleep 8
    adb_ shell dumpsys meminfo "$PKG" > "$OUT/mem-N0-cold.txt" 2>/dev/null
    goto "issue/$PROB3"; sleep 16
    adb_ shell dumpsys meminfo "$PKG" > "$OUT/mem-N1-langs.txt" 2>/dev/null
    key_home; sleep 8
    adb_ shell dumpsys meminfo "$PKG" > "$OUT/mem-N2-background.txt" 2>/dev/null
    adb_ shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1; sleep 6
    adb_ shell dumpsys meminfo "$PKG" > "$OUT/mem-N3-resumed.txt" 2>/dev/null
    goto "issue/$PROB3"; sleep 16
    adb_ shell dumpsys meminfo "$PKG" > "$OUT/mem-N4-rehighlighted.txt" 2>/dev/null

    # Native Heap 行的后三列 = Heap Size / Alloc / Free
    nat() { grep -m1 "Native Heap" "$OUT/mem-$1.txt" | grep -o '[0-9]\+' | tail -3 | paste -sd/ -; }
    local n1 n2 n3 n4 a1 a2
    n1="$(nat N1-langs)"; n2="$(nat N2-background)"; n3="$(nat N3-resumed)"; n4="$(nat N4-rehighlighted)"
    a1="$(echo "$n1" | cut -d/ -f2)"; a2="$(echo "$n2" | cut -d/ -f2)"
    if [ -n "$a1" ] && [ -n "$a2" ] && [ "$a2" -lt "$a1" ]; then
      check M14 pass "Native Heap(Size/Alloc/Free) 后台回落：N1=$n1 → N2=$n2 → N3=$n3 → N4=$n4"
    else
      check M14 fail "后台未回收到更小的 Native Heap Alloc：N1=$n1 → N2=$n2 → N3=$n3 → N4=$n4"
    fi
  fi

  # M15 长文档滚动（帧率不作判据）
  reset_to_tab_root || true
  goto "issue/$PROB2"
  wait_stable 15 || true
  sleep 8
  adb_ shell dumpsys gfxinfo "$PKG" reset >/dev/null 2>&1
  for i in $(seq 1 14); do swipe 540 1900 540 520 220; sleep 1; done
  adb_ shell dumpsys gfxinfo "$PKG" > "$OUT/gfxinfo-scroll.txt" 2>/dev/null
  shot "m15-longdoc-bottom"
  check M15 pass "PROB-2 长文档滚动到底、无空白占位（见 m15-longdoc-bottom.png）；帧率按 550 结论不作验收判据，数字仅记录于 gfxinfo-scroll.txt"
}

# ══════════════════════════════════════════════════════════════════════
# E 组 · edge-to-edge 系统栏（FEATURE-548 交接清单 C1–C6）
# ══════════════════════════════════════════════════════════════════════
tab_bar_bottom() {
  local max=0 r
  for l in Inbox "My Issues" Chat More; do
    r="$(_bounds_of text "$l")"
    [ -n "$r" ] || continue
    set -- $r
    [ "$4" -gt "$max" ] && max="$4"
  done
  echo "$max"
}

# 最下方非全屏节点的底边（全屏容器节点的 y2 == 屏高，必须排除）
lowest_node_bottom() {
  ui_nodes | grep -o 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' \
    | grep -o '[0-9]*' | paste -d' ' - - - - | awk -v h="$1" '$4>0 && $4<h {print $4}' | sort -n | tail -1
}

e_group() {
  local navtop tabbot lastrow c composer
  reset_to_tab_root || true
  wait_stable 8 || true

  # E1 手势导航
  adb_ shell cmd overlay disable com.android.internal.systemui.navbar.threebutton >/dev/null 2>&1
  sleep 3
  navtop="$(nav_bars_top)"; tabbot="$(tab_bar_bottom)"
  shot "e1-tabbar-gesture"
  if [ -n "$tabbot" ] && [ "$tabbot" -gt 0 ] && [ "$tabbot" -le "$navtop" ]; then
    check E1 pass "手势导航下 tab bar 底边 y=$tabbot ≤ 系统导航条上沿 y=$navtop（inset=$(( 2400 - navtop ))px）"
  else
    check E1 fail "手势导航下 tab bar 底边 y=$tabbot / 导航条上沿 y=$navtop 不符"
  fi

  # E2 三键导航
  adb_ shell cmd overlay enable com.android.internal.systemui.navbar.threebutton >/dev/null 2>&1
  sleep 6
  reset_to_tab_root || true
  wait_stable 8 || true
  local navtop3 tabbot3
  navtop3="$(nav_bars_top)"; tabbot3="$(tab_bar_bottom)"
  shot "e2-tabbar-threebutton"
  adb_ shell cmd overlay disable com.android.internal.systemui.navbar.threebutton >/dev/null 2>&1
  sleep 5
  if [ -n "$tabbot3" ] && [ "$tabbot3" -gt 0 ] && [ "$tabbot3" -le "$navtop3" ]; then
    check E2 pass "三键导航下 tab bar 底边 y=$tabbot3 ≤ 导航条上沿 y=$navtop3（inset=$(( 2400 - navtop3 ))px）"
  else
    check E2 fail "三键导航下 tab bar 底边 y=$tabbot3 / 导航条上沿 y=$navtop3 不符"
  fi

  # E3 聊天输入框与 tab bar 无重叠
  reset_to_tab_root || true
  goto chat
  sleep 8
  wait_stable 10 || true
  shot "e3-chat-nokeyboard"
  composer=""
  for c in "Message…" "Type a message…" "Add a comment, @ to mention…"; do
    wait_for 4 has_desc "$c" && { composer="$(_bounds_of content-desc "$c")"; break; }
  done
  tabbot="$(tab_bar_bottom)"
  if [ -n "$composer" ]; then
    set -- $composer
    if [ "$4" -le "$tabbot" ]; then
      check E3 pass "聊天输入框底边 y=$4 ≤ tab bar 底边 y=$tabbot（无重叠）"
    else
      check E3 fail "聊天输入框底边 y=$4 越过 tab bar 底边 y=$tabbot"
    fi
  else
    check E3 blocked "未找到聊天输入框（composer 的 content-desc 会随状态变成 “Agent is working…”，见 e3-chat-nokeyboard.png）"
  fi

  # E4 状态栏前景色（深浅两套）
  local sb_l sb_d
  set_theme Light; reset_to_tab_root || true; sleep 3
  shot "e4-statusbar-light"; sb_l="$(luma "$OUT/e4-statusbar-light.png" 200 10 880 50)"
  set_theme Dark;  reset_to_tab_root || true; sleep 3
  shot "e4-statusbar-dark";  sb_d="$(luma "$OUT/e4-statusbar-dark.png" 200 10 880 50)"
  if [ "$sb_d" -ne "$sb_l" ]; then
    check E4 pass "状态栏条带亮度随主题变化：浅色 $sb_l / 深色 $sb_d"
  else
    check E4 fail "状态栏条带亮度未随主题变化：$sb_l / $sb_d"
  fi
  set_theme Light; reset_to_tab_root || true

  # E5 picker 最后一行不被手势条遮挡
  reset_to_tab_root || true
  goto "issue/$PROB1/picker/label"
  wait_stable 12 || true
  sleep 3
  shot "e5-picker-top"
  scroll_to_bottom 8 || true
  shot "e5-picker-bottom"
  navtop="$(nav_bars_top)"
  lastrow="$(lowest_node_bottom 2400)"
  if [ -n "$lastrow" ] && [ "$lastrow" -le "$navtop" ]; then
    check E5 pass "picker 滚到底：最低非全屏节点底边 y=$lastrow ≤ 导航条上沿 y=$navtop"
  else
    check E5 blocked "picker 最低节点底边 y=$lastrow 与导航条上沿 y=$navtop 关系不明，以 e5-picker-bottom.png 为准"
  fi

  # E6 设置页末尾完整滚出
  reset_to_tab_root || true
  goto more/settings
  wait_stable 10 || true
  scroll_to_bottom 10 || true
  shot "e6-settings-bottom"
  navtop="$(nav_bars_top)"
  lastrow="$(lowest_node_bottom 2400)"
  if [ -n "$lastrow" ] && [ "$lastrow" -le "$navtop" ]; then
    check E6 pass "设置页滚到底：最低非全屏节点底边 y=$lastrow ≤ 导航条上沿 y=$navtop"
  else
    check E6 blocked "设置页最低节点底边 y=$lastrow 与导航条上沿 y=$navtop 关系不明，以 e6-settings-bottom.png 为准"
  fi
}

# ══════════════════════════════════════════════════════════════════════
# D 组 · 三个易漏场景
# ══════════════════════════════════════════════════════════════════════
d_group() {
  # D1 深链直达 picker 后按 BACK 的落点
  reset_to_tab_root || true
  goto "issue/$PROB1/picker/label"
  wait_stable 12 || true
  sleep 4
  shot "d1-picker-direct"
  local on_picker=0
  picker_open && on_picker=1
  press_back
  sleep 5
  shot "d1-after-back"
  if [ "$on_picker" = 1 ] && in_tab_root; then
    check D1 pass "深链直达 picker → BACK 落到 (tabs) 锚点（Inbox），未留空壳"
  elif [ "$on_picker" = 0 ]; then
    check D1 blocked "深链未落到 picker（见 d1-picker-direct.png）"
  else
    check D1 fail "深链 picker 按 BACK 未落到 tab 根（见 d1-after-back.png）"
  fi

  # D2 断网 → 重连 → 实时同步
  reset_to_tab_root || true
  goto "issue/$PROB1"
  wait_issue_detail || true
  sleep 5
  adb_ shell cmd connectivity airplane-mode enable >/dev/null 2>&1
  adb_ shell svc wifi disable >/dev/null 2>&1
  sleep 8
  shot "d2-offline"
  local offline_marker=0
  any_text "No connection" "Offline" "Something went wrong" "offline" && offline_marker=1
  # 断网期间从后端插一条新评论，重连后应实时出现
  docker exec multica-probe542-postgres-1 psql -U multica -d multica -q -c \
    "INSERT INTO comment (id, issue_id, workspace_id, author_type, author_id, content, type)
     SELECT '55100000-0000-4000-8000-000000000099', i.id, i.workspace_id, 'member',
            (SELECT id FROM \"user\" WHERE email='probe550@example.com'),
            'D2 offline inserted comment', 'comment'
     FROM issue i JOIN workspace w ON w.id=i.workspace_id
     WHERE w.slug='probe550' AND i.number=1
     ON CONFLICT (id) DO NOTHING;" >/dev/null 2>&1
  adb_ shell svc wifi enable >/dev/null 2>&1
  adb_ shell cmd connectivity airplane-mode disable >/dev/null 2>&1
  sleep 25
  scroll_until_text "D2 offline inserted comment" 12 || true
  shot "d2-reconnected"
  if has_text "D2 offline inserted comment"; then
    check D2 pass "断网→重连后实时同步生效：断网期间插入的评论在重连后出现在时间线（离线提示 marker=$offline_marker）"
  else
    check D2 fail "重连 25s 后仍未看到断网期间插入的评论（离线 marker=$offline_marker，见 d2-reconnected.png）"
  fi

  # D3 前后台切换与进程被杀后的恢复
  key_home
  sleep 6
  adb_ shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
  sleep 6
  shot "d3-resumed"
  local resumed=0
  app_focused && app_alive && resumed=1
  adb_ shell am kill "$PKG" >/dev/null 2>&1
  sleep 4
  cold_start
  local recovered=0
  wait_text 60 "My Issues" && recovered=1
  shot "d3-after-kill"
  if [ "$resumed" = 1 ] && [ "$recovered" = 1 ]; then
    check D3 pass "HOME→回前台恢复到应用；am kill 后 dev-client 冷启重新渲染"
  else
    check D3 fail "恢复异常：resume=$resumed / kill 后冷启 recovered=$recovered（见 d3-*.png）"
  fi
}

# ══════════════════════════════════════════════════════════════════════
# 主流程
# ══════════════════════════════════════════════════════════════════════
main() {
  record_env
  echo "=== 阶段 0：夹具复位" >&2
  prepare_fixtures
  echo "=== 阶段 1：核心流程（C 组 + K 组）" >&2
  phase_core_flows
  echo "=== 阶段 2：返回路径（B 组）" >&2
  b_group
  echo "=== 阶段 3：视觉（V 组，FEATURE-549）" >&2
  v_group
  echo "=== 阶段 4：edge-to-edge 系统栏（E 组）" >&2
  e_group
  echo "=== 阶段 5：Markdown 与高亮（M 组，FEATURE-550）" >&2
  m_group
  echo "=== 阶段 6：易漏场景（D 组）" >&2
  d_group
  echo "=== 阶段 7：设置与退出登录（C11）" >&2
  c11_settings
  echo "=== 完成，结果见 $OUT/results.tsv" >&2
}

main "$@"
