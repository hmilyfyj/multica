import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

export const appConfigOptions = () =>
  queryOptions({
    queryKey: ["config"] as const,
    queryFn: ({ signal }) => api.getConfig({ signal }),
    staleTime: 5 * 60 * 1000,
  });

// Mirrors packages/core/billing/workspace-subscription-queries.ts. The route
// resolves the workspace from X-Workspace-Slug, while the cache key prevents a
// summary from one workspace being rendered after a mobile workspace switch.
// Every entitlement read shares this prefix, so one `all` invalidation covers
// the summary and both quota rows the Billing page shows together.
export const workspaceSubscriptionKeys = {
  all: (wsId: string | null) => ["workspace-subscriptions", wsId] as const,
  summary: (wsId: string | null) =>
    [...workspaceSubscriptionKeys.all(wsId), "summary"] as const,
  issueLimitUsage: (wsId: string | null) =>
    [...workspaceSubscriptionKeys.all(wsId), "issue-limit-usage"] as const,
  autopilotQuotaUsage: (wsId: string | null) =>
    [...workspaceSubscriptionKeys.all(wsId), "autopilot-quota-usage"] as const,
};

export const workspaceSubscriptionSummaryOptions = (
  wsId: string | null,
  enabled: boolean,
) =>
  queryOptions({
    queryKey: workspaceSubscriptionKeys.summary(wsId),
    queryFn: ({ signal }) => api.getWorkspaceSubscriptionSummary({ signal }),
    enabled: !!wsId && enabled,
    // Recovery actions are Cloud-authoritative and may change immediately
    // after an upgrade, so opening a notice must revalidate this summary.
    staleTime: 0,
    retry: false,
  });

/**
 * Issue-count quota usage for the current billing period
 * (`GET /api/issues/limit-usage`; null when the server has nothing to report).
 *
 * `enabled` gates on the billing feature flag the caller already resolved —
 * both quota rows live on the same page and neither may fire when the
 * workspace has no subscription surface.
 */
export const issueLimitUsageOptions = (
  wsId: string | null,
  enabled: boolean,
) =>
  queryOptions({
    queryKey: workspaceSubscriptionKeys.issueLimitUsage(wsId),
    queryFn: ({ signal }) => api.getIssueLimitUsage({ signal }),
    enabled: !!wsId && enabled,
    staleTime: 30 * 1000,
    retry: false,
  });

/**
 * Autopilot-run quota for the current period (`GET /api/autopilots/usage`).
 * Every field is nullable — the server reports an unusable snapshot as nulls
 * rather than failing, and the page renders that as "usage unavailable" with a
 * retry instead of inventing a number.
 */
export const autopilotQuotaUsageOptions = (
  wsId: string | null,
  enabled: boolean,
) =>
  queryOptions({
    queryKey: workspaceSubscriptionKeys.autopilotQuotaUsage(wsId),
    queryFn: ({ signal }) => api.getAutopilotQuotaUsage({ signal }),
    enabled: !!wsId && enabled,
    staleTime: 30 * 1000,
    retry: false,
  });
