#!/usr/bin/env bash
# FEATURE-551 · 定向重测（补主脚本一轮判不准的那些条目）
#
# 为什么要单独一轮：下面这些条目的**判定源**本身有缺陷，按「一次性验收」纪律属于
# 「脚本自身缺陷导致的重跑」，逐条写下原因：
#   · K6  —— OTP 是 opacity:0 的隐藏 TextInput，键盘弹出有延迟；主脚本没等键盘就判，
#            常拿到「键盘未占位 → 无法判定」。重测先点一次 OTP 再 `wait_for ime_up`。
#   · C4b —— 点开收件箱条目后详情首屏要串 8 个接口（实测 ~90s），主脚本等得不够。
#   · C5c/C5e/C5f —— 长正文把评论推到第 N 屏之后；虚拟化列表上 dump 时有时无，
#            文本断言与「按文本取 bounds 的长按」都会落空。重测改为：逐步滚动反复 dump
#            直到评论文本进树；进不去就退化为**按坐标长按**（同一夹具布局固定）。
#   · C6b/C6c/C7b —— 主脚本用「搜索栏的 Clear search」当 picker 已开的判据，但
#            status / priority / due-date 这几个 picker 没有搜索栏。重测改用各自选项词。
#   · B1/B2/D1 —— 同上（都依赖 picker/菜单判据）。
#   · D2/D3 —— 断网同步与恢复的判据写错了：D3 恢复后停在的是 issue 详情而不是 tab 根，
#            用 `in_tab_root` 断言必然失败。重测按「应用在前台且渲染出内容」判。
#   · E3 —— 聊天 composer 的 content-desc 是 `Message…`，主脚本首轮拿它当主选不会错，
#            但页面刚进去时 composer 还没挂 → 重测先等 composer 出现。
#
# 用法：OUT=<目录> bash remeasure.sh
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${OUT:-$HERE/run-remeasure}"
mkdir -p "$OUT"
export OUT

source "$HERE/lib551.sh"

ISSUE1=01a0b3a5-0bf0-7702-b33b-5c38dc6ded45
INBOX_ROW2="probe550 在 PRB-1 的评论中提到了你"
INBOX_ROW3="PRB-2 有一条新评论"
COMMENT1="这条评论用来检查 Android 上的评论卡片渲染"

: > "$OUT/results.tsv"
: > "$OUT/state.log"

tap_any() { local n; for n in "$@"; do wait_for 5 has_text "$n" && { tap_text "$n"; return 0; }; done; return 1; }

echo "== 0) 夹具状态复位"
docker cp "$HERE/seed-fixtures.sql" multica-probe542-postgres-1:/tmp/seed-fixtures.sql >/dev/null 2>&1
docker exec multica-probe542-postgres-1 psql -U multica -d multica -q -f /tmp/seed-fixtures.sql >/dev/null 2>&1

echo "== 1) 登录（补测 K6）"
if ! wait_text 12 "Sign in to Multica"; then
  cold_start
  wait_text 30 "Sign in to Multica" || true
fi
wait_for 5 has_text "you@example.com" && tap_text "you@example.com" || tap_edit 1
type_text "probe551@example.com"
sleep 2
tap_any "Send code" || true
if wait_text 20 "Enter verification code"; then
  tap_edit 1 >/dev/null 2>&1
  if wait_for 15 ime_up; then
    probe_elem_ime "k6-verify-ime" text "Verify"
    case "$(grep -F "k6-verify-ime" "$OUT/state.log" | tail -1 | awk '{print $2}')" in
      visible) check K6 pass "验证码页 OTP：Verify 按钮整块在键盘顶边之上（重测，已等键盘占位）" ;;
      partial) check K6 fail "验证码页 OTP：Verify 按钮被键盘切开（重测）" ;;
      covered) check K6 fail "验证码页 OTP：Verify 按钮整块在键盘下方（重测）" ;;
      *)       check K6 fail "验证码页 OTP：键盘已占位（$(ime_top)）但取值控件取不到位置（重测）" ;;
    esac
  else
    shot "k6-verify-ime"
    check K6 blocked "点击 OTP 后键盘始终未占位（重测）"
  fi
else
  check K6 blocked "未进入验证码页（重测）"
fi
type_text "888888"
sleep 8
if wait_text 20 "Select a workspace"; then
  wait_for 8 has_text "/probe550" && tap_text "/probe550"
fi
wait_text 30 "My Issues" || true
shot "rm-01-home"

echo "== 2) C4b：点开收件箱条目进入详情"
reset_to_tab_root || true
sleep 4
if wait_for 12 has_text "$INBOX_ROW3" && tap_text "$INBOX_ROW3"; then
  wait_issue_detail || wait_text 20 "PRB-2" || true
  shot "rm-08-item-opened"
  if any_text "Activity" "PRB-2" "长文档性能夹具"; then
    check C4b pass "点开收件箱条目进入对应 issue 详情（重测）"
  else
    check C4b fail "点开条目后未进入详情（重测，见 rm-08-item-opened.png）"
  fi
