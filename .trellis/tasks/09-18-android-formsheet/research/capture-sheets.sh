#!/usr/bin/env bash
# FEATURE-547 · Android formSheet 逐路由截图驱动器
#
# 用法: ANDROID_SERIAL=emulator-5554 bash capture-sheets.sh <输出目录> [等待秒数]
# 前置: 模拟器已启动、Debug 包已安装并已登录、Metro 监听 8081、后端监听 8090。
#
# 几个实测得出的约束（都写在这里，避免下次重踩）：
#   1. 必须显式指定 `-s <serial>`：本机可能同时跑着别的任务的模拟器。
#   2. 深链必须带 `-n <pkg>/.MainActivity`：dev 与 staging 两个包注册了同一个
#      `multica` scheme，裸 VIEW intent 会弹系统 "Open with" 选择器。
#   3. 不能用 force-stop 做路由间重置：dev 冷启动会落到 expo-dev-client 的
#      开发服务器列表页，且本后端 /api/me 返回 401 会把会话清掉，退回登录页。
#      重置手段是 BACK（RNS 的 sheet 会把 BACK 处理成关闭）。
#   4. due-date 两个路由的 `display="inline"` 在 Android 降级成系统 DatePicker
#      对话框，且该对话框是独立窗口、脱离 sheet 存活。因此这两个路由排在最后：
#      截图后先点掉对话框（此时它仍持有焦点），再 BACK 关 sheet。
set -uo pipefail

ADB_BIN="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
SERIAL="${ANDROID_SERIAL:-emulator-5554}"
PKG="${PKG:-ai.multica.mobile.dev}"

adb_() { "$ADB_BIN" -s "$SERIAL" "$@"; }

WS=probe542
ISSUE1=d432e42f-8ef7-4b77-a56e-c2eb11069c89
ISSUE2=a84a5e74-49c0-4ca3-87a8-9084db883b01
PROJECT=f05959d6-96b8-4358-b4d7-6f0359d0665a
COMMENT=864ccd6b-5f56-42e1-9b58-c50d7fb37069
INBOX_ITEM=2c552f35-ab37-4c5d-9ab0-05971b6880d5

OUT="${1:?usage: capture-sheets.sh <out-dir> [wait-seconds]}"
DELAY="${2:-3}"
mkdir -p "$OUT"

# 原生对话框的 CANCEL 按钮（android:id/button2）中心点，从 uiautomator dump 里取。
tap_dialog_button() {
  local dump=/sdcard/fe547-ui.xml bounds
  adb_ shell uiautomator dump "$dump" >/dev/null 2>&1
  bounds="$(adb_ shell cat "$dump" | tr '>' '\n' \
    | sed -n 's/.*resource-id="android:id\/button2".*bounds="\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]".*/\1 \2 \3 \4/p' \
    | head -1)"
  [ -n "$bounds" ] || return 1
  # shellcheck disable=SC2086
  set -- $bounds
  adb_ shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))
}

# 关闭当前 sheet（必要时先点掉脱离 sheet 的原生对话框）。
reset_state() {
  if tap_dialog_button; then sleep 1; fi
  adb_ shell input keyevent KEYCODE_BACK >/dev/null 2>&1
  sleep 1
}

# name|route path。due-date 两条排在最后，见文件头第 4 条。
ROUTES=(
  "01-inbox-detail|inbox/$INBOX_ITEM"
  "02-issue-picker-status|issue/$ISSUE1/picker/status"
  "03-issue-picker-priority|issue/$ISSUE1/picker/priority"
  "04-issue-picker-assignee|issue/$ISSUE1/picker/assignee"
  "05-issue-picker-label|issue/$ISSUE1/picker/label"
  "06-issue-picker-project|issue/$ISSUE1/picker/project"
  "08-issue-runs|issue/$ISSUE1/runs"
  "09-emoji-picker|issue/$ISSUE1/comment/$COMMENT/emoji-picker"
  "10-mention-picker|mention-picker"
  "11-project-picker-status|project/$PROJECT/picker/status"
  "12-project-picker-priority|project/$PROJECT/picker/priority"
  "13-project-picker-lead|project/$PROJECT/picker/lead"
  "14-project-add-resource|project/$PROJECT/add-resource"
  "15-newissue-picker-status|new-issue-picker/status"
  "16-newissue-picker-priority|new-issue-picker/priority"
  "17-newissue-picker-assignee|new-issue-picker/assignee"
  "18-newissue-picker-project|new-issue-picker/project"
  "20-newproject-picker-status|new-project-picker/status"
  "21-newproject-picker-priority|new-project-picker/priority"
  "22-issues-filter|issues-filter"
  "23-chat-sessions|chat-sessions"
  "24-switch-workspace|switch-workspace"
  "07-issue-picker-due-date|issue/$ISSUE1/picker/due-date"
  "19-newissue-picker-due-date|new-issue-picker/due-date"
)

for entry in "${ROUTES[@]}"; do
  name="${entry%%|*}"
  path="${entry#*|}"
  adb_ shell am start -n "$PKG/.MainActivity" -a android.intent.action.VIEW \
    -d "multica://$WS/$path" >/dev/null 2>&1
  sleep "$DELAY"
  adb_ exec-out screencap -p > "$OUT/$name.png"
  echo "captured $name"
  reset_state
done
