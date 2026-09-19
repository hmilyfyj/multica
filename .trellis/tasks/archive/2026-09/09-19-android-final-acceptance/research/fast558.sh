#!/usr/bin/env bash
# FEATURE-558 · 快速档入口：**同一套判据**，只把「等多久」收紧（不新增、不删除任何判据）
#
# 用法：
#   ACCEPT_GROUPS=b,v bash fast558.sh      # 只跑指定分组
#   bash fast558.sh                        # 整轮（默认全部）
#
# 与 `acceptance558.sh` 的差别只有一个环境变量 `ACCEPT_FAST=1`（实现见 lib558.sh 的
# `wait_for` / `anr_terminal_state`）：
#   · 手势后的等待上限 8 次（≈16s）；判定源里显式写了 > 20 次的长等待不受影响；
#   · 出现 ANR / 系统无响应对话框就立刻收手，记一行到 `run/fast-abort.log`。
# 判据、夹具、产物路径、结果表格式与主跑完全一致（结果仍写同一份 `run/results.tsv`）。
#
# 对比口径：同一分组分别用「开 FAST」与「不开 FAST」各跑一次，逐条比对 `results.tsv` ——
# 判定必须一致，只允许耗时不同。出现差异时以**未开 FAST** 的那次为准，并把该条当作
# 判定源缺陷去修判据，不允许用快速档的结果覆盖默认档的结论。
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export ACCEPT_FAST=1
exec bash "$HERE/acceptance558.sh" "$@"
