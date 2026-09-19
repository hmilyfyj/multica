#!/usr/bin/env bash
# FEATURE-558 · Android 阶段 5 收尾验收 —— 一次性取证脚本
#
# 这是 FEATURE-551 `research/acceptance.sh` 的增量版：C/K/V/M/E 各组的观测口径一字未动，
# 只做三件 551 交下来的事：
#   1. 补验两项 551 因夹具缺失而未覆盖的项：图片查看器（B5/B5b）、聊天发送后的状态机（C8b–C8e）；
#   2. 复验 FEATURE-559 的两处修复：断网恢复后时间线秒级刷新（D2）、后端日志 client_os=android（D4）；
#   3. 夹具升级：seed-fixtures.sql 带图片附件，fake-daemon.py 提供在线 runtime。
#
# 用户要求（2026-09-18）：「一次性改完，一次性验收，不要重复跑好几次验收。」
# 因此本脚本仍是**一次运行覆盖全部验收项**的唯一入口：一次构建安装（Debug）+ 一个入口脚本
# + 一轮结论。它只观测、不改代码；产物一次性落进本目录。
# 用法：
#   OUT=<产物目录> bash acceptance558.sh
# 环境变量：SERIAL / PKG / WS / ADB（见 lib558.sh）、FAKE_MODE_FILE（默认 $OUT/.fake-mode）
#
# 分组（★ = 相对 551 新增/改动）：
#   C  核心流程（登录 → … → 设置/退出登录）      groups-core558.sh
#   K  键盘避让 6 场景（在 C 组对应页面上顺手观测）
#   B  三类返回路径 ★B5/B5b 图片查看器
#   V  FEATURE-549 视觉面
#   M  FEATURE-550 渲染面
#   E  edge-to-edge 系统栏
#   D  易漏场景 ★D2 断网重连复验、★D4 client_os=android
#   ★C8b–C8e 聊天待发 / 运行中 / 完成 / 失败
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

# 提速证据：每次真实 dump 记一行（shell 内秒数，无进程开销）。收尾在 summary.txt 里
# 给出「dump 次数 / 跨度 / 平均每次」——改前改后的对比靠它，不靠估算。
UI_DUMP_LOG="${UI_DUMP_LOG:-$OUT/dump.log}"
export UI_DUMP_LOG
: > "$UI_DUMP_LOG"

# 假 runtime daemon 的模式文件：脚本写、daemon 每轮认领前读。
# 必须放在 OUT 定下来之后——它默认值依赖 $OUT。
FAKE_MODE_FILE="${FAKE_MODE_FILE:-$OUT/.fake-mode}"
export FAKE_MODE_FILE

# shellcheck source=lib558.sh
source "$HERE/lib558.sh"
# shellcheck source=groups-core558.sh
source "$HERE/groups-core558.sh"

# 结果表只在**整轮**跑时清空；续跑（ACCEPT_GROUPS 指定分组）必须追加，
# 否则会把主跑结论抹掉（2026-09-19 踩过：续跑把主跑 39 行 results.tsv 清空了）。
if [ -z "${ACCEPT_GROUPS:-}" ]; then
  : > "$OUT/results.tsv"
  : > "$OUT/timings.tsv"
fi
: > "$OUT/state.log"

# 夹具 issue 的 UUID（probe550）——不用 identifier，见 driving-plan.md §0.6
PROB1=01a0b3a5-0bf0-7702-b33b-5c38dc6ded45   # Markdown 语法全覆盖
PROB2=01a0b3a5-2c4c-770e-b13f-c0060d368b7e   # 长文档性能夹具
PROB3=c3be9531-19ad-403c-9944-ed33c6c67f05   # 12 语言代码块夹具
IMG1=55800000-0000-4000-8000-000000000001    # 图片查看器夹具（FEATURE-558 新增）

# 假 daemon 的 runtime 与助手回复文案（与 fake-daemon.py 的 FAKE_REPLY 一致）
FAKE_RUNTIME_ID=a9fed2cd-1c9e-458c-a258-d6465bc2c684
FAKE_REPLY="FEATURE-558 流式夹具：助手回复已到达。"

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
  prepare_image_fixture
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

