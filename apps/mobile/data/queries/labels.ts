/**
 * Workspace label catalogs — one per resource type (`issue` / `skill`).
 *
 * Workspace-scoped key — switching workspaces flips wsId and TanStack Query
 * picks up the new workspace's labels automatically. Key shape mirrors web's
 * `packages/core/labels/queries.ts` so the cross-platform mental model stays
 * the same.
 *
 * The resource type is part of the key because the two catalogs are
 * independent server-side (`GET /api/labels?resource_type=…`, defaulting to
 * `issue`). Keying on the workspace alone would serve the issue list to the
 * skill settings screen, and `all()` stays the prefix every label mutation
 * invalidates.
 */
import { queryOptions } from "@tanstack/react-query";
import type { LabelResourceType } from "@multica/core/types";
import { api } from "@/data/api";

export const labelKeys = {
  all: (wsId: string | null) => ["labels", wsId] as const,
  list: (wsId: string | null, resourceType: LabelResourceType) =>
    [...labelKeys.all(wsId), "list", resourceType] as const,
};

export const labelListOptions = (
  wsId: string | null,
  resourceType: LabelResourceType,
) =>
  queryOptions({
    queryKey: labelKeys.list(wsId, resourceType),
    queryFn: async ({ signal }) => {
      const res = await api.listLabels({ signal, resourceType });
      return res.labels;
    },
    enabled: !!wsId,
  });
