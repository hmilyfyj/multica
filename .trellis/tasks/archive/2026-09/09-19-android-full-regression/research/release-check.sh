#!/usr/bin/env bash
# FEATURE-551 · Release 产物核验（生产变体，FEATURE-552 的签名 APK）
#
# 与 Debug 验收同一会话、同一个模拟器，只多做**一次安装**（Debug 一次 + Release 一次是
# issue 明确允许的上限）。生产包的 API base 是 https://api.multica.ai、没有可用凭据，
# 所以 Release 只核验「装得上、起得来、品牌与签名正确」，不跑登录后的业务流程。
#
# 用法：OUT=<产物目录> bash release-check.sh
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${OUT:-$HERE/run-release}"
mkdir -p "$OUT"
export OUT

source "$HERE/lib551.sh"

APK="${APK:-/Users/fengit/workspace/multica.worktrees/FEATURE-552/apps/mobile/dist/android/multica-mobile-production-0.1.0-vc1.apk}"
REL_PKG="com.ehaier.zgq.shop.mall"
BT="${ANDROID_HOME:-$HOME/Library/Android/sdk}/build-tools/36.0.0"

: > "$OUT/results.tsv"

# ── 1) 安装 ────────────────────────────────────────────────────────────
install_out="$(adb_ install -r "$APK" 2>&1 | tail -2)"
printf '%s\n' "$install_out" > "$OUT/install.txt"
if printf '%s' "$install_out" | grep -q "Success"; then
  check R1 pass "Release APK 安装成功（$(basename "$APK")）：$install_out"
else
  check R1 blocked "Release APK 未装上：$install_out"
fi

# ── 2) 包名 / 版本 / 应用名 ────────────────────────────────────────────
listing="$(adb_ shell pm list packages | grep -F "$REL_PKG" | tr -d '\r')"
badging="$("$BT/aapt2" dump badging "$APK" 2>/dev/null | grep -E "^package:|^application-label:" | head -3)"
printf '%s\n' "$badging" > "$OUT/badging.txt"
if printf '%s' "$listing" | grep -q "$REL_PKG"; then
  check R2 pass "包名 $REL_PKG 出现在 pm list packages；$badging"
else
  check R2 fail "pm list packages 里没有 $REL_PKG"
fi

if printf '%s' "$badging" | grep -q "application-label:'海尔商城'"; then
  check R3 pass "应用列表名为「海尔商城」（application-label）"
else
  check R3 fail "应用列表名不是「海尔商城」：$badging"
fi

# ── 3) 签名（与仓库外的自用密钥库比对）────────────────────────────────
apk_sha="$("$BT/apksigner" verify --print-certs "$APK" 2>/dev/null | grep -i "SHA-256 digest" | head -1 | awk '{print $NF}')"
ks_sha="$(export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home; "$JAVA_HOME/bin/keytool" -list -v -keystore ~/.multica-android/multica-release.keystore -storepass "$(grep storePassword ~/.multica-android/keystore.properties | cut -d= -f2)" -alias multica-release 2>/dev/null | grep -i "SHA256:" | head -1 | awk '{print $NF}')"
apk_sha_norm="$(printf '%s' "$apk_sha" | tr -d ':' | tr 'A-F' 'a-f')"
ks_sha_norm="$(printf '%s' "$ks_sha" | tr -d ':' | tr 'A-F' 'a-f')"
printf 'apk=%s\nkeystore=%s\n' "$apk_sha" "$ks_sha" > "$OUT/signature.txt"
if [ -n "$apk_sha_norm" ] && [ "$apk_sha_norm" = "$ks_sha_norm" ]; then
  check R4 pass "Release 由自用发布密钥签名（SHA-256 $apk_sha 与 ~/.multica-android 密钥库一致，非 debug 密钥）"
else
  check R4 fail "签名指纹不一致：apk=$apk_sha keystore=$ks_sha"
fi

# ── 4) 冷启动：启动屏 + 登录页渲染 ────────────────────────────────────
if ! printf '%s' "$install_out" | grep -q "Success"; then
  check R5 blocked "R1 未成功，冷启动未执行"
  check R6 blocked "R1 未成功，冷启动未执行"
  check R7 blocked "R1 未成功，冷启动未执行"
  echo "=== Release 核验完成（安装失败），结果见 $OUT/results.tsv"
  exit 0
fi

# Debug 包（staging）会抢焦点，先停掉；Release 的 launcher activity 由 prebuild 生成，
# 用 resolve-activity 取而不是猜（monkey 在只有 launcher intent-filter 的包上不可靠）。
adb_ shell am force-stop "$PKG" >/dev/null 2>&1
adb_ shell am force-stop "$REL_PKG" >/dev/null 2>&1
sleep 2
rel_act="$(adb_ shell cmd package resolve-activity --brief -c android.intent.category.LAUNCHER "$REL_PKG" 2>/dev/null | tail -1 | tr -d '\r')"
printf 'launcher_activity=%s\n' "${rel_act:-<unresolved>}" > "$OUT/launch-activity.txt"
[ -n "$rel_act" ] && [ "$rel_act" != "<unresolved>" ] || rel_act="$REL_PKG/.MainActivity"
adb_ shell am start -n "$rel_act" >/dev/null 2>&1

# Release 首次冷启动比 Debug 慢（要校验/解压内嵌 bundle），多采几帧、窗口拉长到 ~4.5s
i=0; bg=""; best=""
while [ "$i" -lt 18 ]; do
  i=$(( i + 1 ))
  adb_ exec-out screencap -p > "$OUT/release-launch-$i.png" 2>/dev/null
  sleep 0.25
done
i=0
while [ "$i" -lt 18 ]; do
  i=$(( i + 1 ))
  bg="$(sample "$OUT/release-launch-$i.png" 40 1200)"
  if [ "$bg" = "17 24 39" ]; then best="release-launch-$i"; break; fi
done
if [ -n "$best" ]; then
  check R5 pass "Release 冷启动取到品牌启动屏背景 #111827（$best）"
else
  check R5 fail "Release 冷启动 18 帧（~4.5s）未取到 #111827（最后一帧采样=$bg）"
fi

# 登录页渲染（Release 内嵌 JS，不连 Metro）
if wait_text 90 "Sign in to Multica"; then
  adb_ exec-out screencap -p > "$OUT/release-login.png" 2>/dev/null
  check R6 pass "Release 内嵌 bundle 正常加载：冷启动后渲染出登录页（不连 Metro）"
else
  adb_ exec-out screencap -p > "$OUT/release-login.png" 2>/dev/null
  check R6 fail "Release 冷启动后未渲染出登录页（见 release-login.png）"
fi

focus="$(adb_ shell dumpsys window 2>/dev/null | grep -o 'mCurrentFocus=Window{[^}]*}' | head -1)"
if printf '%s' "$focus" | grep -q "$REL_PKG"; then
  check R7 pass "前台窗口是 Release 包：$focus"
else
  check R7 fail "前台窗口不是 Release 包：$focus"
fi

echo "=== Release 核验完成，结果见 $OUT/results.tsv"