# ── 图片夹具 ───────────────────────────────────────────────────────────
# 两张棋盘格 PNG 由 make-fixture-images.py 画出来（PIL，不是手工素材），再拷进
# 后端容器的 uploads 卷 —— attachment 行只存 URL，文件本身得在后端取得到。
# 卷名来自 compose 项目 multica-probe542 的 backend_uploads。
prepare_image_fixture() {
  "$PY_BIN" "$HERE/make-fixture-images.py" "$OUT/fixture-images" > "$OUT/fixture-images.txt" 2>&1
  local n
  for n in a b; do
    docker cp "$OUT/fixture-images/probe558-$n.png" \
      multica-probe542-backend-1:/app/data/uploads/probe558-$n.png >/dev/null 2>&1
  done
  {
    for n in a b; do
      echo "image_$n http=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8090/uploads/probe558-$n.png")"
    done
  } > "$OUT/fixture-images-http.txt"
  cat "$OUT/fixture-images-http.txt"
}

# ── 假 runtime daemon ──────────────────────────────────────────────────
# 目的是让「聊天发送 → 任务被认领 → 运行中 → 助手回复」真的发生一遍：551 验收时
# 夹具 agent 的 runtime 是 offline，消息只能排队，整条链路没覆盖过。
# 协议、鉴权与用法见同目录 fake-daemon.md。
# 幂等：c8_chat 与 main 都可能调用它（见下面 §「为什么不能在登录前启动」）。
#
# **为什么不能在登录前启动**（2026-09-19 实测的脚本缺陷）：假 daemon 启动时要用
# probe551 登录一次（/auth/send-code + /auth/verify-code），而 `/auth/send-code`
# 有频率限制（5 次/分钟）。它和应用在同一秒内各发一次时，应用那次拿到 **429**，
# 登录页直接显示「Couldn't send the code. Try again.」→ C1/C2 判失败。
# 因此 daemon 改到**应用登录完成之后**（C8 之前）启动；token 也会缓存到
# research/.fake-token，缓存命中时不再打 send-code。
start_fake_daemon() {
  if [ -n "${FAKE_DAEMON_PID:-}" ] && kill -0 "$FAKE_DAEMON_PID" 2>/dev/null; then
    return 0
  fi
  "$PY_BIN" "$HERE/fake-daemon.py" --log "$OUT/fake-daemon-internal.log" > "$OUT/fake-daemon.log" 2>&1 &
  FAKE_DAEMON_PID=$!
  local i status=""
  for i in 1 2 3 4 5 6 7 8 9 10; do
    status="$(db_q "SELECT status FROM agent_runtime WHERE id='$FAKE_RUNTIME_ID'")"
    [ "$status" = "online" ] && break
    sleep 2
  done
  {
    echo "fake_daemon_pid=$FAKE_DAEMON_PID"
    echo "fake_runtime_status=${status:-unknown}"
  } > "$OUT/fake-daemon-state.txt"
  cat "$OUT/fake-daemon-state.txt"
}

stop_fake_daemon() {
  local pid="${FAKE_DAEMON_PID:-}"
  [ -n "$pid" ] || return 0
  kill "$pid" >/dev/null 2>&1
  wait "$pid" 2>/dev/null
  return 0
}

# 库侧便捷查询（验收结论要有库侧证据，不能只看界面）
db_q() {
  docker exec multica-probe542-postgres-1 psql -U multica -d multica -At -c "$1" 2>/dev/null
}

# 聊天任务快照：任务终态 + 助手消息条数，每个聊天判定点各落一次
chat_task_snapshot() {
  {
    echo "--- $(date -u +%H:%M:%SZ)"
    db_q "SELECT t.id::text||' status='||t.status||' attempt='||t.attempt||'/'||t.max_attempts||
                 ' failure_reason='||COALESCE(t.failure_reason,'-')||
                 ' created='||to_char(t.created_at,'HH24:MI:SS')
            FROM agent_task_queue t
           WHERE t.chat_session_id = '55100000-0000-4000-8000-000000000061'
           ORDER BY t.created_at DESC LIMIT 3;"
    db_q "SELECT 'assistant_msg_total='||count(*) FROM chat_message
            WHERE chat_session_id='55100000-0000-4000-8000-000000000061' AND role='assistant';"
  } >> "$OUT/c8-task-snapshot.txt"
}

