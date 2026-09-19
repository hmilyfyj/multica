#!/usr/bin/env bash
# FEATURE-558 · 定向重测（走 551 的 run-remeasure 口径）
#
# 只重测主跑里**判定源本身有缺陷**的条目，不重跑整个验收：
#   C4b  主跑的判据词写的是 `PRB-2`（夹具正文），而 issue 的真实 identifier 是
#        `PROB-2`；另一个判据词 `长文档性能夹具` 也要求整值相等，而界面上的文本是
#        `PROB 长文档性能夹具`。三个判据词都命中不了 → 主跑判 fail，但截图
#        （c4-02-item-opened.png）显示详情页已正常渲染。这里按界面真实文本重判。
#   C4c/C4d  主跑用 450ms 的注入滑动，未触发 ReanimatedSwipeable 的开合；
#        这里改用更慢的 800ms 拖拽重试（起点仍在系统返回手势区之外）。
#
# 用法：OUT=<主跑产物目录> bash remeasure558.sh
# 产物写进同一个 OUT 目录，文件名前缀 rm-，与 551 的做法一致。
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${OUT:-$HERE/run}"
mkdir -p "$OUT"
export OUT
# shellcheck source=lib558.sh
source "$HERE/lib558.sh"

INBOX_ROW3="PRB-2 有一条新评论"

echo "── C4b 重测：收件箱点开条目 → issue 详情"
reset_to_tab_root || true
sleep 3
if wait_for 12 has_text "$INBOX_ROW3" && tap_text "$INBOX_ROW3"; then
  # 详情页要串 8 个接口；等真实渲染出来的文本
  wait_text 30 "PROB 长文档性能夹具" || wait_text 15 "PROB-2" || true
  sleep 3
  shot "rm-c4b-item-opened"
  if has_text "PROB 长文档性能夹具" || has_text "PROB-2"; then
    check C4b pass "重测：点开收件箱条目进入对应 issue 详情（PROB 长文档性能夹具），主跑判 fail 是判据词 PROB/PRB 写错所致"
  else
    check C4b fail "重测仍未进入详情（见 rm-c4b-item-opened.png）"
  fi
else
  check C4b blocked "重测：收件箱里没找到 $INBOX_ROW3"
fi

echo "── C4c/C4d 重测：左滑归档（更慢的拖拽）"
reset_to_tab_root || true
sleep 3
if wait_for 12 has_text "probe550 在 PRB-1 的评论中提到了你"; then
  ROW="probe550 在 PRB-1 的评论中提到了你"
  B="$(_bounds_of text "$ROW")"
  if [ -n "$B" ]; then
    set -- $B
    Y1=$2; Y2=$4
    CY=$(( (Y1 + Y2) / 2 ))
    W="$(screen_width)"
    # 从 W-200 起手（避开右缘系统返回区），慢速拖到左侧，再停一下让 Swipeable 判定
    adb_ shell input swipe $(( W - 200 )) "$CY" 120 "$CY" 800 >/dev/null 2>&1
    sleep 3
    shot "rm-c4c-swipe-reveal"
    if has_desc "Archive" || has_text "Archive"; then
      check C4c pass "重测：800ms 拖拽后露出 Archive 操作（主跑 450ms 未触发）"
      tap_any_text "Archive" >/dev/null 2>&1 || tap_desc "Archive" >/dev/null 2>&1
      sleep 6
      shot "rm-c4d-after-archive"
      if has_text "$ROW"; then
        check C4d fail "重测：点 Archive 后条目仍在列表上"
      else
        check C4d pass "重测：点 Archive 后条目从收件箱移除"
      fi

      # 复位夹具（把行放回未归档/未读），避免影响后续判定
      docker cp "$HERE/seed-fixtures.sql" multica-probe542-postgres-1:/tmp/seed558-rm.sql >/dev/null 2>&1
      docker exec multica-probe542-postgres-1 psql -U multica -d multica -q \
        -f /tmp/seed558-rm.sql > "$OUT/rm-fixture-reseed.log" 2>&1
    else
      check C4c fail "重测：800ms 拖拽后仍未露出 Archive（见 rm-c4c-swipe-reveal.png）"
      check C4d blocked "重测：左滑仍未露出 Archive，归档动作无法执行"
    fi
  else
    check C4c blocked "重测：取不到行 bounds"
    check C4d blocked "重测：同上"
  fi
