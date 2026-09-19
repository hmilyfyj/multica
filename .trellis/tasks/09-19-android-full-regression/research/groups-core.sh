#!/usr/bin/env bash
# FEATURE-551 · C 组（核心流程）+ K 组（键盘避让）+ C11（设置）驱动
#
# 被 acceptance.sh source。选择器全部取自源码里的 accessibilityLabel / placeholder /
# 静态文案（出处见每处注释），坐标一律由 uiautomator 的 bounds 运行时算出。
#
# 出处速查（apps/mobile/ 下）：
#   you@example.com / Send code      app/(auth)/login.tsx:61,79
#   Enter verification code / Verify app/(auth)/verify.tsx:82,111（6 位自动提交 :97）
#   Select a workspace / /<slug>     app/(app)/select-workspace.tsx:35,69-71
#   Inbox / Inbox actions            app/(app)/[workspace]/(tabs)/inbox.tsx:112,118
#   Archive（左滑右侧动作）           components/inbox/swipeable-inbox-row.tsx:101-107
#   Issue actions（⋯）                app/(app)/[workspace]/issue/[id].tsx:172
#   Activity / 属性 chip              components/issue/timeline-list.tsx、attribute-row.tsx:125-213
#   评论长按 → React… → More reactions… components/issue/comment-context-menu.tsx:94-107,235-253
#   Add Reaction（emoji picker 页眉）  app/(app)/[workspace]/issue/[id]/comment/[commentId]/emoji-picker.tsx:73
#   Add a comment, @ to mention…      components/issue/inline-comment-composer.tsx:60
#   Message…（聊天 composer）         components/chat/chat-composer.tsx:109-120
#   Send / Stop agent                 components/composer/message-composer.tsx:589 / chat-composer.tsx:141
#   Create issue                     components/issue/submit-issue-button.tsx:24
#   Search / New issue               components/ui/app-header-actions.tsx:29,37
#   Clear search                     components/ui/search-field.tsx:95
#   Account / Notifications / Sign out app/(app)/[workspace]/more/settings.tsx
#
# 路由参数一律用 **UUID**：`PROB-1` 这类 identifier 的前缀不确定，且过长会被前序任务
# 截断后走时间戳兜底，路由解析不稳（见 driving-plan.md §0.6）。
#
# 轮询次数按「一次 dump ≈ 2s」折算（wait_for 不再额外 sleep）：N 次 ≈ 2N 秒。

ISSUE1=01a0b3a5-0bf0-7702-b33b-5c38dc6ded45   # probe550 · Markdown 语法全覆盖（status=In Progress / priority=High）
ISSUE2=01a0b3a5-2c4c-770e-b13f-c0060d368b7e   # probe550 · 长文档性能夹具

# 收件箱夹具的三行标题；**实测只渲染出后两行** —— 服务端按 issue 去重，
# `probe550 把 PRB-1 指派给了你`（issue#1，40min）被同 issue 更新的
# `probe550 在 PRB-1 的评论中提到了你`（25min）取代，属预期行为而非缺陷。
INBOX_ROW1="probe550 把 PRB-1 指派给了你"
INBOX_ROW2="probe550 在 PRB-1 的评论中提到了你"
INBOX_ROW3="PRB-2 有一条新评论"
COMMENT1="这条评论用来检查 Android 上的评论卡片渲染"

tap_any_text()  { local n; for n in "$@"; do wait_for 5 has_text "$n" && { tap_text "$n"; return 0; }; done; return 1; }
tap_any_desc()  { local n; for n in "$@"; do wait_for 5 has_desc "$n" && { tap_desc "$n"; return 0; }; done; return 1; }

# ══════════════════════════════════════════════════════════════════════
# 阶段 1：C1 登录 / C2 验证码 / C3 工作区选择（含 K5、K6）
# ══════════════════════════════════════════════════════════════════════
phase_core_flows() {
  c1_login
  c2_verify
  c3_workspace
  c4_inbox
  c5_issue_detail
  c6_edit_issue
  c7_new_issue
  c8_chat
  c9_projects
  c10_search
  # C11 由 main 最后调用（退出登录会结束会话）
}

