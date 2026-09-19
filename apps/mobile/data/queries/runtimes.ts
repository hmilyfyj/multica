import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

/**
 * Runtimes key factory. `all` is the workspace roster the presence dot reads
 * (`@multica/core/agents/derive-presence` over status + last_seen_at);
 * `data/realtime/use-presence-realtime.ts` invalidates that key on
 * daemon:register and on sweeper-driven status changes, and its prefix match
 * covers nothing extra because only the roster lives under it (see
 * `runtimeUsageKeys` for why usage is deliberately elsewhere).
 */
export const runtimeKeys = {
  all: (wsId: string | null) => ["runtimes", wsId] as const,
};

export const runtimeListOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: runtimeKeys.all(wsId),
    queryFn: ({ signal }) => api.listRuntimes({ signal }),
    enabled: !!wsId,
  });

/**
 * Runtime usage lives under its own root rather than under `["runtimes", wsId]`.
 * The presence invalidator refetches that prefix on every `daemon:*` heartbeat,
 * and a usage rollup cannot change because a runtime went online — nesting it
 * there would buy one extra request per heartbeat per open detail screen.
 *
 * No `refetchInterval`: daily buckets only move when a task finishes, and the
 * QueryClient's AppState-focus refetch, reconnect and pull-to-refresh already
 * cover that (the same freshness model the autopilot views use).
 */
export const runtimeUsageKeys = {
  all: (wsId: string | null) => ["runtime-usage", wsId] as const,
  detail: (wsId: string | null, runtimeId: string, days: number) =>
    [...runtimeUsageKeys.all(wsId), runtimeId, days] as const,
};

export const runtimeUsageOptions = (
  wsId: string | null,
  runtimeId: string,
  days: number,
) =>
  queryOptions({
    queryKey: runtimeUsageKeys.detail(wsId, runtimeId, days),
    queryFn: ({ signal }) =>
      api.getRuntimeUsage(runtimeId, { days }, { signal }),
    enabled: !!wsId && !!runtimeId,
  });