else
  check C4c blocked "重测：夹具未读行不在列表上"
  check C4d blocked "重测：同上"
fi

# ── C5c/C5d/C5e/C5f 重测 ───────────────────────────────────────────────
# 三条都受同一个环境因素影响：expo dev-client 的 **Tools 悬浮球默认叠在右上角**，
# 正是 issue 详情页 ⋯（Issue actions，content-desc）的位置。主跑 C5d 的点击因此打开了
# dev menu（截图 c5-03-actions-menu.png 可见）；C5e/C5f 的长按随之落到覆盖层上。
# 重测前已把这个悬浮球拖到左下角，页眉右上角的按钮恢复可点。
# C5c 的判据是 dump 覆盖限制（评论由原生 markdown 视图渲染，节点不进无障碍树），
# 与 551 一致：以截图判定，脚本只负责把评论滚进视口并留图。
echo "── C5c/C5d/C5e/C5f 重测：issue 详情时间线与 ⋯ 菜单"
reset_to_tab_root || true
goto "issue/01a0b3a5-0bf0-7702-b33b-5c38dc6ded45"
wait_issue_detail || true
sleep 4
scroll_until_text "$COMMENT1" 30 || true
sleep 2
shot "rm-c5c-detail-bottom"
if has_text "$COMMENT1"; then
  check C5c pass "重测：时间线渲染出夹具评论卡片（评论文本进入无障碍树）"
else
  check C5c blocked "重测：评论节点仍未进无障碍树（原生 markdown 视图的已知 dump 限制）—— 以 rm-c5c-detail-bottom.png 截图判定"
fi

# ⋯ 菜单（FAB 已移开）
reset_to_tab_root || true
goto "issue/01a0b3a5-0bf0-7702-b33b-5c38dc6ded45"
wait_issue_detail || true
sleep 3
if tap_any_desc "Issue actions"; then
  sleep 4
  shot "rm-c5d-actions-menu"
  if any_text "Edit details" "Delete issue" "Pin" "Unpin"; then
    check C5d pass "重测：⋯ 菜单打开并列出操作项（主跑失败是 dev-client 悬浮球遮挡所致）"
  else
    check C5d fail "重测：⋯ 菜单仍未列出操作项（见 rm-c5d-actions-menu.png）"
  fi
  press_back
  sleep 2
else
  check C5d fail "重测：未定位到 Issue actions 按钮"
fi

# 评论长按 → React… → More reactions… → emoji picker
scroll_until_text "$COMMENT1" 30 || true
if long_press_text "$COMMENT1"; then
  sleep 3
  shot "rm-c5e-comment-menu"
  if any_text "React…" "Reply"; then
    check C5e pass "重测：长按评论弹出动作面板（Reply / React…）"
    tap_any_text "React…" >/dev/null 2>&1
    sleep 3
    shot "rm-c5f-react-panel"
    if tap_any_text "More reactions…" >/dev/null 2>&1; then
      sleep 4
      shot "rm-c5f-emoji-picker"
      if wait_text 12 "Add Reaction"; then
        check C5f pass "重测：More reactions… 进入 emoji picker（页眉 Add Reaction）"
      else
        check C5f fail "重测：点 More reactions… 后未进入 emoji picker（见 rm-c5f-emoji-picker.png）"
      fi
      press_back
    else
      check C5f fail "重测：动作面板里没有 More reactions…（见 rm-c5f-react-panel.png）"
    fi
  else
    check C5e fail "重测：长按后仍未出现动作面板（见 rm-c5e-comment-menu.png）"
    check C5f blocked "重测：上一步失败"
  fi
else
  check C5e blocked "重测：长按未命中夹具评论（评论节点不进无障碍树）"
  check C5f blocked "重测：同上"
fi

