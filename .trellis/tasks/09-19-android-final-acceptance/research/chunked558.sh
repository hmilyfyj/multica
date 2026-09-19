#!/usr/bin/env bash
# FEATURE-558 · 分片跑到完（**每个分组一个进程**，各自远低于外层工具 1 小时的调用上限）
#
# 为什么分片：整轮 70+ 条判据的墙钟超过 1 小时，而外层工具/会话的调用上限是 1 小时 ——
# 2026-09-19 实测被截断两次（见 `run-vem-interrupted.log`）。被截断的那片，进程连同它还没
# 打印出来的结论一起消失，观感就是「又卡在某个页面，还不知道在等啥」。分片后每片自己收尾、
# 自己出表：被截断最多丢一片，其余分组的结论已经落在 `results.tsv` 里。
#
# 与 `continue558.sh` 的分工：那个是「主跑被杀后手工接着跑剩下的组」，这个是**默认入口**——
# 从一开始就分片，不依赖上一次被杀在哪。
#
# 用法：
#   OUT=$PWD/run bash chunked558.sh                 # 全部分组逐片跑（默认开快速档）
#   ACCEPT_GROUPS="v,e" OUT=$PWD/run bash chunked558.sh   # 只跑指定分组（重查失败项用）
#   APPEND=1 OUT=$PWD/run bash chunked558.sh        # 不清空既有结果，追加
#   ACCEPT_FAST=0 bash chunked558.sh                # 关快速档
#   BUILD_VARIANT=release OUT=$PWD/run bash chunked558.sh   # 跑 Release 构建（默认 debug）
#
# 纪律（与 fast558.sh 同）：`ACCEPT_FAST=1` 只改「等多久」，不改任何判据；同一分组开/关两档
# 的判定必须一致，出现差异以**未开**的那次为准，并把该条当判定源缺陷去修（见 README §5）。
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${OUT:-$HERE/run}"
# 变量名必须避开 `GROUPS`：它是 bash 的**只读内置变量**（当前用户的组 ID 列表，本机为 "20"），
# 赋值会被静默忽略 —— 2026-09-19 首跑就因此把分片跑成了「未知分组：20」。用 `ACCEPT_GROUPS`，
# 与 acceptance558.sh / continue558.sh 同一个名字。
ACCEPT_GROUPS="${ACCEPT_GROUPS:-core,b,v,e,m,d,c11}"
export OUT
export ACCEPT_FAST="${ACCEPT_FAST:-1}"
mkdir -p "$OUT"

if [ "${APPEND:-0}" != 1 ]; then
  : > "$OUT/results.tsv"
  : > "$OUT/timings.tsv"
fi

total0="$SECONDS"
for g in ${ACCEPT_GROUPS//,/ }; do
  t0="$SECONDS"
  printf '┌─ 分片 %s 起跑（%s，ACCEPT_FAST=%s）\n' "$g" "$(date -u +%H:%M:%SZ)" "$ACCEPT_FAST" >&2
  ACCEPT_GROUPS="$g" bash "$HERE/acceptance558.sh" || \
    printf '!! 分片 %s 退出码 %s（已产出的结论仍在 results.tsv 里）\n' "$g" "$?" >&2
  printf '└─ 分片 %s 结束，用时 %ss\n' "$g" "$(( SECONDS - t0 ))" >&2
done

printf '== 全部分片结束，总用时 %ss；结论表 %s/results.tsv，逐条耗时 %s/timings.tsv\n' \
  "$(( SECONDS - total0 ))" "$OUT" "$OUT" >&2
