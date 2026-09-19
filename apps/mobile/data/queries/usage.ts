import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

/**
 * Workspace dashboard rollups — the Analytics (Usage / Errors) screen's reads.
 *
 * Mirrors `packages/core/dashboard/queries.ts` (six `GET /api/dashboard/*`
 * endpoints) onto mobile's own client. Core's factories cannot be reused here:
 * `@multica/core/dashboard` imports the browser ApiClient (`document.cookie`),
 * which the apps/mobile/AGENTS.md sharing rule excludes.
 *
 * Every key carries `wsId` (the route resolves the workspace from
 * X-Workspace-Slug, so the same URL returns different data per workspace), the
 * window `days`, and `tz` — the server slices day buckets in the viewer's
 * calendar, so a timezone change must repoint the cache rather than re-render
 * stale buckets under a new header.
 *
 * The server materializes these rollups on a 5-minute cadence, so a mounted
 * screen re-polls on that same cadence: polling faster only re-reads an
 * unchanged rollup. The short staleTime keeps re-entering the screen honest
 * (anything older than a minute refetches on mount instead of waiting out the
 * interval). Neither fires for unmounted queries or a backgrounded app.
 */
const DASHBOARD_STALE_TIME = 60 * 1000;
const DASHBOARD_REFETCH_INTERVAL = 5 * 60 * 1000;

const DASHBOARD_LIFECYCLE = {
  staleTime: DASHBOARD_STALE_TIME,
  refetchInterval: DASHBOARD_REFETCH_INTERVAL,
} as const;

export const dashboardKeys = {
  all: (wsId: string | null) => ["dashboard", wsId] as const,
  usageDaily: (wsId: string | null, days: number, tz: string | null) =>
    [...dashboardKeys.all(wsId), "usage-daily", days, tz] as const,
  usageByAgent: (wsId: string | null, days: number, tz: string | null) =>
    [...dashboardKeys.all(wsId), "usage-by-agent", days, tz] as const,
  agentRunTime: (wsId: string | null, days: number, tz: string | null) =>
    [...dashboardKeys.all(wsId), "agent-run-time", days, tz] as const,
  runTimeDaily: (wsId: string | null, days: number, tz: string | null) =>
    [...dashboardKeys.all(wsId), "run-time-daily", days, tz] as const,
  failuresDaily: (wsId: string | null, days: number, tz: string | null) =>
    [...dashboardKeys.all(wsId), "failures-daily", days, tz] as const,
  failuresByAgent: (wsId: string | null, days: number, tz: string | null) =>
    [...dashboardKeys.all(wsId), "failures-by-agent", days, tz] as const,
};

// Each factory takes `enabled` so the screen can hold one tab's series back
// until that tab is on screen: six concurrent rollups on a phone is data the
// user cannot see yet. The keys stay stable across the gate, so flipping tabs
// reuses whatever is already cached.

export const dashboardUsageDailyOptions = (
  wsId: string | null,
  days: number,
  tz: string | null,
  enabled: boolean,
) =>
  queryOptions({
    queryKey: dashboardKeys.usageDaily(wsId, days, tz),
    queryFn: ({ signal }) =>
      api.getDashboardUsageDaily({ days, tz: tz ?? undefined }, { signal }),
    enabled: !!wsId && enabled,
    ...DASHBOARD_LIFECYCLE,
  });

export const dashboardUsageByAgentOptions = (
  wsId: string | null,
  days: number,
  tz: string | null,
  enabled: boolean,
) =>
  queryOptions({
    queryKey: dashboardKeys.usageByAgent(wsId, days, tz),
    queryFn: ({ signal }) =>
      api.getDashboardUsageByAgent({ days, tz: tz ?? undefined }, { signal }),
    enabled: !!wsId && enabled,
    ...DASHBOARD_LIFECYCLE,
  });

export const dashboardAgentRunTimeOptions = (
  wsId: string | null,
  days: number,
  tz: string | null,
  enabled: boolean,
) =>
  queryOptions({
    queryKey: dashboardKeys.agentRunTime(wsId, days, tz),
    queryFn: ({ signal }) =>
      api.getDashboardAgentRunTime({ days, tz: tz ?? undefined }, { signal }),
    enabled: !!wsId && enabled,
    ...DASHBOARD_LIFECYCLE,
  });

export const dashboardRunTimeDailyOptions = (
  wsId: string | null,
  days: number,
  tz: string | null,
  enabled: boolean,
) =>
  queryOptions({
    queryKey: dashboardKeys.runTimeDaily(wsId, days, tz),
    queryFn: ({ signal }) =>
      api.getDashboardRunTimeDaily({ days, tz: tz ?? undefined }, { signal }),
    enabled: !!wsId && enabled,
    ...DASHBOARD_LIFECYCLE,
  });

export const dashboardFailuresDailyOptions = (
  wsId: string | null,
  days: number,
  tz: string | null,
  enabled: boolean,
) =>
  queryOptions({
    queryKey: dashboardKeys.failuresDaily(wsId, days, tz),
    queryFn: ({ signal }) =>
      api.getDashboardFailuresDaily({ days, tz: tz ?? undefined }, { signal }),
    enabled: !!wsId && enabled,
    ...DASHBOARD_LIFECYCLE,
  });

export const dashboardFailuresByAgentOptions = (
  wsId: string | null,
  days: number,
  tz: string | null,
  enabled: boolean,
) =>
  queryOptions({
    queryKey: dashboardKeys.failuresByAgent(wsId, days, tz),
    queryFn: ({ signal }) =>
      api.getDashboardFailuresByAgent({ days, tz: tz ?? undefined }, { signal }),
    enabled: !!wsId && enabled,
    ...DASHBOARD_LIFECYCLE,
  });