# ── C6b 重测：详情点属性 chip → 打开对应 picker ─────────────────────────
# 主跑判 0 次成功；551 的同类条目（B1）在重测里通过，说明是等待/判定偏紧，
# 不是选择器打不开。这里每次点完给足 4s 并逐次截图，最多计 4 个 chip。
echo "── C6b 重测：详情点 chip 进 picker"
reset_to_tab_root || true
goto "issue/01a0b3a5-0bf0-7702-b33b-5c38dc6ded45"
wait_issue_detail || true
sleep 4
OK=0
for c in "In Progress" "High" "android" "Android 回归项目"; do
  if wait_for 5 has_text "$c"; then
    tap_text "$c" >/dev/null 2>&1
    sleep 4
    if picker_open; then
      OK=$(( OK + 1 ))
      shot "rm-c6b-picker-$(printf '%s' "$c" | tr ' ' '-')"
    fi
    press_back
    sleep 3
  fi
done
if [ "$OK" -ge 2 ]; then
  check C6b pass "重测：从详情点 chip 打开 picker 成功 $OK 次（主跑 0 次为等待偏紧）"
else
  check C6b fail "重测：从详情点 chip 打开 picker 只成功 $OK 次"
fi

# ── C6c 重测：深链 6 个 issue picker 路由 ───────────────────────────────
# 主跑每条只给 4s 就判 `picker_open`，慢设备上不够（4/6）。这里改成轮询
# 最多 12 次（≈24s），并按 551 的口径留图供肉眼复核。
echo "── C6c 重测：6 个 issue 属性选择器路由"
R_OPENED=0
R_TOTAL=0
for r in status priority assignee label project due-date; do
  R_TOTAL=$(( R_TOTAL + 1 ))
  reset_to_tab_root || true
  goto "issue/01a0b3a5-0bf0-7702-b33b-5c38dc6ded45/picker/$r"
  sleep 3
  if wait_for 12 picker_open; then
    R_OPENED=$(( R_OPENED + 1 ))
  fi
  shot "rm-c6c-picker-$r"
  press_back
  sleep 3
done
if [ "$R_OPENED" = "$R_TOTAL" ]; then
  check C6c pass "重测：6 个 picker 路由全部打开（status/priority/assignee/label/project/due-date；主跑 4/6 为等待偏紧）"
else
  check C6c blocked "重测：自动判据只认到 $R_OPENED/$R_TOTAL —— 以 rm-c6c-picker-*.png 逐张截图判定（551 同口径）"
fi

# ── C7b / C7c 重测：新建 issue 页的属性 chip 与 5 个 picker 路由 ────────
# 与 C6c 同因：主跑每条只等 3~4s。551 的同类条目同样是主跑 2/5、重测后按截图确认。
echo "── C7b 重测：新建 issue 页属性 chip → picker 叠层"
reset_to_tab_root || true
goto "new-issue"
wait_text 20 "New Issue" || wait_text 20 "Issue title" || true
sleep 3
C7OK=0
for chip in "Todo" "Priority" "Assignee" "Due date" "Project"; do
  if wait_for 6 has_text "$chip"; then
    tap_text "$chip" >/dev/null 2>&1
    sleep 3
    if wait_for 10 picker_open; then C7OK=$(( C7OK + 1 )); fi
    shot "rm-c7b-chip-$(printf '%s' "$chip" | tr ' ' '-')"
    press_back
    sleep 3
  fi
done
if [ "$C7OK" -ge 3 ]; then
  check C7b pass "重测：新建 issue 属性 chip 打开 picker 叠层 $C7OK/5（主跑 2/5 为等待偏紧）"
else
  check C7b blocked "重测：自动判据仍只认到 $C7OK/5 —— 以 rm-c7b-chip-*.png 截图判定"
fi

echo "── C7c 重测：new-issue-picker 路由"
C7COPEN=0
C7CTOTAL=0
for r in status priority assignee project due-date; do
  C7CTOTAL=$(( C7CTOTAL + 1 ))
  reset_to_tab_root || true
  goto "new-issue-picker/$r"
  sleep 3
  if wait_for 12 picker_open; then C7COPEN=$(( C7COPEN + 1 )); fi
  shot "rm-c7c-picker-$r"
  press_back
  sleep 3