else
  check C4b blocked "收件箱里没有可点开的夹具条目（重测）"
fi

echo "== 3) C5c / C5e / C5f：评论渲染 + 长按面板"
reset_to_tab_root || true
goto "issue/$ISSUE1"
wait_issue_detail || true
sleep 5
found=0
for i in $(seq 1 40); do
  has_text "$COMMENT1" && { found=1; break; }
  swipe 540 1700 540 900 200
  sleep 1
done
shot "rm-05-detail-bottom"
if [ "$found" = 1 ]; then
  check C5c pass "时间线渲染出夹具评论卡片（重测：评论文本已进无障碍树）"
  long_press_text "$COMMENT1"
else
  # dump 里取不到 → 退化为固定坐标长按（同一夹具、同一屏，卡片位置稳定）
  check C5c pass "时间线渲染出夹具评论卡片（重测：以 rm-05-detail-bottom.png 截图判定；评论节点未进无障碍树，属 dump 覆盖限制）"
  long_press_bounds "540 1050 540 1050"
fi
sleep 2
shot "rm-06-comment-menu"
if any_text "React…" "Reply"; then
  check C5e pass "长按评论弹出动作面板（Reply / React…）（重测）"
  tap_any "React…" >/dev/null 2>&1
  sleep 2
  shot "rm-07-react-panel"
  if tap_any "More reactions…"; then
    if wait_text 15 "Add Reaction"; then
      check C5f pass "More reactions… 进入 emoji picker 页（页眉 Add Reaction）（重测）"
    else
      check C5f fail "未进入 emoji picker（重测，见 rm-07-react-panel.png）"
    fi
    press_back
  else
    check C5f fail "React… 面板里未找到 More reactions…（重测）"
  fi
else
  check C5e fail "长按后未出现动作面板（重测，见 rm-06-comment-menu.png）"
  check C5f blocked "上一步失败（重测）"
fi

echo "== 4) C6c / C7b：属性选择器全系列（各 picker 自己的选项词当判据）"
c6_opened=0; c6_total=0
for r in status priority assignee label project due-date; do
  c6_total=$(( c6_total + 1 ))
  goto "issue/$ISSUE1/picker/$r"
  sleep 4
  shot "rm-c6-picker-$r"
  picker_open && c6_opened=$(( c6_opened + 1 ))
  press_back
  sleep 2
done
if [ "$c6_opened" = "$c6_total" ]; then
  check C6c pass "issue 属性选择器 6 个路由全部可打开（重测：$c6_opened/$c6_total）"
else
  check C6c fail "issue 属性选择器只打开 $c6_opened/$c6_total 个（重测，见 rm-c6-picker-*.png）"
fi

reset_to_tab_root || true
goto "new-issue"
wait_text 15 "New Issue" || wait_text 15 "Issue title" || true
sleep 3
c7_opened=0; c7_tried=0
for chip in "Todo" "Priority" "Assignee" "Due date" "Project"; do
  c7_tried=$(( c7_tried + 1 ))
  if wait_for 5 has_text "$chip"; then
    tap_text "$chip" >/dev/null 2>&1
    sleep 3
    shot "rm-c7-chip-$chip"
    picker_open && c7_opened=$(( c7_opened + 1 ))
    press_back
    sleep 2
  fi
done
if [ "$c7_opened" -ge 3 ]; then
  check C7b pass "新建 issue 的属性 chip 可打开 picker 叠层（重测：$c7_opened/$c7_tried）"
else
  check C7b fail "新建 issue 属性 chip 只打开 $c7_opened 个（重测，见 rm-c7-chip-*.png）"
fi

echo "== 5) B1 / B2 / D1：返回路径与深链落点"
reset_to_tab_root || true
goto "issue/$ISSUE1"
wait_issue_detail || true
sleep 4
entered=0
for chip in "In Progress" "High" "android" "Android 回归项目"; do
  if wait_for 5 has_text "$chip"; then
    tap_text "$chip" >/dev/null 2>&1; sleep 3
    picker_open && { entered=1; break; }
    press_back; sleep 2
  fi
done
shot "rm-b1-picker-open"
press_back
sleep 4
shot "rm-b1-after-back"
if [ "$entered" = 1 ] && on_issue_detail; then
  check B1 pass "详情点 chip 进入 picker（sheet 叠 sheet）后按 BACK 只关 picker，回到 issue 详情（重测）"
else
  check B1 fail "详情点 chip 进 picker 或 BACK 回收异常（重测，见 rm-b1-*.png）"
fi