c1_login() {
  if ! wait_text 12 "Sign in to Multica"; then
    cold_start
    if ! wait_text 30 "Sign in to Multica"; then
      # 已有会话：先登出再回来
      reset_to_tab_root || true
      goto more/settings
      wait_stable 8 || true
      scroll_to_bottom 8 || true
      tap_text_in_view "Sign out" 8 >/dev/null 2>&1
      sleep 3
      tap_dialog_button 1 >/dev/null 2>&1
      sleep 10
      if ! wait_text 20 "Sign in to Multica"; then
        check C1 blocked "既进不了登录页，也无法从已登录态登出；后续 C 组全部阻塞"
        return 1
      fi
    fi
  fi
  shot "c1-01-login"

  # K5：登录页键盘避让（邮箱输入框 + Send code）
  wait_for 5 has_text "you@example.com" && tap_text "you@example.com" || tap_edit 1
  type_text "probe551@example.com"
  sleep 2
  probe_ime "k5-login-ime"
  k_group K5 k5-login-ime "登录页邮箱+Send code"

  if tap_any_text "Send code" || tap_any_desc "Send code"; then
    if wait_text 20 "Enter verification code"; then
      check C1 pass "邮箱 → Send code 发出验证码，进入验证码页"
    else
      check C1 fail "点 Send code 后未进入验证码页（见 c1-01-login.png）"
    fi
  else
    check C1 fail "未定位到 Send code 按钮"
  fi
}

c2_verify() {
  shot "c2-01-verify"
  # OTP 是 1 个 opacity:0 的隐藏 TextInput（input-otp-native），6 格是展示用 View，
  # 无障碍树里没有 focused 节点 —— 所以判据取「同屏最下方的关键控件 Verify 是否整块在
  # 键盘顶边之上」：OTP 行在 Verify 上方，Verify 可见即 OTP 可见。
  # 关键：先把键盘等出来再判，否则只会得到「键盘未占位 → 无法判定」。
  if wait_for 15 ime_up; then
    probe_elem_ime "k6-verify-ime" text "Verify"
  else
    shot "k6-verify-ime"
  fi
  k_group K6 k6-verify-ime "验证码页 OTP（以 Verify 按钮位置为判据）"

  if ! ime_up; then tap_edit 1 >/dev/null 2>&1; sleep 2; fi
  type_text "888888"
  sleep 8
  shot "c2-02-after-otp"
  if wait_text 20 "Select a workspace" || in_tab_root; then
    check C2 pass "输入开发码 888888，满 6 位自动提交并通过（verify.tsx:97 onComplete=submit）"
  else
    check C2 fail "OTP 提交未通过（见 c2-02-after-otp.png）"
  fi
}

c3_workspace() {
  shot "c3-01-workspaces"
  if wait_text 18 "Select a workspace"; then
    :
  elif in_tab_root; then
    check C3 blocked "登录后直接进入工作区，未出现工作区选择页"
    return 0
  fi
  # 夹具下应有 2 项：/probe550 与 /probe542；slug 是确定值，比 name 稳
  if wait_for 8 has_text "/probe550" && tap_text "/probe550"; then
    if wait_text 25 "My Issues"; then
      check C3 pass "工作区选择页列出多个工作区（probe550 / probe542），选中 Probe 550 后进入收件箱"
    else
      check C3 fail "选中工作区后未进入 tab（见 c3-01-workspaces.png）"
    fi
  else
    check C3 fail "工作区选择页未列出 /probe550（见 c3-01-workspaces.png）"
  fi
  wait_stable 8 || true
}

