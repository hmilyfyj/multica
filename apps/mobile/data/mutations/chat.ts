/**
 * Mobile chat mutations — create session, rename session, delete session,
 * mark session read, cancel a running task.
 *
 * Send-message is NOT a mutation: the chat screen runs a hand-written
 * optimistic burst (seed messages cache → seed pendingTask cache → flip
 * activeSession → POST → patch with real task_id) that doesn't map cleanly
 * onto useMutation. See the chat tab screen for the send path.
 *
 * Mirrors the optimistic-update + rollback + onSettled-invalidate pattern
 * of data/mutations/inbox.ts and web's packages/core/chat/mutations.ts.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { removePendingChatTask } from "@multica/core/chat/pending";
import type {
  CancelTaskResponse,
  ChatMessage,
  ChatPendingTask,
  ChatSession,
} from "@multica/core/types";
import { api } from "@/data/api";
import { useWorkspaceStore } from "@/data/workspace-store";
import { chatKeys } from "@/data/queries/chat";

export function useCreateChatSession() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (data: { agent_id: string; title?: string }) =>
      api.createChatSession(data),
    onSettled: () => {
      // Optimistic prepend isn't done here — the chat screen seeds caches
      // synchronously around its send burst and uses the returned session
      // id directly. The invalidate ensures the dropdown picks up the new
      // row (and any has_unread / title server defaults) without a refetch
      // race on switch.
      qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });
    },
  });
}

export function useDeleteChatSession() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (id: string) => api.deleteChatSession(id),
    onMutate: async (id) => {
      const key = chatKeys.sessions(wsId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ChatSession[]>(key);
      qc.setQueryData<ChatSession[]>(key, (old) =>
        old ? old.filter((s) => s.id !== id) : old,
      );
      return { prev, key };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: (_data, _err, id) => {
      qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });
      // Detail-side caches the screen may still hold for this id.
      qc.removeQueries({ queryKey: chatKeys.messages(id) });
      qc.removeQueries({ queryKey: chatKeys.pendingTask(id) });
    },
  });
}

export function useMarkChatSessionRead() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (sessionId: string) => api.markChatSessionRead(sessionId),
    onMutate: async (sessionId) => {
      const key = chatKeys.sessions(wsId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ChatSession[]>(key);
      // Zero unread_count together with has_unread — the tab badge sums
      // unread_count (see lib/unread-counts.ts), so clearing only the flag
      // would leave a stale badge until the settle refetch. Mirrors web's
      // useMarkChatSessionRead in packages/core/chat/mutations.ts.
      qc.setQueryData<ChatSession[]>(key, (old) =>
        old?.map((s) =>
          s.id === sessionId
            ? { ...s, has_unread: false, unread_count: 0 }
            : s,
        ),
      );
      return { prev, key };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });
    },
  });
}

/**
 * Renames a chat session. Optimistically swaps the title in the cached list
 * so the sessions sheet and the chat header (both read that list) update in
 * place; rolls back on error. Mirrors web's `useUpdateChatSession` — same
 * optimistic patch, same settle-time invalidate, which is what lets another
 * device's rename land here through the `chat:session_updated` event.
 */
export function useRenameChatSession() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (data: { sessionId: string; title: string }) =>
      api.updateChatSession(data.sessionId, { title: data.title }),
    onMutate: async ({ sessionId, title }) => {
      const key = chatKeys.sessions(wsId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ChatSession[]>(key);
      qc.setQueryData<ChatSession[]>(key, (old) =>
        old?.map((s) => (s.id === sessionId ? { ...s, title } : s)),
      );
      return { prev, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });
    },
  });
}

/**
 * Stops a running chat task (the composer's Stop button).
 *
 * Web parity, from `use-chat-task-actions.ts#cancelChatTask` narrowed to the
 * active-input case mobile has:
 *   - the pending task is dropped optimistically, so the status line and the
 *     Stop button go away on the tap rather than a round trip later;
 *   - a cancelled turn that had produced no transcript comes back as
 *     `cancelled_chat_message`, and the user's message the server just deleted
 *     is pruned from the messages cache (it would otherwise flash back until
 *     the settle refetch);
 *   - a failure puts the snapshot back and refetches, so a task that was
 *     still running (or already finished) is what the server says it is.
 *
 * The restored draft itself is applied by the caller: it needs the composer's
 * per-session draft store, and a restore must not clobber text the user is
 * typing (web applies it only to an empty draft).
 */
export function useCancelChatTask() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (vars: { taskId: string; sessionId: string }) =>
      api.cancelChatTask(vars.taskId),
    onMutate: async ({ taskId, sessionId }) => {
      const pendingKey = chatKeys.pendingTask(sessionId);
      await qc.cancelQueries({ queryKey: pendingKey });
      const prev = qc.getQueryData<ChatPendingTask>(pendingKey);
      qc.setQueryData<ChatPendingTask>(pendingKey, (old) =>
        removePendingChatTask(old, taskId),
      );
      return { prev, pendingKey };
    },
    onSuccess: (result: CancelTaskResponse) => {
      const restored = result.cancelled_chat_message;
      if (!restored) return;
      const messagesKey = chatKeys.messages(restored.chat_session_id);
      qc.setQueryData<ChatMessage[]>(messagesKey, (old) =>
        old?.filter((m) => m.id !== restored.message_id),
      );
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.pendingKey, ctx.prev);
    },
    onSettled: (_data, _err, { sessionId }) => {
      qc.invalidateQueries({ queryKey: chatKeys.pendingTask(sessionId) });
      qc.invalidateQueries({ queryKey: chatKeys.messages(sessionId) });
    },
  });
}