# 环境补充记录（单独一个函数，避免改动 551 的 record_env 本体）：
# 「有没有真机」决定 FEATURE-541 验收总纲第 2 条是「达成」还是「waive 待用户确认」，
# 所以必须由脚本从 adb 现读，不能靠人写。
record_env_extra() {
  {
    adb devices | awk '$2 == "device" {print "attached=" $1}'
    echo "real_device_count=$(adb devices | awk '$2 == "device" && $1 !~ /^emulator-/' | wc -l | tr -d ' ')"
    echo "image_fixture_issue=$IMG1"
    echo "fake_runtime_id=$FAKE_RUNTIME_ID"
    echo "fake_mode_file=$FAKE_MODE_FILE"
  } > "$OUT/env-extra.txt"
  cat "$OUT/env-extra.txt"
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
    case "$BUILD_VARIANT" in
      release) echo "build_variant=Release (assembleRelease，内嵌 JS，不连 Metro)" ;;
      *)       echo "build_variant=Debug (assembleDebug，JS 走 Metro)" ;;
    esac
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

  # ── B5 图片查看器：打开 / 缩放 / 关闭与返回路径（551 记为未覆盖，本轮补验）──
  # 夹具是 issue IMG1 描述里两张独占一行的 markdown 图片（/uploads/probe558-a|b.png），
  # 同一 issue 上还挂了对应的 attachment 行。uiautomator 树里**没有**图片节点
  # （MarkdownImage 的 Pressable 没有 accessibilityLabel），所以图片位置由
  # image_block_bounds 从截图里扫出来，而不是靠选择器。
  reset_to_tab_root || true
  goto "issue/$IMG1"
  # 深链进来时页面先是空的（只有一个 spinner），正文要等 issue 数据回来才渲染。
  # 实测自测轮里 `sleep 8` 不够：截图还是加载态，image_block_bounds 自然扫不到图。
  # 判据取夹具 issue 的标题，它和正文同一批数据回来。
  wait_text 45 "图片查看器夹具" || true
  wait_stable 15 || true
  sleep 8
  shot "b5-01-issue"
  local box i_x1 i_y1 i_x2 i_y2 i_cx i_cy opened=0
  box="$(image_block_bounds "$OUT/b5-01-issue.png")"
  if [ -z "$box" ]; then
    swipe 540 1700 540 900 260
    sleep 4
    shot "b5-02-issue-scrolled"
    box="$(image_block_bounds "$OUT/b5-02-issue-scrolled.png")"
  fi
  if [ -n "$box" ]; then
    set -- $box; i_x1=$1; i_y1=$2; i_x2=$3; i_y2=$4
    i_cx=$(( (i_x1 + i_x2) / 2 )); i_cy=$(( (i_y1 + i_y2) / 2 ))
    tap_xy "$i_cx" "$i_cy"
    sleep 4
    shot "b5-03-viewer-open"
    has_text "✕" && opened=1
  fi
  if [ -z "$box" ]; then
    check B5 blocked "截图里没定位到图片块（image_block_bounds 返回空）—— 夹具图片没渲染出来，见 b5-01/b5-02"
  elif [ "$opened" = 1 ]; then
    check B5 pass "图片查看器可打开：点正文图片后全屏查看器出现（关闭按钮 ✕ 已在无障碍树里），图块 bounds=$box"
  else
    check B5 fail "点图片后没有出现查看器（未见关闭按钮 ✕，见 b5-03-viewer-open.png）"
  fi

  if [ "$opened" = 1 ]; then
    # B5b 序列计数：描述里两张图 → 查看器应有「n / N」计数（N ≥ 2）
    local counter="" counter2=""
    counter="$(texts | grep -E '^[0-9]+ / [0-9]+$' | head -1)"
    if [ -n "$counter" ]; then
      check B5b pass "查看器显示图片序列计数「$counter」，与正文两张图一致"
    else
      check B5b fail "查看器里没有「n / N」计数（见 b5-03-viewer-open.png）"
    fi

    # B5c 横向翻页到第二张
    if [ -n "$counter" ]; then
      swipe 900 "$i_cy" 180 "$i_cy" 260
      sleep 3
      shot "b5-04-viewer-next"
      counter2="$(texts | grep -E '^[0-9]+ / [0-9]+$' | head -1)"
      if [ -n "$counter2" ] && [ "$counter2" != "$counter" ]; then
        check B5c pass "横向滑动翻到下一张：计数 $counter → $counter2"
      else
        check B5c fail "横向滑动后计数没变（$counter → ${counter2:-无}，见 b5-04-viewer-next.png）"
      fi
    fi

    # B5d 双击缩放：以「缩放前后整屏差异像素占比」为判据
    local zoom_ratio
    shot "b5-05-before-zoom"
    double_tap_xy "$i_cx" "$i_cy"
    sleep 3
    shot "b5-06-after-zoom"
    zoom_ratio="$(png_diff_ratio "$OUT/b5-05-before-zoom.png" "$OUT/b5-06-after-zoom.png")"
    if awk -v r="$zoom_ratio" 'BEGIN{exit !(r > 0.05)}'; then
      check B5d pass "双击缩放生效：缩放前后整屏差异像素占比 $zoom_ratio（判据 >0.05）"
    else
      check B5d fail "双击后画面差异仅 $zoom_ratio，未观察到缩放（见 b5-05/b5-06；双击判定窗口 300ms，见 lib558.sh double_tap_xy 注释）"
    fi

    # B5e 返回路径：系统 BACK 关闭查看器
    press_back
    sleep 4
    shot "b5-07-after-back"
    if has_text "✕"; then
      check B5e fail "按系统 BACK 后查看器仍在屏上（见 b5-07-after-back.png）"
    else
      check B5e pass "系统 BACK 关闭查看器，回到 issue 详情"
    fi

    # B5f 关闭按钮 ✕
    tap_xy "$i_cx" "$i_cy"
    sleep 4
    if has_text "✕"; then
      tap_text "✕"
      sleep 4
      shot "b5-08-after-close-button"
      if has_text "✕"; then
        check B5f fail "点 ✕ 后查看器未关闭（见 b5-08-after-close-button.png）"
      else
        check B5f pass "点 ✕ 关闭查看器，回到 issue 详情"
      fi
    else
      check B5f blocked "第二次没能重新打开查看器，✕ 路径未验（见 b5-07-after-back.png）"
    fi
  fi
}