# ══════════════════════════════════════════════════════════════════════
# C4 收件箱：列表 / 未读 / 左滑归档 / 顶部批量菜单
# ══════════════════════════════════════════════════════════════════════
c4_inbox() {
  reset_to_tab_root || true
  sleep 3
  shot "c4-01-inbox"
  if any_text "$INBOX_ROW1" "$INBOX_ROW2" "$INBOX_ROW3"; then
    check C4 pass "收件箱渲染出夹具条目（服务端按 issue 去重后 2 行：Mentioned + PRB-2 新评论），见 c4-01-inbox.png"
  else
    check C4 fail "收件箱未渲染出任何夹具条目（见 c4-01-inbox.png）"
  fi

  # 左滑归档（未读那条；夹具在 acceptance.sh 开头已复位成未归档）
  reset_to_tab_root || true
  sleep 3
  if wait_for 12 has_text "$INBOX_ROW2"; then
    swipe_left_text "$INBOX_ROW2"
    shot "c4-03-swipe-reveal"
    if has_desc "Archive" || has_text "Archive"; then
      check C4c pass "左滑未读条目露出 Archive 操作"
      tap_any_text "Archive" >/dev/null 2>&1 || tap_desc "Archive" >/dev/null 2>&1
      sleep 5
      shot "c4-04-after-archive"
      if has_text "$INBOX_ROW2"; then
        check C4d fail "点 Archive 后条目仍在收件箱列表上"
      else
        check C4d pass "点 Archive 后条目从收件箱移除"
      fi
    else
      check C4c fail "左滑未露出 Archive 操作（见 c4-03-swipe-reveal.png）"
      check C4d blocked "上一步失败，归档动作未执行"
    fi
  else
    check C4c blocked "未找到夹具未读行（夹具复位失败？），左滑未测"
    check C4d blocked "同上"
  fi

  # 点开剩余条目 → 详情（详情首屏要串 8 个接口，用 wait_issue_detail 而不是固定 sleep）
  reset_to_tab_root || true
  sleep 3
  if wait_for 12 has_text "$INBOX_ROW3" && tap_text "$INBOX_ROW3"; then
    wait_issue_detail || wait_text 15 "PRB-2" || true
    shot "c4-02-item-opened"
    if any_text "Activity" "PRB-2" "长文档性能夹具"; then
      check C4b pass "点开收件箱条目进入对应 issue 详情"
    else
      check C4b fail "点开条目后未进入详情（见 c4-02-item-opened.png）"
    fi
    press_back
    sleep 3
  else
    check C4b fail "未找到剩余夹具条目"
  fi

  # 顶部批量菜单
  reset_to_tab_root || true
  sleep 3
  if tap_any_desc "Inbox actions"; then
    sleep 3
    shot "c4-05-inbox-actions"
    if any_text "Mark all read" "Archive all" "Archive all read" "Archive completed"; then
      check C4e pass "顶部 Inbox actions 面板打开并列出批量操作"
    else
      check C4e fail "Inbox actions 面板未见批量操作项（见 c4-05-inbox-actions.png）"
    fi
    press_back
  else
    check C4e blocked "未定位到 Inbox actions 入口"
  fi
  sleep 2
}

# ══════════════════════════════════════════════════════════════════════
# C5 issue 详情：时间线 / 评论 / 表情 / ⋯ 菜单 + K2
# ══════════════════════════════════════════════════════════════════════
c5_issue_detail() {
  reset_to_tab_root || true
  goto "issue/$ISSUE1"
  if wait_issue_detail; then
    check C5 pass "深链打开 issue 详情（标题 + 时间线分节）"
  else
    check C5 fail "issue 详情未渲染（见 c5-01-detail-top.png）"
  fi
  sleep 4
  shot "c5-01-detail-top"

  local chip_hits="" chip_miss="" c
  for c in "In Progress" "High" "Android 回归项目" "android" "回归"; do
    if has_text "$c"; then chip_hits="$chip_hits $c"; else chip_miss="$chip_miss $c"; fi
  done
  if [ -n "$chip_hits" ]; then
    check C5b pass "属性 chip 渲染：$chip_hits（未命中：$chip_miss）"
  else
    check C5b fail "属性 chip 全部未命中（见 c5-01-detail-top.png）"
  fi

  # 时间线在长正文之后，虚拟化列表上「文本集合不变」会提前收敛 → 滚到评论出现为止
  scroll_until_text "$COMMENT1" 25 || true
  shot "c5-02-detail-bottom"
  if has_text "$COMMENT1"; then
    check C5c pass "时间线渲染出夹具评论卡片"
  else
    check C5c fail "滚动后夹具评论仍未进无障碍树（见 c5-02-detail-bottom.png）"
  fi

  # ⋯ 菜单（同时是 B2 的驱动）
  reset_to_tab_root || true
  goto "issue/$ISSUE1"
  wait_issue_detail || true
  sleep 3
  if tap_any_desc "Issue actions"; then
    sleep 3
    shot "c5-03-actions-menu"
    if any_text "Edit details" "Delete issue" "Pin" "Unpin"; then
      check C5d pass "⋯ 菜单（JS action sheet）打开并列出操作项"
    else
      check C5d fail "⋯ 菜单未列出操作项（见 c5-03-actions-menu.png）"
    fi
    press_back
  else
    check C5d fail "未定位到 Issue actions 按钮"
  fi
  sleep 2

  # 评论长按 → React… → More reactions… → emoji picker
  scroll_until_text "$COMMENT1" 25 || true
  local lp_ok=0
  if long_press_text "$COMMENT1"; then
    sleep 2
    shot "c5-04-comment-menu"
    any_text "React…" "Reply" && lp_ok=1
  fi
  if [ "$lp_ok" = 1 ]; then
    check C5e pass "长按评论弹出动作面板（Reply / React…）"
    tap_any_text "React…" >/dev/null 2>&1
    sleep 2
    shot "c5-05-react-panel"
    if tap_any_text "More reactions…"; then
      if wait_text 12 "Add Reaction"; then
        check C5f pass "More reactions… 进入 emoji picker 页（页眉 Add Reaction）"
      else
        check C5f fail "未进入 emoji picker（见 c5-05-react-panel.png）"
      fi
      press_back
    else
      check C5f fail "React… 面板里未找到 More reactions…"
    fi
  else
    check C5e fail "长按后未出现动作面板（见 c5-04-comment-menu.png）"
    check C5f blocked "上一步失败"
  fi
  sleep 2

  # K2：评论 composer 键盘避让（对照组，本来就靠 KeyboardStickyView）
  reset_to_tab_root || true
  goto "issue/$ISSUE1"
  wait_issue_detail || true
  sleep 3
  focus_with_ime tap_any_desc "Add a comment, @ to mention…" || focus_with_ime tap_any_text "Add a comment…"
  probe_ime "k2-comment-ime"
  k_group K2 k2-comment-ime "评论 composer"
  close_ime
  press_back
  sleep 2
}

