#!/usr/bin/env bash
# FEATURE-558 · 剩余分组续跑（同一构建、同一台模拟器、同一会话）
#
# 为什么要续跑：主跑（`acceptance558.sh`）跑到 B4 时，**承载它的 shell 作业被外层工具
# 的一小时上限杀掉**（日志里的 `error: interrupted`）——不是脚本缺陷，更不是产品缺陷。
# 已完成的 C/K/B1–B4 结论照旧有效；这里把没跑到的分组用**同一套判定代码**补完，
# 结果追加进同一个 `run/results.tsv`，阅读时与主跑结果合起来看。
#
# 续跑的分组：B（B1–B5，含 B5 图片查看器）、V、E、M、D（含 D2/D4/D4b）、C11（最后跑，会登出）。
# 分组定义只有一处 —— 复用 `acceptance558.sh` 的 `run_groups`，本文件不复制任何判定。
#
# 用法：OUT=<主跑产物目录> bash continue558.sh
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${OUT:-$HERE/run}"
export OUT

# 变量名必须避开 `GROUPS`：它是 bash 的**只读内置变量**（当前用户的组 ID 列表，本机为 "20"），
# 赋值会被静默忽略 —— 2026-09-19 就因此把续跑跑成了「未知分组：20」。
export ACCEPT_GROUPS="${ACCEPT_GROUPS:-b,v,e,m,d,c11}"

echo "=== 续跑：ACCEPT_GROUPS=$ACCEPT_GROUPS OUT=$OUT" >&2
exec bash "$HERE/acceptance558.sh"