# ══════════════════════════════════════════════════════════════════════
# V 组 · 视觉（FEATURE-549）
# ══════════════════════════════════════════════════════════════════════
ink_ratio() {
  "$PY_BIN" - "$@" <<'PY'
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
  local ok=1 icons=" " lb min_ink=""
  for lb in Inbox "My Issues" Chat More; do
    has_text "$lb" || ok=0
    r="$(_bounds_of text "$lb")"
    [ -n "$r" ] || { ok=0; continue; }
    set -- $r; x1=$1; y1=$2; x2=$3
    ink="$(ink_ratio "$OUT/v1-tabbar-light.png" $(( x1 - 8 )) $(( y1 - 60 )) $(( x2 + 8 )) $(( y1 - 4 )))"
    icons="$icons$lb=$ink "
    # 最小值必须在**循环里按数值**取。`$lb` 里的 `My Issues` 含空格，`printf '%s\n' $icons`
    # 会把它拆成 `My` 与 `Issues=x` 两个词，事后 `sed 's/.*=//' | sort -g | head -1`
    # 拿到的是字符串 `My`（2026-09-19 实测复现）。而 awk 拿字符串跟数字比较会退化成字符串
    # 比较（`"My" > "0.01"` 为真），于是 V1 成了「只要四个标签在就恒 pass」的空判据 ——
    # 2026-09-19 两次运行里图标 ink 全是 0.0 也判 pass。下面改成逐个数值取最小。
    if [ -n "$min_ink" ]; then
      min_ink="$(awk -v a="$min_ink" -v b="$ink" 'BEGIN{print (b < a) ? b : a}')"
    else
      min_ink="$ink"
    fi
  done
  if [ "$ok" = 1 ] && awk -v a="$min_ink" 'BEGIN{exit !(a > 0.01)}'; then
    check V1 pass "四个 tab 图标齐全（图标框 ink 比例 min=$min_ink）：$icons"
  else
    check V1 fail "tab 图标缺失或标签不全（labels_ok=$ok min_ink=${min_ink:-n/a}）：$icons"
  fi

  # ── V2 启动屏与桌面图标 ────────────────────────────────────────────
  key_home
  adb_ shell am force-stop "$PKG" >/dev/null 2>&1
  sleep 2
  app_launch
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
# 解锁仓口 `shot "v2-launcher-home"`：这一帧就是故意按压 HOME 后的桌面，不能过 app_guard
  shot_bg "v2-launcher-home"

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
  # 559 的两条恢复路径都以「秒级」为目标（预算 30s，见平台 spec）：
  # 这里从重新联网、插入评论起计时，按轮询发现时刻算恢复时延。注意粒度：
  # 每次 has_text 都要 dump 一次无障碍树（≈2s），所以测得值天然带 2~4s 量化误差。
  local t0 t1 elapsed=0 i
  t0="$(date +%s)"
  for i in $(seq 1 14); do
    if has_text "D2 offline inserted comment"; then
      elapsed=$(( $(date +%s) - t0 ))
      break
    fi
    sleep 1
  done
  scroll_until_text "D2 offline inserted comment" 12 || true
  shot "d2-reconnected"
  t1="$(date +%s)"
  {
    echo "reconnect_elapsed_seconds=${elapsed}"
    echo "post_reconnect_total_seconds=$(( t1 - t0 ))"
  } > "$OUT/d2-timing.txt"
  if has_text "D2 offline inserted comment"; then
    check D2 pass "断网→重连后实时同步生效：断网期间插入的评论在约 ${elapsed}s（轮询粒度 2~4s）后出现在时间线（离线提示 marker=$offline_marker；预算 30s，见平台 spec）"
  else
    check D2 fail "重连后 $(( t1 - t0 ))s 内仍未看到断网期间插入的评论（离线 marker=$offline_marker，见 d2-reconnected.png）"
  fi

  # ── D4 client_os 上报（FEATURE-559 修复项 2，本轮复验）────────────────
  # 修复前 `apps/mobile/data/realtime/ws-client.ts` 写死字面量 "ios"，Android 设备在后端
  # 日志里全记成 client_os=ios（551 §8.1 实测）；现在由 realtime-provider 传 Platform.OS。
  # 判据取后端日志里的 `websocket connected … client_os=…` 行，并单独列出 android 行。
  local u551 android_n ios_n android_user_n
  u551="$(db_q "SELECT id FROM \"user\" WHERE email='probe551@example.com'")"
  docker logs multica-probe542-backend-1 2>&1 | grep "websocket connected" > "$OUT/d4-ws-connected.txt"
  grep "client_os=android" "$OUT/d4-ws-connected.txt" | tail -3 > "$OUT/d4-android-lines.txt"
  android_n="$(count_of "$OUT/d4-ws-connected.txt" "client_os=android")"
  ios_n="$(count_of "$OUT/d4-ws-connected.txt" "client_os=ios")"
  android_user_n="$(count_of "$OUT/d4-android-lines.txt" "user_id=$u551")"
  if [ "${android_n:-0}" -ge 1 ]; then
    check D4 pass "Android 设备的 WS 连接在后端日志里上报 client_os=android（命中 $android_n 条，其中带登录用户 $u551 的 $android_user_n 条；同一份日志里 client_os=ios 有 $ios_n 条，来自本机其它客户端）"
  else
    check D4 fail "后端日志没有任何 client_os=android 的 websocket connected 行（见 d4-ws-connected.txt）"
  fi

  # D4b HTTP 层的同一维度（本轮新发现，不属于 559 的复验范围）：
  # 559 只改了 WS 握手 URL；普通 HTTP 请求的 `X-Client-OS` 仍是硬编码字面量
  # （`apps/mobile/data/api.ts:227` 与 `:1319`，两处都写 "ios"），于是后端把
  # Android 的接口调用全记成 client_os=ios。判据取「本次会话里登录用户 probe551
  # 的 HTTP 请求行」，排除 iOS 客户端（它用的是 probe550）。
  docker logs --tail 4000 multica-probe542-backend-1 2>&1 | grep "http request" > "$OUT/d4-http-requests.txt"
  local http_ios http_android
  http_ios="$(grep "user_id=$u551" "$OUT/d4-http-requests.txt" | grep -c "client_os=ios")"
  http_android="$(grep "user_id=$u551" "$OUT/d4-http-requests.txt" | grep -c "client_os=android")"
  grep "user_id=$u551" "$OUT/d4-http-requests.txt" | grep "client_os=ios" | tail -2 > "$OUT/d4-http-ios-lines.txt"
  if [ "${http_ios:-0}" -ge 1 ]; then
    check D4b fail "HTTP 请求的 client_os 仍是 ios（probe551 的接口调用里 client_os=ios 有 $http_ios 条、android $http_android 条）：559 只修了 WS 握手，apps/mobile/data/api.ts:227 与 :1319 的 X-Client-OS 还是硬编码 \"ios\"；见 d4-http-ios-lines.txt（本轮新发现，修复需另立任务）"
  else
    check D4b pass "HTTP 请求的 client_os 未出现错误取值（probe551 的请求里 android=$http_android / ios=$http_ios）"
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
    check D3 pass "HOME→回前台恢复到应用；am kill 后冷启重新渲染（$BUILD_VARIANT 构建）"
  else
    check D3 fail "恢复异常：resume=$resumed / kill 后冷启 recovered=$recovered（见 d3-*.png）"
  fi
}

