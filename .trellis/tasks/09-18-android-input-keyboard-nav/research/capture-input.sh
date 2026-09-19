#!/usr/bin/env bash
# FEATURE-548 · 六个输入场景的键盘遮挡取证驱动器
#
# 用法:  bash capture-input.sh <输出目录> <场景|all>
#   场景: chat | comment | new-issue | edit-issue | login | verify
# 前置: 模拟器已启动并登录、Metro 在 8081（本任务 worktree）、后端在 8090
#       （apps/mobile/.env.development.local）。WS=probe550。
#
# 每个场景只做两件事：把目标输入框点出来 → probe（截图 + 一行判定）。
# state.log 里每行的字段：判定 | imeTop | focus(焦点输入框矩形) | root(decor 矩形)。
# 判定口径见 lib.sh 的 probe：visible / partial / covered / no-ime。
#
# 三个实测坑写在这里，避免下次重踩：
#   1. dev-client 记住的 bundle URL 可能不是本任务的 Metro（本机曾存在别的任务
#      崩溃后残留的 8083 服务，应用会被带走）。截图里一旦出现 "Loading from
#      <别的端口>"，这次观测作废，先 point_at_metro 再重跑。
#   2. 应用偶发落到「JS 在跑、路由栈渲染为空」的状态（截图只剩状态栏与 dev-client
#      的 Tools 悬浮按钮），此时所有点击都落空。ensure_app 会冷启恢复后再测。
#   3. 模拟器输入法偶发「有输入连接但不弹键盘」；focus_with_ime 已内置兜底重试。
set -uo pipefail

LIB="$(cd "$(dirname "$0")" && pwd)/lib.sh"
# shellcheck source=lib.sh
source "$LIB"

ISSUE="${ISSUE:-01a0b3a5-0bf0-7702-b33b-5c38dc6ded45}"   # /probe550/PROB-1

OUT="${1:?usage: capture-input.sh <out-dir> <scenario|all>}"
SCEN="${2:-all}"
mkdir -p "$OUT"

scenario_chat() {
  ensure_app || return 1
  close_ime; goto "chat"; sleep 6
  focus_with_ime tap_desc "Message…"
  probe "$OUT" "01-chat-composer"
}

scenario_comment() {
  ensure_app || return 1
  close_ime; goto "issue/$ISSUE"; sleep 6
  focus_with_ime tap_desc "Add a comment, @ to mention…"
  probe "$OUT" "02-comment-composer"
}

scenario_new_issue() {
  ensure_app || return 1
  close_ime; goto "new-issue"; sleep 6
  focus_with_ime tap_edit 1                  # 标题（顶部）
  probe "$OUT" "03-newissue-title"
  close_ime
  focus_with_ime tap_edit 2                  # 描述（页面下半部）
  probe "$OUT" "04-newissue-description"
}

scenario_edit_issue() {
  ensure_app || return 1
  close_ime; goto "issue/$ISSUE/edit"; sleep 6
  focus_with_ime tap_edit 1
  probe "$OUT" "05-editissue-title"
  close_ime
  focus_with_ime tap_edit 2
  probe "$OUT" "06-editissue-description"
}

# 登录/验证码需要先登出：这两个场景放在最后跑，跑完重新登录。
scenario_login() {
  ensure_app || return 1
  close_ime; goto "more/settings"; sleep 5
  tap_text "Sign out"; sleep 5
  focus_with_ime tap_edit 1
  probe "$OUT" "07-login-email"
}

scenario_verify() {
  # 落在此页时邮箱已填好，点 Send code 进验证码页
  tap_text "Send code"; sleep 6
  focus_with_ime tap_edit 1
  probe "$OUT" "08-verify-code"
}

case "$SCEN" in
  chat)       scenario_chat ;;
  comment)    scenario_comment ;;
  new-issue)  scenario_new_issue ;;
  edit-issue) scenario_edit_issue ;;
  login)      scenario_login ;;
  verify)     scenario_verify ;;
  *)          echo "unknown scenario: $SCEN" >&2; exit 2 ;;
esac