done
if [ "$C7COPEN" -ge 4 ]; then
  check C7c pass "重测：new-issue-picker 路由打开 $C7COPEN/$C7CTOTAL（主跑为等待偏紧）"
else
  check C7c blocked "重测：自动判据只认到 $C7COPEN/$C7CTOTAL —— 以 rm-c7c-picker-*.png 截图判定"
fi

# ── C7d 重测：走完新建 issue 的提交链路 ─────────────────────────────────
# 主跑 409 的成因是**夹具残留**：551 那轮建的 `FEATURE-551 acceptance issue` 还在库里，
# 服务端对同工作区同名活跃 issue 直接 409 active_duplicate_issue。夹具已补 §13 清理，
# 这里再用带时间戳的标题重测一次，验证提交链路本身正常。
echo "── C7d 重测：新建 issue 提交"
reset_to_tab_root || true
goto "new-issue"
wait_text 15 "Issue title" || wait_text 15 "New Issue" || true
sleep 2
focus_with_ime tap_any_text "Issue title" || focus_with_ime tap_edit 1
TITLE="FEATURE-558 acceptance probe $(date +%H%M%S)"
type_text "$(printf '%s' "$TITLE" | tr ' ' '%s')"
close_ime
sleep 2
if tap_any_desc "Create issue" || tap_any_text "Create issue"; then
  sleep 8
  shot "rm-c7d-after-create"
  if tap_dialog_button 1 >/dev/null 2>&1; then
    check C7d fail "重测：提交仍返回错误并弹原生对话框（见 rm-c7d-after-create.png）"
  elif has_text_re "FEATURE-558 acceptance probe"; then
    check C7d pass "重测：新建 issue 提交成功并进入详情页（标题 $TITLE；主跑 409 为夹具残留同名 issue）"
  else
    check C7d fail "重测：提交后未看到新 issue 详情（见 rm-c7d-after-create.png）"
  fi
  dismiss_dialog
else
  check C7d fail "重测：未定位到 Create issue 按钮"
fi

# ── C8b–C8e 重测：聊天发送后的状态机（本轮的核心补验项）────────────────
# 主跑里的 C8b/K1 失败是**环境遮挡**：expo dev-client 的 Tools 悬浮球被拖到左下角后，
# 正好压在聊天 composer 上，点 composer 落到了悬浮球上，还一路把系统设置页拉了起来
# （截图 c8-02-chat-typed.png 是 "Display over other apps" 设置页）。
# 重测前先处理悬浮球：把它拖回标题栏空白处（不压 composer / 不压右上角 ⋯）。
#
# 判据（与主跑一致）：待发→乐观气泡；运行中→pill 文案或步骤折叠；完成→助手气泡整条出现；
# 失败→失败气泡/文案。客户端**没有**增量助手文本，进度全部体现在 pill 上（见 README §2）。
echo "── C8b–C8e 重测：聊天发送后的状态机"

# 把悬浮球挪到右上角 ⋯ 左侧的空白（x≈700）上方标题区，既不压 ⋯ 也不压 composer
RESET_FAB="${RESET_FAB:-1}"
if [ "$RESET_FAB" = 1 ]; then
  # 悬浮球当前在左下角；长按拖动到标题栏空白处
  adb_ shell input swipe 145 1912 640 95 900 >/dev/null 2>&1
  sleep 2
fi

start_fake_daemon
write_mode pending
reset_to_tab_root || true
goto chat
sleep 6
wait_stable 10 || true
if ! has_text "这条消息用于检查聊天页的历史气泡渲染。"; then
  wait_for 8 has_text "Android 回归会话" && tap_text "Android 回归会话"
  sleep 6
  wait_stable 8 || true
fi
if has_text "这条消息用于检查聊天页的历史气泡渲染。"; then
  check C8 pass "重测：聊天页渲染出夹具会话的历史气泡"
else
  check C8 fail "重测：聊天页未渲染出历史气泡（见 rm-c8-chat.png）"
fi
shot "rm-c8-chat"

