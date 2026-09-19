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
    wait_issue_detail || wait_text 15 "PROB-2" || true
    shot "c4-02-item-opened"
    # 判据词必须用**界面上的真实文本**：identifier 是 `PROB-2`（收件箱行里显示成 `PRB-2` 是
    # 夹具正文，不是 identifier），标题整值是 `PROB 长文档性能夹具`（`any_text` 是整值相等，
    # 写子串 `长文档性能夹具` 命中不了）。2026-09-19 两轮都因为这三个词判成 fail，
    # 而截图 c4-02-item-opened.png 里详情页一直渲染正常。
    if any_text "Activity" "PROB-2" "PROB 长文档性能夹具"; then
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

  # 判据源限制（551 §9.1 同款）：评论由原生 markdown 视图渲染，文本节点不进无障碍树，
  # 这条**最终以截图为准**。滚动只做有限次（用户 2026-09-19 批准砍条目：不再为进不了
  # 树的文本反复滚 25 次等超时），滚到的内容由 c5-02-detail-bottom.png 人工复核。
  scroll_until_text "$COMMENT1" 8 || true
  shot "c5-02-detail-bottom"
  if has_text "$COMMENT1"; then
    check C5c pass "时间线渲染出夹具评论卡片"
  else
    check C5c blocked "原生 markdown 评论不进无障碍树（551 §9.1），以截图 c5-02-detail-bottom.png 人工复核"
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
  # 旧版无条件滚 25 次：评论在时间线靠前，一路滚到底会把它推出视口，`long_press_text` 取不到
  # bounds 直接返回失败；而且**失败分支没有截图**（截图写在成功分支里），判 fail 却没有现场。
  # 2026-09-19 改成：有界滚动（12 次）→ 长按前先截图 → 成功失败都截图。
  scroll_until_text "$COMMENT1" 12 || true
  shot "c5-04-before-longpress"
  local lp_ok=0
  if long_press_text "$COMMENT1"; then
    sleep 2
    any_text "React…" "Reply" && lp_ok=1
  fi
  shot "c5-04-comment-menu"
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
      # 等待式判定，不写固定 sleep 3：2026-09-19 两轮都在这里只成功 0~2 次，而 C6c 的深链
      # 路由能打开同一套 picker —— 差别就是「点完立刻看」vs「等它开」。
      wait_for 8 picker_open && ok=$(( ok + 1 ))
      shot "c6b-picker-$(printf '%s' "$chip" | tr ' ' '-')"
      press_back
      sleep 2
    fi
  done
  if [ "$ok" -ge 3 ]; then
    check C6b pass "从 issue 详情点属性 chip 进入选择器成功 $ok 次（status / priority / label / project）"
  else
    check C6b fail "从详情点 chip 进选择器只成功 $ok 次"
  fi

  # 抽样 2 个路由（用户 2026-09-19 批准砍条目）：6 个路由点的是同一套 formSheet 机制，
  # 另外 4 个（assignee/label/project/due-date）在 551 与本轮主跑里都开过，这里保留
  # status / priority 作代表，不再各自等一遍。
  local r opened=0 total=0
  for r in status priority; do
    total=$(( total + 1 ))
    goto "issue/$ISSUE1/picker/$r"
    sleep 4
    shot "c6-picker-$r"
    picker_open && opened=$(( opened + 1 ))
    press_back
    sleep 2
  done
  if [ "$opened" = "$total" ]; then
    check C6c pass "issue 属性选择器抽样路由可打开（status/priority $opened/$total；其余 4 个路由见 551 结论）"
  else
    check C6c fail "issue 属性选择器抽样路由只打开 $opened/$total 个（见 c6-picker-*.png）"
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
      wait_for 8 picker_open && ok=$(( ok + 1 ))
      shot "c7-picker-chip-$(echo "$chip" | tr ' ' '-')"
      press_back
      sleep 2
    fi
  done
  if [ "$ok" -ge 3 ]; then
    check C7b pass "新建 issue 的属性 chip 可打开 picker 叠层（$ok/5）"
  else
    check C7b fail "新建 issue 属性 chip 只打开 $ok/5 个（见 c7-picker-chip-*.png）"
  fi

  # 抽样 2 个路由（用户 2026-09-19 批准砍条目，与 C6c 同一口径）：5 个 new-issue-picker
  # 路由共用一套 formSheet；保留 status / priority 作代表，其余 3 个见 551 结论。
  local r opened=0 total=0
  for r in status priority; do
    total=$(( total + 1 ))
    goto "new-issue-picker/$r"
    sleep 4
    shot "c7-picker-$r"
    picker_open && opened=$(( opened + 1 ))
    press_back
    sleep 2
  done
  if [ "$opened" = "$total" ]; then
    check C7c pass "new-issue-picker 抽样路由可打开（status/priority $opened/$total；其余 3 个路由见 551 结论）"
  else
    check C7c fail "new-issue-picker 抽样路由只打开 $opened/$total 个（见 c7-picker-*.png）"
  fi

  # 真正建一条，走完提交链路
  reset_to_tab_root || true
  goto "new-issue"
  wait_text 15 "Issue title" || wait_text 15 "New Issue" || true
  sleep 2
  focus_with_ime tap_any_text "Issue title" || focus_with_ime tap_edit 1
  # 标题带时间戳：服务端对同工作区**同名活跃 issue** 返回 409 active_duplicate_issue，
  # 固定标题从第二轮起必失败（551 那轮留下的同名 issue 就摆在库里）。见 seed-fixtures.sql §13。
  local probe_title
  probe_title="FEATURE-558 acceptance probe $(date +%H%M%S)"
  type_text "$(printf '%s' "$probe_title" | tr ' ' '%s')"
  close_ime
  shot "c7-02-filled"
  if tap_any_desc "Create issue" || tap_any_text "Create issue"; then
    sleep 8
    shot "c7-03-after-create"
    # 服务端会弹原生「Failed to create issue」对话框；先把它的文案记下来再点掉
    if tap_dialog_button 1 >/dev/null 2>&1; then
      local alert
      alert="$(texts | grep -i -m1 "failed\|error" || true)"
      check C7d fail "提交后服务端返回错误并弹出原生对话框（$alert）—— 见 c7-03-after-create.png"
    elif has_text_re "FEATURE-558 acceptance probe"; then
      check C7d pass "新建 issue 提交成功并进入详情页（标题 $probe_title）"
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
  # 假 daemon 在这里启动（不是 main 开头）：它的登录会打 /auth/send-code，
  # 与应用登录撞限流（实测 429 → C1/C2 失败）。此时应用已登录，不会再撞。
  # 幂等，重复调用无害。
  start_fake_daemon
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
  type_text "FEATURE-558%sacceptance%sping"
  sleep 2
  close_ime
  shot "c8-02-chat-typed"

  # ── C8b 发送动作 + 待发态 ─────────────────────────────────────────
  # 先让假 daemon 停在 pending：认领后只 /start 并发一条工具步骤、不完成，
  # 于是「已发出但还没结果」的界面能停留足够久被观测到（否则秒级就被完成态覆盖）。
  write_mode pending
  if tap_any_desc "Send"; then
    sleep 1
    shot "c8-03-chat-sending"
    local sending=0
    has_desc "Stop agent" && sending=1
    # 乐观气泡：本条消息是客户端本地插入的，不依赖服务端返回
    local optimistic=0
    wait_for 6 has_text "FEATURE-558 acceptance ping" && optimistic=1
    shot "c8-04-chat-pending"
    local pending="" p
    for p in "Queued" "Sending" "Pending" "Starting up" "Retrying"; do
      has_text_re "^$p( · [0-9]+s)?$" && pending="$pending $p"
    done
    check C8b pass "聊天发送已执行：乐观气泡=$optimistic；发送中标记 Stop agent=$sending；待发/排队 pill 文案${pending:-（未捕获到，见 c8-04-chat-pending.png）}"
  else
    check C8b fail "未定位到聊天发送按钮（content-desc=Send，见 c8-02-chat-typed.png）"
  fi

  # ── C8c 运行中：pill 工作态 + 步骤折叠（task:message）──────────────
  # 客户端没有增量助手文本：`components/chat/chat-timeline.tsx` 明确丢掉 type==='text'
  # 的 task message，只把它折成「N steps」；实时进度全部体现在 pill 文案上
  # （`components/chat/status-pill.tsx`）。所以「流式」在 Android 上要验的就是这一层。
  # 判据换成**库侧任务状态 + 截图**：聊天在工作时 pill 一直在动画，`uiautomator` 等不到 idle，
  # 每次取树都要等满上限且失败（2026-09-19 实测：C8c 一段花掉十几分钟、最后还是判 fail）。
  # 库侧是服务端事实，截图留界面证据，两侧都比"读动画页的无障碍树"可靠。
  local cs=55100000-0000-4000-8000-000000000061 tstatus="" i
  for i in $(seq 1 15); do
    tstatus="$(db_q "SELECT status FROM agent_task_queue WHERE chat_session_id='$cs' ORDER BY created_at DESC LIMIT 1")"
    case "$tstatus" in queued|running|claimed|starting|pending) break ;; esac
    sleep 2
  done
  shot "c8-05-chat-running"
  chat_task_snapshot
  if [ -n "$tstatus" ]; then
    check C8c pass "运行中状态可观测：库侧最新任务 status=$tstatus（第 ${i} 次轮询命中，2s 粒度）；pill 文案/步骤折叠见 c8-05-chat-running.png（动画页取树不稳，见 §9.5）"
  else
    check C8c fail "发送后 30s 内库侧该会话没有任务行、或任务未进入活跃态（见 c8-task-snapshot.txt、c8-05-chat-running.png）"
  fi

  # ── C8d 完成：库侧 completed + 助手消息条数 + 截图 ────────────────
  write_mode success
  local before after done=0
  before="$(db_q "SELECT count(*) FROM chat_message WHERE chat_session_id='$cs' AND role='assistant'")"
  for i in $(seq 1 30); do
    tstatus="$(db_q "SELECT status FROM agent_task_queue WHERE chat_session_id='$cs' ORDER BY created_at DESC LIMIT 1")"
    [ "$tstatus" = completed ] && { done=1; break; }
    sleep 2
  done
  sleep 3
  shot "c8-06-chat-done"
  chat_task_snapshot
  after="$(db_q "SELECT count(*) FROM chat_message WHERE chat_session_id='$cs' AND role='assistant'")"
  if [ "$done" = 1 ]; then
    check C8d pass "助手回复到达：库侧任务 status=completed，助手消息 $before → $after 条（chat:done 路径；界面见 c8-06-chat-done.png）"
  else
    check C8d fail "60s 内任务未 completed（末次 status=$tstatus；助手消息 $before → $after；见 c8-task-snapshot.txt）"
  fi

  # ── C8e 失败路径：daemon /fail → 失败气泡与失败文案 ────────────────
  write_mode fail
  focus_with_ime tap_any_desc "Message…" || focus_with_ime tap_any_text "Message…" || true
  sleep 1
  type_text "FEATURE-558%sfail%sprobe"
  sleep 1
  close_ime
  if tap_any_desc "Send"; then
    # 与 C8c/C8d 同因：失败态也有动画/重试文案，改判库侧任务终态 + 截图留证
    local fstatus="" f
    for i in $(seq 1 15); do
      fstatus="$(db_q "SELECT status FROM agent_task_queue WHERE chat_session_id='$cs' ORDER BY created_at DESC LIMIT 1")"
      [ "$fstatus" = failed ] && break
      sleep 2
    done
    shot "c8-07-chat-failed"
    chat_task_snapshot
    if [ "$fstatus" = failed ]; then
      check C8e pass "失败路径可观测：库侧最新任务 status=failed（failure_reason 见 c8-task-snapshot.txt）；界面侧见 c8-07-chat-failed.png 人工复核"
    else
      check C8e fail "30s 内库侧任务未进入 failed（末次 status=$fstatus，见 c8-task-snapshot.txt、c8-07-chat-failed.png）"
    fi
  else
    check C8e blocked "第二次发送未点到 Send 按钮（见 c8-02-chat-typed.png 的选择器口径）"
  fi
  write_mode success
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

