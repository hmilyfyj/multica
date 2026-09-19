/**
 * Mobile-side label mutations. Mirrors the design of
 * `packages/core/labels/mutations.ts` but binds to mobile's own ApiClient
 * (`@/data/api`) and workspace store — the core hook depends on
 * `useWorkspaceId` from `packages/core/hooks` which mobile does not share.
 *
 * Cache shape: `labelListOptions` resolves to a flat `Label[]` at
 * `labelKeys.list(wsId, resourceType)` — the response envelope is unwrapped
 * in the query function, so every patch below matches that flat array.
 *
 * `useCreateLabel` keeps its exact call signature for the label picker's
 * inline create-and-attach (which only ever touches the issue catalog);
 * the settings screen reaches the other catalog by sending `resource_type`
 * in the create body, and the appended cache key follows the SERVER's
 * answer rather than the request.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateLabelRequest,
  Label,
  LabelResourceType,
  UpdateLabelRequest,
} from "@multica/core/types";
import { api } from "@/data/api";
import { issueKeys } from "@/data/queries/issue-keys";
import { labelKeys } from "@/data/queries/labels";
import { useWorkspaceStore } from "@/data/workspace-store";

/** The catalog a label lives in. The server always echoes `resource_type`;
 *  the fallback only covers a body that predates the field. */
function catalogOf(label: Label): LabelResourceType {
  return label.resource_type ?? "issue";
}

export function useCreateLabel() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (body: CreateLabelRequest) => api.createLabel(body),
    onSuccess: (label) => {
      const key = labelKeys.list(wsId, catalogOf(label));
      // Only patch a catalog that is actually in the cache. Seeding an
      // unfetched one would show a one-row catalog until its first fetch
      // resolves, which reads as "the other labels vanished".
      if (qc.getQueryData(key) === undefined) return;
      qc.setQueryData<Label[]>(key, (old) =>
        old && !old.some((l) => l.id === label.id) ? [...old, label] : old,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: labelKeys.all(wsId) });
    },
  });
}

/**
 * Rename / recolour / re-describe a label.
 *
 * The optimistic patch is applied to EVERY cached catalog for the workspace
 * (`setQueriesData` over the prefix) because the caller does not have to say
 * which list a row came from. The server's response is deliberately NOT
 * written back: `PUT /api/labels/{id}` answers with `usage_count: 0`
 * (the single-row serializer does not compute it), so writing it would drop
 * the "used by N" figure until the settle-time refetch lands. Core's
 * mutation makes the same choice.
 */
export function useUpdateLabel() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateLabelRequest }) =>
      api.updateLabel(id, body),
    onMutate: ({ id, body }) => {
      const previous = qc.getQueriesData<Label[]>({
        queryKey: labelKeys.all(wsId),
      });
      qc.setQueriesData<Label[]>({ queryKey: labelKeys.all(wsId) }, (old) =>
        old?.map((l) => (l.id === id ? { ...l, ...body } : l)),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      for (const [key, data] of context?.previous ?? []) {
        qc.setQueryData(key, data);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: labelKeys.all(wsId) });
      // Issue rows carry a snapshot of their labels, so a rename has to
      // reach them too — same derivative invalidation core performs.
      qc.invalidateQueries({ queryKey: issueKeys.all(wsId) });
    },
  });
}

/**
 * Delete a label. The server clears its issue/agent/skill links inside the
 * same transaction, so there is nothing to repair client-side beyond
 * dropping the rows and refreshing the issue snapshots that embedded them.
 */
export function useDeleteLabel() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (id: string) => api.deleteLabel(id),
    onMutate: (id) => {
      const previous = qc.getQueriesData<Label[]>({
        queryKey: labelKeys.all(wsId),
      });
      qc.setQueriesData<Label[]>({ queryKey: labelKeys.all(wsId) }, (old) =>
        old?.filter((l) => l.id !== id),
      );
      return { previous };
    },
    onError: (_error, _id, context) => {
      for (const [key, data] of context?.previous ?? []) {
        qc.setQueryData(key, data);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: labelKeys.all(wsId) });
      qc.invalidateQueries({ queryKey: issueKeys.all(wsId) });
    },
  });
}
