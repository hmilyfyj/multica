/**
 * Chat query keys + queryOptions factories.
 *
 * Keys:
 *   - sessions(wsId)        → ChatSession[] for the workspace dropdown / sheet
 *   - messages(sessionId)   → ChatMessage[] for the active session
 *   - pendingTask(sessionId)→ ChatPendingTask, populated when an agent task is
 *                             in flight; refreshed on terminal task events
 *
 * Same shape as web's `chatKeys` in packages/core/chat/queries.ts (mobile
 * owns its own copy per the "mirror, don't import" rule in apps/mobile/CLAUDE.md).
 *
 * `staleTime: Infinity` everywhere — caches are kept fresh by WS event
 * handlers, not by background refetch. Foreground / reconnect invalidates
 * are scoped to each owning hook (see use-chat-sessions-realtime.ts and
 * use-chat-session-realtime.ts).
 */
import { queryOptions } from "@tanstack/react-query";
import type { TaskMessagePayload } from "@multica/core/types";
import { api } from "@/data/api";

export const chatKeys = {
  all: (wsId: string | null) => ["chat", wsId] as const,
  sessions: (wsId: string | null) =>
    [...chatKeys.all(wsId), "sessions"] as const,
  messages: (sessionId: string) => ["chat", "messages", sessionId] as const,
  pendingTask: (sessionId: string) =>
    ["chat", "pending-task", sessionId] as const,
  /** Per-task live execution timeline (thinking / tool_use / tool_result /
   *  text / error rows). Cache is workspace-agnostic — keyed only on
   *  `taskId` — matching web's `chatKeys.taskMessages` shape so future
   *  cross-feature consumers (issue agent cards) can share the cache.
   *  `task:message` WS events append rows in place; once the task
   *  completes the cache stays warm so the persisted assistant message
   *  can render the same trace without refetching. */
  taskMessages: (taskId: string) => ["task-messages", taskId] as const,
};

// UUID gate mirrors `packages/core/chat/queries.ts`: optimistic task ids
// (`optimistic-…`) are not real backend rows, so the query must be
// disabled until we have a server-issued UUID. Returning the cache for
// an optimistic id would 404 the API.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTaskMessageTaskId(
  taskId: string | null | undefined,
): taskId is string {
  return typeof taskId === "string" && UUID_PATTERN.test(taskId);
}

/**
 * Union two task-message lists by `seq`, the authoritative (server) list
 * winning on conflict and rows it did not mention being kept.
 *
 * This is the rule every write to `["task-messages", taskId]` goes through,
 * wired in as `structuralSharing` below, because a fetch result and the
 * realtime stream race: the timeline is fetched on first open and any
 * `task:message` frame arriving while that request is in flight is written to
 * the cache first. A plain replace would drop those seqs, and with
 * `staleTime: Infinity` nothing would ever fetch them back — the gap would
 * survive until a reload.
 *
 * Server data wins on conflict (the persisted row is the authority); a
 * response snapshotted before a seq was persisted must not erase it. Mirrors
 * `unionTaskMessagesBySeq` in `packages/core/chat/queries.ts`. The existing
 * array reference is returned unchanged when nothing differs, so a duplicate
 * event does not re-render every subscriber.
 */
export function unionTaskMessagesBySeq(
  existing: readonly TaskMessagePayload[] | undefined,
  incoming: readonly TaskMessagePayload[],
): TaskMessagePayload[] {
  if (!existing || existing.length === 0) {
    return [...incoming].sort((a, b) => a.seq - b.seq);
  }

  const bySeq = new Map(existing.map((message) => [message.seq, message]));
  let changed = false;
  for (const message of incoming) {
    if (bySeq.get(message.seq) !== message) {
      bySeq.set(message.seq, message);
      changed = true;
    }
  }
  if (!changed) return existing as TaskMessagePayload[];
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

export const chatSessionsOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: chatKeys.sessions(wsId),
    queryFn: ({ signal }) => api.listChatSessions({ signal }),
    enabled: !!wsId,
    staleTime: Infinity,
  });

export const chatMessagesOptions = (sessionId: string | null) =>
  queryOptions({
    queryKey: chatKeys.messages(sessionId ?? ""),
    queryFn: ({ signal }) => api.listChatMessages(sessionId!, { signal }),
    enabled: !!sessionId,
    staleTime: Infinity,
  });

export const pendingChatTaskOptions = (sessionId: string | null) =>
  queryOptions({
    queryKey: chatKeys.pendingTask(sessionId ?? ""),
    queryFn: ({ signal }) => api.getPendingChatTask(sessionId!, { signal }),
    enabled: !!sessionId,
    staleTime: Infinity,
  });

export const taskMessagesOptions = (taskId: string | null | undefined) =>
  queryOptions({
    queryKey: chatKeys.taskMessages(taskId ?? ""),
    queryFn: ({ signal }) => api.listTaskMessages(taskId!, { signal }),
    enabled: isTaskMessageTaskId(taskId),
    staleTime: Infinity,
    // A WS frame can land while the first fetch is in flight; the union keeps
    // both instead of letting the response replace the cache (see
    // `unionTaskMessagesBySeq`).
    structuralSharing: (previous, next) =>
      unionTaskMessagesBySeq(
        previous as TaskMessagePayload[] | undefined,
        next as TaskMessagePayload[],
      ),
  });
