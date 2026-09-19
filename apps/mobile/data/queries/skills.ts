import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

/**
 * Skills caches (FEATURE-569). Keys nest under `["skills", wsId]`, the same
 * shape the other workspace catalogs use.
 *
 * No realtime subscription drives these: `skill:created / updated / deleted`
 * exist on the wire, but mobile has no skills subscriber, so freshness comes
 * from the QueryClient's AppState-focus refetch, reconnect and pull-to-refresh.
 * That mirrors the autopilot views, which have no event at all.
 */
export const skillKeys = {
  all: (wsId: string | null) => ["skills", wsId] as const,
  list: (wsId: string | null) => [...skillKeys.all(wsId), "list"] as const,
  detail: (wsId: string | null, skillId: string) =>
    [...skillKeys.all(wsId), "detail", skillId] as const,
};

export const skillListOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: skillKeys.list(wsId),
    queryFn: ({ signal }) => api.listSkills({ signal }),
    enabled: !!wsId,
  });

/**
 * One skill, `?include=metadata` — summary + SKILL.md size + file paths/sizes,
 * with no file body. The detail screen lists files read-only, so bodies would be
 * megabytes it immediately discards.
 */
export const skillDetailOptions = (wsId: string | null, skillId: string) =>
  queryOptions({
    queryKey: skillKeys.detail(wsId, skillId),
    queryFn: ({ signal }) => api.getSkill(skillId, { signal }),
    enabled: !!wsId && !!skillId,
  });
