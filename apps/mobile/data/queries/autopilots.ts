import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

/**
 * Autopilot caches (FEATURE-567). Keys nest under `["autopilots", wsId]` so the
 * run-now mutation's single list-level invalidation also refreshes the detail
 * and run-history entries that one manual run changes.
 *
 * No `refetchInterval`: nothing here ages on its own the way agent presence
 * does, and mobile has no autopilot WS event to subscribe to (see
 * data/realtime/*). Freshness comes from the query client's AppState focus
 * refetch, reconnect, pull-to-refresh, and the run-now mutation's invalidation.
 */
export const autopilotKeys = {
  all: (wsId: string | null) => ["autopilots", wsId] as const,
  list: (wsId: string | null) => [...autopilotKeys.all(wsId), "list"] as const,
  detail: (wsId: string | null, id: string) =>
    [...autopilotKeys.all(wsId), "detail", id] as const,
  runs: (wsId: string | null, id: string) =>
    [...autopilotKeys.all(wsId), "runs", id] as const,
};

export const autopilotListOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: autopilotKeys.list(wsId),
    queryFn: ({ signal }) => api.listAutopilots({ signal }),
    enabled: !!wsId,
  });

export const autopilotDetailOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: autopilotKeys.detail(wsId, id),
    queryFn: ({ signal }) => api.getAutopilot(id, { signal }),
    enabled: !!wsId && !!id,
  });

export const autopilotRunsOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: autopilotKeys.runs(wsId, id),
    queryFn: ({ signal }) => api.listAutopilotRuns(id, { signal }),
    enabled: !!wsId && !!id,
  });