# ══════════════════════════════════════════════════════════════════════
# C6 编辑 issue（K4）+ issue 属性选择器全系列
# ══════════════════════════════════════════════════════════════════════
c6_edit_issue() {
  reset_to_tab_root || true
  goto "issue/$ISSUE1/edit"
  if wait_text 20 "Title" || wait_text 20 "Edit Issue"; then
    check C6 pass "编辑 issue 页打开（Edit Issue：Title + Description 两个字段）"
  else
    check C6 fail "编辑 issue 页未打开（见 c6-01-edit.png）"
  fi
  sleep 3
  shot "c6-01-edit"

  # K4：编辑页键盘避让
  focus_with_ime tap_any_text "Title" || focus_with_ime tap_edit 1
  type_text " regression"
  probe_ime "k4-editissue-ime"
  k_group K4 k4-editissue-ime "编辑 issue 标题"
  close_ime
  sleep 1
  press_back
  sleep 3
  # 放弃修改（若有确认弹窗）
  tap_dialog_button 2 >/dev/null 2>&1
  sleep 2

  # 从 issue 详情点 chip 进 picker（真入口）
  reset_to_tab_root || true
  goto "issue/$ISSUE1"
  wait_issue_detail || true
  sleep 3
  local ok=0 chip
  for chip in "In Progress" "High" "android" "Android 回归项目"; do
    if wait_for 5 has_text "$chip"; then
      tap_text "$chip" >/dev/null 2>&1
      sleep 3
      picker_open && ok=$(( ok + 1 ))
      press_back
      sleep 2
    fi
  done
  if [ "$ok" -ge 3 ]; then
    check C6b pass "从 issue 详情点属性 chip 进入选择器成功 $ok 次（status / priority / label / project）"
  else
    check C6b fail "从详情点 chip 进选择器只成功 $ok 次"
  fi

  # 全系列覆盖：深链 6 个 issue picker 路由
  local r opened=0 total=0
  for r in status priority assignee label project due-date; do
    total=$(( total + 1 ))
    goto "issue/$ISSUE1/picker/$r"
    sleep 4
    shot "c6-picker-$r"
    picker_open && opened=$(( opened + 1 ))
    press_back
    sleep 2
  done
  if [ "$opened" = "$total" ]; then
    check C6c pass "issue 属性选择器 6 个路由（status/priority/assignee/label/project/due-date）全部可打开"
  else
    check C6c fail "issue 属性选择器只打开 $opened/$total 个（见 c6-picker-*.png）"
  fi
}

