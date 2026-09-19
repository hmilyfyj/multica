import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

/**
 * Squads key factory. `all` is the workspace roster that the assignee / mention
 * / project-lead pickers and `useActorLookup` read; the detail and member
 * entries nest under it on purpose — `data/realtime/use-catalogs-realtime.ts`
 * invalidates this prefix on squad:created/updated, so an open squad detail and
 * its roster refresh with the list (a rename or a member change is exactly what
 * those screens show).
 */
export const squadKeys = {
  all: (wsId: string | null) => ["squads", wsId] as const,
  detail: (wsId: string | null, squadId: string) =>
    [...squadKeys.all(wsId), "detail", squadId] as const,
  members: (wsId: string | null, squadId: string) =>
    [...squadKeys.all(wsId), "members", squadId] as const,
};

export const squadListOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: squadKeys.all(wsId),
    queryFn: ({ signal }) => api.listSquads({ signal }),
    enabled: !!wsId,
  });

/** One squad, including its `instructions` — the list payload has no body. */
export const squadDetailOptions = (wsId: string | null, squadId: string) =>
  queryOptions({
    queryKey: squadKeys.detail(wsId, squadId),
    queryFn: ({ signal }) => api.getSquad(squadId, { signal }),
    enabled: !!wsId && !!squadId,
  });

/** The roster. Names are resolved from the workspace lists at render time. */
export const squadMembersOptions = (wsId: string | null, squadId: string) =>
  queryOptions({
    queryKey: squadKeys.members(wsId, squadId),
    queryFn: ({ signal }) => api.listSquadMembers(squadId, { signal }),
    enabled: !!wsId && !!squadId,
  });