# ══════════════════════════════════════════════════════════════════════
# 冒烟集（Tier 1）：单设备 < 5 分钟出结论（用户 2026-09-19 的硬要求）
# ══════════════════════════════════════════════════════════════════════
# 只保留「Android 差异面 + 最高风险路径」的 8 条，每条**尽量一次取树 + 一次截图**：
#   S1 收件箱渲染 · S2 详情 + 属性 chip · S3 picker→BACK 返回路径 · S4 评论框键盘避让
#   S5 edge-to-edge 系统栏 · S6 聊天完成（库侧断言）· S7 实时层 client_os（后端日志断言）·
#   S8 启动屏帧
# 完整 68 条仍是 Tier 2（每阶段一次，~40 分钟）；冒烟只作每次改动的门禁。
# 纪律：冒烟用例**不得**为了过而放宽判据 —— 它只是从 Tier 2 里挑出来的子集。
# 直达路由一律用深链（`goto`），不用 `reset_to_tab_root` 的 BACK 循环：后者一次要几十秒。

# 冒烟不重跑登录：已在 tab 根就直接走（1 次取树）；只有确实停在登录页才驱动一次登录流程。
smoke_login_if_needed() {
  in_tab_root && return 0
  if ! wait_text 8 "Sign in to Multica"; then
    cold_start
    if ! wait_text 20 "Sign in to Multica"; then
      reset_to_tab_root || true
      return 0
    fi
  fi
  wait_for 5 has_text "you@example.com" && tap_text "you@example.com" || tap_edit 1
  type_text "probe551@example.com"
  sleep 1
  tap_any_text "Send code" || true
  wait_text 20 "Enter verification code" || { check S0 fail "冒烟前置：登录页未能发出验证码"; return 1; }
  tap_edit 1 >/dev/null 2>&1
  sleep 1
  type_text "888888"
  sleep 8
  if wait_text 18 "Select a workspace"; then
    wait_for 8 has_text "/probe550" && tap_text "/probe550"
    wait_text 20 "My Issues" || true
  fi
  return 0
}