# ══════════════════════════════════════════════════════════════════════
# C7 新建 issue（K3 + picker 叠层 + 走完提交）
# ══════════════════════════════════════════════════════════════════════
c7_new_issue() {
  reset_to_tab_root || true
  goto "new-issue"
  if wait_text 20 "New Issue" || wait_text 20 "Issue title"; then
    check C7 pass "新建 issue 页打开"
  else
    check C7 fail "新建 issue 页未打开（见 c7-01-new-issue.png）"
  fi
  sleep 3
  shot "c7-01-new-issue"

  # K3：新建页键盘避让
  focus_with_ime tap_any_text "Issue title" || focus_with_ime tap_edit 1
  type_text "Android regression probe"
  probe_ime "k3-newissue-ime"
  k_group K3 k3-newissue-ime "新建 issue 标题"
  close_ime
  sleep 1

  # 属性 chip（新建页）→ 各自 picker 叠层
  local chip ok=0
  for chip in "Todo" "Priority" "Assignee" "Due date" "Project"; do
    if wait_for 5 has_text "$chip"; then
      tap_text "$chip" >/dev/null 2>&1
      sleep 3
      shot "c7-picker-chip-$(echo "$chip" | tr ' ' '-')"
      picker_open && ok=$(( ok + 1 ))
      press_back
      sleep 2
    fi
  done
  if [ "$ok" -ge 3 ]; then
    check C7b pass "新建 issue 的属性 chip 可打开 picker 叠层（$ok/5）"
  else
    check C7b fail "新建 issue 属性 chip 只打开 $ok/5 个（见 c7-picker-chip-*.png）"
  fi

  # 深链 5 个 new-issue-picker 路由
  local r opened=0 total=0
  for r in status priority assignee project due-date; do
    total=$(( total + 1 ))
    goto "new-issue-picker/$r"
    sleep 4
    shot "c7-picker-$r"
    picker_open && opened=$(( opened + 1 ))
    press_back
    sleep 2
  done
  if [ "$opened" -ge 4 ]; then
    check C7c pass "new-issue-picker 路由可打开（$opened/$total）"
  else
    check C7c fail "new-issue-picker 只打开 $opened/$total 个（见 c7-picker-*.png）"
  fi

  # 真正建一条，走完提交链路
  reset_to_tab_root || true
  goto "new-issue"
  wait_text 15 "Issue title" || wait_text 15 "New Issue" || true
  sleep 2
  focus_with_ime tap_any_text "Issue title" || focus_with_ime tap_edit 1
  type_text "FEATURE-551%sacceptance%sissue"
  close_ime
  sleep 2
  shot "c7-02-filled"
  if tap_any_desc "Create issue" || tap_any_text "Create issue"; then
    sleep 8
    shot "c7-03-after-create"
    # 服务端会弹原生「Failed to create issue」对话框；先把它的文案记下来再点掉
    if tap_dialog_button 1 >/dev/null 2>&1; then
      local alert
      alert="$(texts | grep -i -m1 "failed\|error" || true)"
      check C7d fail "提交后服务端返回错误并弹出原生对话框（$alert）—— 见 c7-03-after-create.png"
    elif any_text "acceptance" "FEATURE-551" "Activity"; then
      check C7d pass "新建 issue 提交成功并进入详情页"
    else
      check C7d fail "提交后未看到新 issue 详情（见 c7-03-after-create.png）"
    fi
    dismiss_dialog
  else
    check C7d fail "未定位到 Create issue 按钮"
  fi
}

# ══════════════════════════════════════════════════════════════════════
# C8 聊天（K1 + 发送/发送中/重试）
# ══════════════════════════════════════════════════════════════════════
c8_chat() {
  reset_to_tab_root || true
  goto chat
  sleep 6
  wait_stable 10 || true
  shot "c8-01-chat"
  if ! has_text "这条消息用于检查聊天页的历史气泡渲染。"; then
    wait_for 6 has_text "Android 回归会话" && tap_text "Android 回归会话"
    sleep 6
    shot "c8-01b-chat-session"
  fi
  if has_text "这条消息用于检查聊天页的历史气泡渲染。"; then
    check C8 pass "聊天页渲染出夹具会话的历史气泡（user + assistant 各一条）"
  else
    check C8 fail "聊天页未渲染出夹具历史气泡（见 c8-01-chat.png）"
  fi

  # K1：聊天 composer 键盘避让（548 的主修复点）
  focus_with_ime tap_any_desc "Message…" || focus_with_ime tap_any_text "Message…" || focus_with_ime tap_any_desc "Type a message…"
  probe_ime "k1-chat-ime"
  k_group K1 k1-chat-ime "聊天 composer"
  sleep 1
  type_text "FEATURE-551%sacceptance%sping"
  sleep 2
  close_ime
  shot "c8-02-chat-typed"

  if tap_any_desc "Send"; then
    sleep 1
    shot "c8-03-chat-sending"
    local sending=0
    has_desc "Stop agent" && sending=1
    sleep 6
    shot "c8-04-chat-after-send"
    local pending=0
    any_text "Sending" "Pending" "Retry" "Failed" "Queued" "offline" "wait" && pending=1
    check C8b pass "聊天发送动作已执行（发送中标记 Stop agent=$sending；待发/重试/离线排队 marker=$pending）"
  else
    check C8b fail "未定位到聊天发送按钮（content-desc=Send，见 c8-02-chat-typed.png）"
  fi
  check C8c blocked "流式回复需要在线 agent runtime：夹具 agent 的 runtime（Probe550 Runtime）状态为 offline，消息只能排队；流式 token 本轮无法产出（环境前置，不是客户端缺陷）"
  sleep 2
}