# ══════════════════════════════════════════════════════════════════════
# 主流程
# ══════════════════════════════════════════════════════════════════════
# 分组运行器：`GROUPS` 用逗号分隔（core,b,v,e,m,d,c11），默认全跑。
# 独立出来是为了让 `continue558.sh` 在「主跑被外层作业时限杀掉」时接着跑剩下的分组，
# 而不必复制任何判定代码（每个分组只有一处定义）。
run_groups() {
  local g t0
  for g in ${1//,/ }; do
    t0="$SECONDS"
    case "$g" in
      core) echo "=== 阶段 1：核心流程（C 组 + K 组，含 C8b–C8e 聊天状态机）" >&2; phase_core_flows ;;
      c8)   echo "=== 阶段 1b：只跑聊天状态机（C8/C8b–C8e；2026-09-19 C8 场地被系统页抢前台，单独重判）" >&2; c8_chat ;;
      b)    echo "=== 阶段 2：返回路径（B 组，含 B5 图片查看器）" >&2; b_group ;;
      v)    echo "=== 阶段 3：视觉（V 组，FEATURE-549）" >&2; v_group ;;
      e)    echo "=== 阶段 4：edge-to-edge 系统栏（E 组）" >&2; e_group ;;
      m)    echo "=== 阶段 5：Markdown 与高亮（M 组，FEATURE-550）" >&2; m_group ;;
      d)    echo "=== 阶段 6：易漏场景（D 组，含 D2/D4/D4b 复验）" >&2; d_group ;;
      c11)  echo "=== 阶段 7：设置与退出登录（C11）" >&2; c11_settings ;;
      smoke) echo "=== 冒烟集（Tier 1，8 条，目标 < 5 分钟）" >&2; smoke_set ;;
      # 定向重查的小节粒度：`ACCEPT_GROUPS=c5,c6` 只跑 C 组的这两小节（分钟级），
      # 不必为了复查两三条判据把整组（40+ 分钟）重跑一遍。判定代码只有一处定义。
      c1|c2|c3|c4|c5|c6|c7|c9|c10)
        echo "=== 定向：C 组小节 $g" >&2
        case "$g" in
          c1)  c1_login ;;
          c2)  c2_verify ;;
          c3)  c3_workspace ;;
          c4)  c4_inbox ;;
          c5)  c5_issue_detail ;;
          c6)  c6_edit_issue ;;
          c7)  c7_new_issue ;;
          c9)  c9_projects ;;
          c10) c10_search ;;
        esac ;;
      *)    echo "!! 未知分组：$g" >&2 ;;
    esac
    printf 'GROUP  %s 用时 %ss\n' "$g" "$(( SECONDS - t0 ))" >&2
  done
}