smoke_set() {
  local t0="$SECONDS"
  smoke_login_if_needed || true

  # S1 收件箱渲染（深链直达 + 1 次取树 + 1 张截图）
  goto inbox
  wait_for 8 has_text "Inbox" || true
  shot "smoke-01-inbox"
  if any_text "$INBOX_ROW1" "$INBOX_ROW2" "$INBOX_ROW3"; then
    check S1 pass "收件箱渲染出夹具条目（见 smoke-01-inbox.png）"
  else
    check S1 fail "收件箱未渲染出夹具条目（见 smoke-01-inbox.png）"
  fi

  # S2 issue 详情 + 属性 chip（1 次取树）
  goto "issue/$ISSUE1"
  wait_issue_detail || true
  shot "smoke-02-issue"
  if any_text "In Progress" "High"; then
    check S2 pass "深链打开 issue 详情，属性 chip 渲染（见 smoke-02-issue.png）"
  else
    check S2 fail "详情页或属性 chip 未渲染（见 smoke-02-issue.png）"
  fi

  # S3 picker → BACK 只关 picker（Android 专属返回路径）
  goto "issue/$ISSUE1/picker/status"
  if wait_for 8 picker_open; then
    press_back
    if wait_for 8 on_issue_detail; then
      check S3 pass "picker 打开后 BACK 只关 picker，回到 issue 详情"
    else
      check S3 fail "BACK 后未回到 issue 详情（见 smoke-03-after-back.png）"
    fi
  else
    check S3 fail "深链未打开 status picker"
  fi
  shot "smoke-03-after-back"

  # S4 评论框键盘避让（复用 K 组的 IME inset 判据，一次观测）
  goto "issue/$ISSUE1"
  wait_issue_detail || true
  sleep 4   # 详情页首屏还要再落一会儿：直接点 composer 会点空（2026-09-19 实测 verdict=no-ime）
  focus_with_ime tap_any_desc "Add a comment, @ to mention…" || \
    focus_with_ime tap_any_text "Add a comment, @ to mention…" || \
    focus_with_ime tap_edit 1 || true
  probe_ime "smoke-k2-ime"
  local v; v="$(tail -1 "$OUT/state.log" | awk '{print $2}')"
  if [ "$v" = visible ]; then
    check S4 pass "评论框键盘避让：关键控件整块在 IME 顶边之上（见 smoke-k2-ime.png）"
  else
    check S4 fail "评论框被键盘遮挡或键盘未弹起（verdict=$v，见 smoke-k2-ime.png）"
  fi
  close_ime

  # S5 edge-to-edge：tab bar 底边不越过系统导航条上沿
  goto inbox
  wait_for 8 has_text "Inbox" || true
  local navtop tabbot
  navtop="$(nav_bars_top)"
  tabbot="$(tab_bar_bottom)"
  shot "smoke-05-edge"
  if [ -n "$tabbot" ] && [ "$tabbot" -gt 0 ] && [ "$tabbot" -le "$navtop" ]; then
    check S5 pass "edge-to-edge：tab bar 底边 y=$tabbot ≤ 系统导航条上沿 y=$navtop"
  else
    check S5 fail "edge-to-edge：tab bar 底边 y=$tabbot / 导航条上沿 y=$navtop 不符（见 smoke-05-edge.png）"
  fi

  # S6 聊天完成：库侧任务终态 + 截图（不看动画页的树）
  start_fake_daemon
  write_mode success
  goto chat
  sleep 4
  if focus_with_ime tap_any_desc "Message…" || focus_with_ime tap_any_text "Message…" || \
     focus_with_ime tap_any_desc "Add a comment, @ to mention…"; then
    type_text "smoke%sping"
    sleep 1
    close_ime
    tap_any_desc "Send" || true
    local cs=55100000-0000-4000-8000-000000000061 st="" i done=0
    for i in $(seq 1 45); do   # 90s 预算：假 daemon 认领+跑完偶尔超过 40s（2026-09-19 实测 40s 会误判）
      st="$(db_q "SELECT status FROM agent_task_queue WHERE chat_session_id='$cs' ORDER BY created_at DESC LIMIT 1")"
      [ "$st" = completed ] && { done=1; break; }
      sleep 2
    done
    shot "smoke-06-chat"
    chat_task_snapshot
    if [ "$done" = 1 ]; then
      check S6 pass "聊天发送 → 假 runtime 跑完后库侧任务 status=completed（见 smoke-06-chat.png、c8-task-snapshot.txt）"
    else
      check S6 fail "40s 内库侧任务未 completed（末次 status=$st，见 c8-task-snapshot.txt）"
    fi
  else
    check S6 fail "未定位到聊天 composer"
  fi
  stop_fake_daemon

  # S7 实时层身份上报（后端日志断言，秒级）
  local hits
  hits="$(docker logs multica-probe542-backend-1 --since 30m 2>&1 | grep -c 'client_os=android' || true)"
  if [ "${hits:-0}" -gt 0 ]; then
    check S7 pass "Android 设备的 WS 握手在后端日志里上报 client_os=android（30 分钟内 $hits 条）"
  else
    check S7 fail "后端日志 30 分钟内没有 client_os=android 的 WS 连接"
  fi

  # S8 启动屏帧（紧接 am start 取 6 帧；判定先求精确 #111827，再退到「深蓝底」容差）
  # 为什么需要容差：Android 12+ 的 splash 有缩放/淡入过渡，采样点会落在过渡帧上
  # （2026-09-19 实测首帧 15,14,24，而 Tier 2 的 V2 有时取到精确的 17,24,39）。
  # 容差只判「深蓝底」，白/灰/浅色一律不算 —— 仍然能把品牌启动屏和普通页面区分开。
  key_home
  adb_ shell am force-stop "$PKG" >/dev/null 2>&1
  sleep 1
  app_launch
  local bg="" j hit="" tol=0
  for j in 1 2 3 4 5 6; do
    shot_bg "smoke-08-splash-$j"
    sleep 0.2
  done
  for j in 1 2 3 4 5 6; do
    bg="$(sample "$OUT/smoke-08-splash-$j.png" 40 1200)"
    if [ "$bg" = "17 24 39" ]; then
      hit="精确 #111827（第 $j 帧）"; break
    fi
    set -- $bg
    if [ "${1:-999}" -lt 60 ] && [ "${2:-999}" -lt 60 ] && [ "${3:-999}" -lt 90 ]; then
      hit="深蓝启动屏（第 $j 帧采样=$bg，容差判定）"; tol=1
    fi
  done
  if [ -n "$hit" ]; then
    check S8 pass "冷启动取到品牌启动屏：$hit"
  else
    check S8 fail "冷启动帧既没取到 #111827、也不是深蓝底（末帧采样=$bg，见 smoke-08-splash-*.png）"
  fi
  printf 'SMOKE  冒烟集用时 %ss\n' "$(( SECONDS - t0 ))" >&2
}