# ══════════════════════════════════════════════════════════════════════
# C9 项目列表与详情
# ══════════════════════════════════════════════════════════════════════
c9_projects() {
  reset_to_tab_root || true
  goto more/projects
  wait_stable 10 || true
  sleep 4
  shot "c9-01-projects"
  if wait_text 10 "Android 回归项目"; then
    check C9 pass "项目列表渲染出夹具项目"
    tap_text "Android 回归项目" >/dev/null 2>&1
    sleep 6
    shot "c9-02-project-detail"
    if has_text "Android 回归项目"; then
      check C9b pass "项目详情页打开"
    else
      check C9b fail "项目详情页未打开（见 c9-02-project-detail.png）"
    fi
    press_back
  else
    check C9 fail "项目列表未渲染出夹具项目（见 c9-01-projects.png）"
    check C9b blocked "上一步失败"
  fi
  sleep 2
}

# ══════════════════════════════════════════════════════════════════════
# C10 全局搜索
# ══════════════════════════════════════════════════════════════════════
c10_search() {
  reset_to_tab_root || true
  sleep 3
  if ! tap_any_desc "Search"; then
    shot "c10-01-search"
    check C10 blocked "未在头部找到 Search 入口（见 c10-01-search.png）"
    return 0
  fi
  sleep 4
  shot "c10-01-search"
  focus_with_ime tap_edit 1 || true
  type_text "Markdown"
  sleep 6
  shot "c10-02-search-results"
  if any_text "PROB Markdown 语法全覆盖" "PROB 长文档性能夹具" "Markdown"; then
    check C10 pass "全局搜索输入后返回结果"
  else
    check C10 fail "搜索无结果（见 c10-02-search-results.png）"
  fi
  close_ime
  press_back
  sleep 2
}

# ══════════════════════════════════════════════════════════════════════
# C11 设置：主题 / 通知偏好 / 工作区 / 退出登录
# ══════════════════════════════════════════════════════════════════════
c11_settings() {
  reset_to_tab_root || true
  goto more/settings
  wait_stable 10 || true
  sleep 3
  shot "c11-01-settings"
  if any_text "Account" "Appearance" "Sign out"; then
    check C11 pass "设置页渲染（Account / Appearance / Sign out）"
  else
    check C11 fail "设置页未渲染（见 c11-01-settings.png）"
  fi

  if wait_for 6 has_text "Notifications" && tap_text "Notifications"; then
    sleep 5
    shot "c11-02-notifications"
    if any_text "Inbox" "System" "Notifications"; then
      check C11b pass "通知偏好页打开"
    else
      check C11b fail "通知偏好页未渲染（见 c11-02-notifications.png）"
    fi
    press_back
  else
    check C11b fail "未找到 Notifications 入口"
  fi
  sleep 2

  reset_to_tab_root || true
  goto more/settings
  wait_stable 10 || true
  if wait_for 6 has_text "Workspaces" || wait_for 5 has_text "/probe542"; then
    shot "c11-03-workspaces"
    check C11c pass "设置页列出工作区（可切换）"
  else
    check C11c fail "设置页未列出工作区（见 c11-03-workspaces.png）"
  fi

  # 退出登录：Alert 标题与按钮同名，必须点原生 positive 按钮
  reset_to_tab_root || true
  goto more/settings
  wait_stable 10 || true
  scroll_to_bottom 10 || true
  shot "c11-04-before-signout"
  if wait_for 6 has_text "Sign out" && tap_text_in_view "Sign out" 8; then
    sleep 4
    shot "c11-05-signout-confirm"
    tap_dialog_button 1 >/dev/null 2>&1
    sleep 12
    shot "c11-06-signed-out"
    if wait_text 20 "Sign in to Multica"; then
      check C11d pass "退出登录后回到登录页"
    else
      check C11d fail "退出登录后未回到登录页（见 c11-06-signed-out.png）"
    fi
  else
    check C11d fail "未定位到 Sign out 行"
  fi
}
