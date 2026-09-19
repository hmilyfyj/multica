# 实施步骤

## 步骤

1. `apps/mobile/lib/chat-session-rename.ts`：`CHAT_SESSION_TITLE_MAX_LENGTH` +
   `resolveChatSessionRename(raw, currentTitle): string | null`（trim / 空值 / 与旧值相同 → null；
   超长按 200 截断）。先写 `lib/chat-session-rename.test.ts` 拿 RED，再实现拿 GREEN。
2. `apps/mobile/data/api.ts`（追加，放在 `// --- Chat ---` 段内）：
   - `cancelChatTask(taskId): Promise<CancelTaskResponse>`（`parseWithFallback` +
     `CancelTaskResponseSchema` / `EMPTY_CANCEL_TASK_RESPONSE`，从 `@multica/core/api/schemas` 引入）
   - `updateChatSession(id, { title }): Promise<void>`（`PATCH`）
   - `CancelTaskResponse` 加入 `import type { ... } from "@multica/core/types"` 列表。
3. `apps/mobile/data/mutations/chat.ts`（追加）：
   - `useCancelChatTask()`：乐观删 pendingTask → `api.cancelChatTask` → 成功时按
     `cancelled_chat_message.message_id` 过滤消息缓存 → 失败回写快照 → settle invalidate。
   - `useRenameChatSession()`：乐观改 `chatKeys.sessions` 标题 → `api.updateChatSession` →
     失败回滚 → settle invalidate。
4. `apps/mobile/data/mutations/chat.test.ts`（新增）：照 `data/mutations/labels.test.ts` 的
   harness（`vi.hoisted` + `MutationObserver` 假的 `useMutation`、mock `@/data/api` 与
   `@/data/workspace-store`）覆盖取消与改名的乐观 / 回滚 / 缓存清理。
5. `apps/mobile/app/(app)/[workspace]/(tabs)/chat.tsx`：`handleStop` 改用 `useCancelChatTask`，
   成功后按 `restore_to_input` + 空草稿回填草稿；失败静默。
6. `apps/mobile/app/(app)/[workspace]/chat-sessions.tsx`：行长按 → action sheet
   （Rename / Delete / Cancel）；Rename 就地 `TextInput` 编辑（autoFocus / 全选 / maxLength /
   submit+blur 提交、一次提交 ref 守卫）；Delete 保留原 Alert 确认。
7. 写回 spec：`.trellis/spec/mobile/frontend/android-platform.md` 追加「聊天停止任务与会话重命名」
   小节（`Alert.prompt` iOS 专有、能力头 + durable 回填的绑定关系、行内编辑的实现取值）。
8. `apps/mobile/app.config.ts`：`android.versionCode` 10 → 11（FEATURE-577 已占 vc10；侧载覆盖安装要求更高）。

## 验证

- 中途只跑改动直接相关的单测（RED → GREEN 证据）：
  `rtk test -- corepack pnpm exec vitest run --config apps/mobile/vitest.config.ts apps/mobile/lib/chat-session-rename.test.ts apps/mobile/data/mutations/chat.test.ts`
- 收尾一次跑完整检查（code-helper 的 rtk 形态）：
  `rtk err -- corepack pnpm --filter @multica/mobile typecheck`、
  `rtk err -- corepack pnpm --filter @multica/mobile lint`、
  `rtk test -- corepack pnpm --filter @multica/mobile test`
- 不启模拟器；真机验收由用户执行。
- APK（arm64-v8a，production，后端 `https://fengit-multica.frp.tbxzs.net`）：
  `EXPO_PUBLIC_API_URL=... APP_ENV=production pnpm exec expo prebuild -p android --no-install`
  → `(cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a)`
  → 产物发 GitHub Release（tag `android-v0.1.1-vc11-chat-stop-rename`）。

## 回滚

见 design.md「回滚」；本分支 squash 合并后 `git revert <sha>` 即可。