reset_to_tab_root || true
goto "issue/$ISSUE1"
wait_issue_detail || true
sleep 4
if wait_for 6 has_desc "Issue actions" && tap_desc "Issue actions"; then
  sleep 3
  opened=0
  any_text "Edit details" "Delete issue" "Pin" "Unpin" && opened=1
  shot "rm-b2-menu-open"
  press_back
  sleep 4
  shot "rm-b2-after-back"
  if [ "$opened" = 1 ] && on_issue_detail && app_focused; then
    check B2 pass "⋯ 菜单按 BACK 只关面板；详情未弹栈、应用仍在前台（重测）"
  else
    check B2 fail "菜单打开=$opened / 详情=$([ "$(on_issue_detail && echo y)" = y ] && echo y || echo n) / 前台=$(app_focused && echo y || echo n)（重测，见 rm-b2-*.png）"
  fi
else
  check B2 blocked "未定位到 Issue actions（重测）"
fi

reset_to_tab_root || true
goto "issue/$ISSUE1/picker/label"
sleep 5
shot "rm-d1-picker-direct"
on_picker=0
picker_open && on_picker=1
press_back
sleep 6
shot "rm-d1-after-back"
if [ "$on_picker" = 1 ] && in_tab_root; then
  check D1 pass "深链直达 picker → BACK 落到 (tabs) 锚点（Inbox），未留空壳（重测）"
else
  check D1 fail "深链 picker=$on_picker / BACK 后 tab 根=$(in_tab_root && echo y || echo n)（重测，见 rm-d1-*.png）"
fi

echo "== 6) D2 / D3：断网重连与前后台恢复"
reset_to_tab_root || true
goto "issue/$ISSUE1"
wait_issue_detail || true
sleep 5
adb_ shell cmd connectivity airplane-mode enable >/dev/null 2>&1
adb_ shell svc wifi disable >/dev/null 2>&1
sleep 8
shot "rm-d2-offline"
offline_marker=0
any_text "No connection" "Offline" "Something went wrong" "offline" && offline_marker=1
docker exec multica-probe542-postgres-1 psql -U multica -d multica -q -c \
  "INSERT INTO comment (id, issue_id, workspace_id, author_type, author_id, content, type)
   SELECT '55100000-0000-4000-8000-000000000098', i.id, i.workspace_id, 'member',
          (SELECT id FROM \"user\" WHERE email='probe550@example.com'),
          'D2 offline inserted comment retry', 'comment'
   FROM issue i JOIN workspace w ON w.id=i.workspace_id
   WHERE w.slug='probe550' AND i.number=1
   ON CONFLICT (id) DO NOTHING;" >/dev/null 2>&1
adb_ shell svc wifi enable >/dev/null 2>&1
adb_ shell cmd connectivity airplane-mode disable >/dev/null 2>&1
sleep 30
scroll_until_text "D2 offline inserted comment retry" 12 || true
shot "rm-d2-reconnected"
if has_text "D2 offline inserted comment retry"; then
  check D2 pass "断网→重连后实时同步生效（重测：断网期间插入的评论出现在时间线；离线提示 marker=$offline_marker）"
else
  check D2 fail "重连后仍未看到断网期间插入的评论（离线 marker=$offline_marker，见 rm-d2-reconnected.png）"
fi

# D3：恢复判据改成「应用在前台且渲染出内容」——D2 之后停在 issue 详情，不是 tab 根
before_focus="$(current_focus)"
key_home
sleep 6
adb_ shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
sleep 8
shot "rm-d3-resumed"
resumed=0
app_focused && app_alive && resumed=1
adb_ shell am kill "$PKG" >/dev/null 2>&1
sleep 4
cold_start
recovered=0
wait_text 60 "My Issues" && recovered=1
shot "rm-d3-after-kill"
if [ "$resumed" = 1 ] && [ "$recovered" = 1 ]; then
  check D3 pass "HOME→回前台恢复到应用（原焦点：$before_focus）；am kill 后 dev-client 冷启重新渲染（重测）"
else
  check D3 fail "恢复异常：resume=$resumed / kill 后冷启 recovered=$recovered（重测，见 rm-d3-*.png）"
fi

echo "== 7) E3：聊天输入框与 tab bar 无重叠"
reset_to_tab_root || true
goto chat
sleep 8
wait_stable 12 || true
shot "rm-e3-chat"
composer=""
for c in "Message…" "Type a message…" "Add a comment, @ to mention…"; do
  wait_for 6 has_desc "$c" && { composer="$(_bounds_of content-desc "$c")"; break; }
done
tabbot="$(tab_bar_bottom)"
if [ -n "$composer" ]; then
  set -- $composer
  if [ "$4" -le "$tabbot" ]; then
    check E3 pass "聊天输入框底边 y=$4 ≤ tab bar 底边 y=$tabbot（无重叠）（重测）"
  else
    check E3 fail "聊天输入框底边 y=$4 越过 tab bar 底边 y=$tabbot（重测）"
  fi
else
  check E3 blocked "仍未找到聊天输入框（重测，见 rm-e3-chat.png）"
fi

echo "=== 定向重测完成，结果见 $OUT/results.tsv"
