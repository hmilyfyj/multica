# FEATURE-542 Android 环境探针：prebuild 与首跑可行性报告

## Goal

在 Android 模拟器上实测 `expo prebuild -p android` + `expo run:android`，逐页走一遍主流程，
用实测结果替换此前基于代码静态分析的可行性估算，产出 `apps/mobile/docs/android-probe.md`。

本轮只定位问题，不修问题；除为跑通探针所需的最小配置外不改业务代码。

## Requirements

- 在 `apps/mobile` 执行 `npx expo prebuild -p android` 与 `npx expo run:android`，记录 Android SDK / JDK
  版本、实际命令与成败。
- 用模拟器或真机走主流程：登录验证码 → 工作区选择 → 收件箱 → issue 详情 → 评论 → 聊天 → 项目 → 设置；
  逐页记录「能打开 / 报错 / 白屏 / 崩溃」并附报错原文。
- 阻塞项按「阻塞运行 / 影响体验 / 可忽略」分级，每条附最小复现。
- 原生模块实测：markdown 渲染、代码高亮（shiki）、SegmentedControl、OTP 输入、图片选择器、formSheet。
- 对照结论：列出被实测推翻或修正的既有估算条目。
- 不删除 iOS 侧代码；`android/` 生成物不提交。

## Acceptance Criteria

- [x] `apps/mobile/docs/android-probe.md` 存在，每条结论都能对应到命令输出或截图文件名
- [x] 阻塞项清单可直接转成后续任务的输入（每条含分级、现象、最小复现、疑似原因）
- [x] 原生模块逐项有实测结论（可用 / 异常 / 未验证 + 原因）
- [x] 文档记录本轮为跑通探针所做的最小配置改动，以及是否回滚

## Notes

- 主流程依赖后端：本轮用本机隔离的 self-host 后端（独立 compose project，避免与 operator 生产栈冲突）+
  `MULTICA_DEV_VERIFICATION_CODE` 固定验证码，保证登录步骤可复现。
- 本地验证与真机验收分开描述；模拟器结论不冒充真机结论。
