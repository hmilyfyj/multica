/**
 * Run-transcript data for one task: the persisted timeline plus the live
 * `task:message` frames that extend it.
 *
 * Two gaps this closes for issue runs (chat already had its own path):
 *
 *   1. **Realtime** — `use-chat-session-realtime` gates `task:message` on
 *      `chat_session_id`, so an issue-triggered run's frames are dropped
 *      today. The WS has no per-event server subscription (only an `auth`
 *      frame), so subscribing means registering a handler here — the
 *      record-scoped subscription `apps/mobile/AGENTS.md` asks for.
 *   2. **Catch-up** — `taskMessagesOptions` is `staleTime: Infinity`, so a
 *      warm cache would never re-read the server. This hook refetches on
 *      mount (a live run's tail may have landed while no surface was open)
 *      and on reconnect; `unionTaskMessagesBySeq` (the options'
 *      `structuralSharing`) merges the response with whatever the socket
 *      already appended instead of replacing it.
 *
 * `isStreaming` stays the caller's business: only it knows whether the task
 * is still active (`lib/agent-runs.ts` `isActiveTask`).
 */
import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { chatKeys, taskMessagesOptions } from "@/data/queries/chat";
import { appendTaskMessage } from "@/data/realtime/chat-ws-updaters";
import { useWSSubscriptions } from "@/lib/use-ws-subscriptions";
import { buildRunTranscript } from "@/lib/run-transcript";

export function useRunTranscript(taskId: string | null | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    ...taskMessagesOptions(taskId),
    // Ahead of the shared `staleTime: Infinity` on purpose; see the header.
    refetchOnMount: "always",
  });

  useWSSubscriptions(
    (ws) =>
      taskId
        ? [
            ws.on("task:message", (payload) => {
              // Every client in the workspace receives every run's frames.
              if (payload.task_id !== taskId) return;
              appendTaskMessage(queryClient, payload);
            }),
            // No replay buffer: refetch the authoritative list after a gap.
            ws.onReconnect(() => {
              void queryClient.invalidateQueries({
                queryKey: chatKeys.taskMessages(taskId),
              });
            }),
          ]
        : [],
    [taskId, queryClient],
  );

  const messages = query.data;
  const entries = useMemo(
    () => buildRunTranscript(messages ?? []),
    [messages],
  );

  return {
    entries,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