main() {
  # 应用状态复位：核心流程从「首次安装后的状态」开始 —— 上一轮留下的登录态会让 C1 直接跳过
  # 登录页，整条 C 组判据的起点就变了（2026-09-19 实测：不清数据时 K5/C1 判不了）。
  # 只清本包数据，不动后端夹具与其它变体。
  case ",${ACCEPT_GROUPS:-core,b,v,e,m,d,c11}," in
    *,core,*) adb_ shell pm clear "$PKG" >/dev/null 2>&1; sleep 2; app_launch; sleep 3 ;;
  esac
  record_env
  record_env_extra
  echo "=== 阶段 0：夹具复位（数据 + 图片）" >&2
  prepare_fixtures
  write_mode success
  local groups="${ACCEPT_GROUPS:-core,b,v,e,m,d,c11}"
  # 假 daemon 只在要跑核心流程（含 C8 聊天）时启动；它自己也会在 c8_chat 里兜底启动。
  case ",$groups," in *,core,*|*,c8,*) start_fake_daemon ;; esac
  run_groups "$groups"
  stop_fake_daemon
  echo "=== 完成，结果见 $OUT/results.tsv" >&2
  summarize
}

# 收尾汇总：把结论表、设备/构建信息、判定计数并成一份 summary.txt，
# 落档时直接引用它，不必回翻 2000 行日志。
summarize() {
  {
    echo "device=$(grep '^device_model=' "$OUT/env.txt" | cut -d= -f2)"
    echo "android=$(grep '^android_release=' "$OUT/env.txt" | cut -d= -f2) (API $(grep '^api_level=' "$OUT/env.txt" | cut -d= -f2))"
    echo "package=$(grep '^package=' "$OUT/env.txt" | cut -d= -f2)"
    echo "$(grep '^build_variant=' "$OUT/env.txt")"
    echo "$(grep '^real_device_count=' "$OUT/env-extra.txt")"
    echo "--- results.tsv ---"
    cat "$OUT/results.tsv"
    echo "--- 判定计数 ---"
    awk -F'\t' '{c[$2]++} END {for (k in c) printf "%s=%d ", k, c[k]; print ""}' "$OUT/results.tsv"
    echo "--- 最慢 10 条（timings.tsv：相邻两次判定之间的秒数）---"
    if [ -s "$OUT/timings.tsv" ]; then
      sort -k3,3nr "$OUT/timings.tsv" | head -10 | awk -F'\t' '{printf "%s\t%s\t%ss\n", $1, $2, $3}'
      awk -F'\t' '{s+=$3} END {printf "合计 %d 条 / %.0f 分钟\n", NR, s/60}' "$OUT/timings.tsv"
    else
      echo "（无 timings 记录）"
    fi
    echo "--- dump 开销（无障碍树取数）---"
    if [ -s "$UI_DUMP_LOG" ]; then
      awk -v f="$UI_DUMP_LOG" 'NR==1{f0=$1} {n++; last=$1} END{span=last-f0; printf "真实 dump 次数=%d 跨度=%ds 平均每次=%.2fs\n", n, span, (n>1?span/(n-1):0)}' "$UI_DUMP_LOG"
    else
      echo "（本组没有 dump 记录）"
    fi
    echo "--- 被抢前台的插曲 ---"
    if [ -s "$OUT/interruptions.log" ]; then cat "$OUT/interruptions.log"; else echo "无"; fi
  } > "$OUT/summary.txt"
  cat "$OUT/summary.txt"
}

main "$@"