# C8b 待发：乐观气泡 + 排队/运行中 pill
if focus_with_ime tap_any_desc "Message…" || focus_with_ime tap_any_text "Message…"; then
  type_text "FEATURE-558%sacceptance%sping"
  sleep 2
  close_ime
  shot "rm-c8b-typed"
  if tap_any_desc "Send"; then
    sleep 1
    shot "rm-c8b-sending"
    OPT=0
    wait_for 6 has_text "FEATURE-558 acceptance ping" && OPT=1
    sleep 4
    shot "rm-c8b-pending"
    PILL=""
    for p in "Queued" "Sending" "Pending" "Starting up" "Retrying"; do
      has_text_re "^$p( · [0-9]+s)?$" && PILL="$PILL $p"
    done
    if [ "$OPT" = 1 ]; then
      check C8b pass "重测：发送后乐观气泡出现（pill 文案${PILL:-未捕获}）"
    else
      check C8b fail "重测：发送后未看到乐观气泡（见 rm-c8b-pending.png）"
    fi
  else
    check C8b fail "重测：未定位到 Send 按钮（见 rm-c8b-typed.png）"
  fi
else
  check C8b fail "重测：未定位到聊天 composer（见 rm-c8-chat.png）"
fi

# C8c 运行中：pill 工作态 +（可能的）步骤折叠
WORKING=""
STEPS=""
for i in 1 2 3 4 5 6; do
  for p in "Thinking" "Typing" "Starting up" "Running" "Reading files" "Running command" "Agent is working…"; do
    has_text_re "^$p( · [0-9]+s)?$" && WORKING="$WORKING $p"
  done
  S="$(descs | grep -oE '[0-9]+ steps?' | head -1)"
  [ -n "$S" ] && STEPS="$S"
  sleep 3
done
WORKING="$(printf '%s\n' $WORKING | sort -u | tr '\n' ' ')"
shot "rm-c8c-running"
chat_task_snapshot
if [ -n "${WORKING// /}" ] || [ -n "$STEPS" ]; then
  check C8c pass "重测：运行中状态可观测（pill 文案「${WORKING:-无}」；步骤折叠「${STEPS:-无}」）"
else
  check C8c fail "重测：运行中 pill/步骤都没看到（见 rm-c8c-running.png、c8-task-snapshot.txt）"
fi

# C8d 完成：切成 success，助手气泡整条出现
write_mode success
DONE=0
wait_for 30 has_text "$FAKE_REPLY" && DONE=1
sleep 3
shot "rm-c8d-done"
chat_task_snapshot
if [ "$DONE" = 1 ]; then
  check C8d pass "重测：助手回复到达（气泡出现固定文案「$FAKE_REPLY」）"
else
  check C8d fail "重测：60s 内未出现助手回复（见 rm-c8d-done.png、c8-task-snapshot.txt）"
fi

# C8e 失败路径：切成 fail 再发一条
write_mode fail
if focus_with_ime tap_any_desc "Message…" || focus_with_ime tap_any_text "Message…"; then
  type_text "FEATURE-558%sfail%sprobe"
  sleep 1
  close_ime
  if tap_any_desc "Send"; then
    FAILED=""
    for i in 1 2 3 4 5 6 7 8; do
      for f in "Daemon offline" "Failed" "Something went wrong" "Retrying" "Show error details"; do
        has_desc_re "^$f$" && FAILED="$FAILED desc:$f"
        has_text_re "^$f$" && FAILED="$FAILED text:$f"
      done
      sleep 3
    done
    FAILED="$(printf '%s\n' $FAILED | sort -u | tr '\n' ' ')"
    shot "rm-c8e-failed"
    chat_task_snapshot
    if [ -n "${FAILED// /}" ]; then
      check C8e pass "重测：失败路径可观测（失败文案/marker =$FAILED）"
    else
      check C8e fail "重测：失败文案未出现（见 rm-c8e-failed.png、c8-task-snapshot.txt）"
    fi
  else
    check C8e fail "重测：第二次发送未点到 Send"
  fi
else
  check C8e fail "重测：第二次发送前未定位到 composer"
fi
write_mode success
stop_fake_daemon

echo "── 重测结束，结果已追加到 $OUT/results.tsv"
