#!/usr/bin/env bash
# FEATURE-546 · Android 选择器搜索框逐路由验证驱动器
#
# 用法: ANDROID_SERIAL=emulator-5554 bash capture-search.sh <输出目录> [等待秒数]
# 前置: 模拟器已启动、Debug 包已安装并已登录、Metro 监听 8081、后端监听 8090。
#
# 复用的实测约束（同 FEATURE-547 的 capture-sheets.sh）：
#   1. 必须显式 `-s <serial>`：本机可能同时跑着别的任务的模拟器。
#   2. 深链必须带 `-n <pkg>/.MainActivity`：dev 与 staging 两个包注册了同一个
#      `multica` scheme，裸 VIEW intent 会弹系统 "Open with" 选择器。
#   3. 路由间重置用 BACK（RNS 把 BACK 处理成关闭 sheet）；不要 force-stop
#      （dev 冷启动会落到 expo-dev-client 的服务器列表页）。
#   4. `adb shell input text` 只能输入 ASCII，所以正例关键字都用种子数据里的
#      英文名（probe542 / Probe Agent / android546）。两个 project picker 的种子
#      项目名是中文，无法用 input text 打出，因此它们的正例步骤省略，改用
#      「输入后 "No project" 行消失 + 无匹配查询出现空态」证明 query 已进入过滤。
#
# 每个路由的验证序列：
#   baseline → 输入正例关键字（若有）→ 追加 zzzq（应无匹配）→ 点 ✕ 清除（应恢复 baseline）
# 每步都落 dump（xml）+ 截图（png）+ 可见文本清单（txt）。
set -uo pipefail

ADB_BIN="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
SERIAL="${ANDROID_SERIAL:-emulator-5554}"
PKG="${PKG:-ai.multica.mobile.dev}"

adb_() { "$ADB_BIN" -s "$SERIAL" "$@"; }

WS=probe542
ISSUE=d432e42f-8ef7-4b77-a56e-c2eb11069c89
PROJECT=f05959d6-96b8-4358-b4d7-6f0359d0665a

OUT="${1:?usage: capture-search.sh <out-dir> [wait-seconds]}"
DELAY="${2:-2}"
mkdir -p "$OUT"

dump() { # dump <basename>  → <OUT>/<basename>.xml + .txt + .png
  adb_ shell uiautomator dump /sdcard/fe546-ui.xml >/dev/null 2>&1
  adb_ shell cat /sdcard/fe546-ui.xml > "$OUT/$1.xml"
  tr '<' '\n' < "$OUT/$1.xml" \
    | grep -o 'text="[^"]*"\|content-desc="[^"]*"' \
    | sed 's/^[a-z-]*="//; s/"$//' \
    | grep -v '^$' > "$OUT/$1.txt"
  adb_ exec-out screencap -p > "$OUT/$1.png"
}

bounds_of() { # bounds_of <xml> <grep-pattern>  → "x1 y1 x2 y2"
  tr '<' '\n' < "$1" | grep "$2" \
    | sed -n 's/.*bounds="\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]".*/\1 \2 \3 \4/p' \
    | head -1
}

tap_bounds() { # tap_bounds "x1 y1 x2 y2"
  # shellcheck disable=SC2086
  set -- $1
  adb_ shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))
}

# name|route|positive-keyword（空则跳过正例步骤）
ROUTES=(
  "01-issue-assignee|issue/$ISSUE/picker/assignee|probe"
  "02-issue-label|issue/$ISSUE/picker/label|android"
  "03-issue-project|issue/$ISSUE/picker/project|"
  "04-mention-picker|mention-picker|probe"
  "05-newissue-assignee|new-issue-picker/assignee|probe"
  "06-newissue-project|new-issue-picker/project|"
  "07-project-lead|project/$PROJECT/picker/lead|probe"
)

FAILED=0

for entry in "${ROUTES[@]}"; do
  name="${entry%%|*}"
  rest="${entry#*|}"
  path="${rest%%|*}"
  keyword="${rest#*|}"

  adb_ shell am start -n "$PKG/.MainActivity" -a android.intent.action.VIEW \
    -d "multica://$WS/$path" >/dev/null 2>&1
  sleep "$DELAY"
  dump "$name-01-baseline"

  field="$(bounds_of "$OUT/$name-01-baseline.xml" 'class="android.widget.EditText"')"
  if [ -z "$field" ]; then
    echo "FAIL $name: no EditText (search field) in sheet"
    FAILED=1
    adb_ shell input keyevent KEYCODE_BACK >/dev/null 2>&1
    sleep 1
    continue
  fi

  tap_bounds "$field"
  sleep 1

  if [ -n "$keyword" ]; then
    adb_ shell input text "$keyword" >/dev/null 2>&1
    sleep 2
    dump "$name-02-filtered"
  fi

  adb_ shell input text "zzzq" >/dev/null 2>&1
  sleep 2
  dump "$name-03-nomatch"

  clear="$(bounds_of "$OUT/$name-03-nomatch.xml" 'content-desc="Clear search"')"
  if [ -z "$clear" ]; then
    echo "FAIL $name: no clear (✕) button after typing"
    FAILED=1
  else
    tap_bounds "$clear"
    sleep 2
    dump "$name-04-cleared"
  fi

  adb_ shell input keyevent KEYCODE_BACK >/dev/null 2>&1
  sleep 1
  echo "checked $name"
done

echo "done (failures: $FAILED)"
exit "$FAILED"
