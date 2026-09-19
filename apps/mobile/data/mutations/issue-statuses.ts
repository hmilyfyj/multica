/**
 * Issue-status catalog mutations (MUL-6243). Every write is owner/admin only
 * server-side — the handler re-checks the role and answers 403 — so the
 * settings screen gates its controls on the same rule rather than letting a
 * plain member discover it through a failed request.
 *
 * Cache shape: `issueStatusListOptions` resolves to a flat
 * `IssueStatusEntry[]` (archived rows included, see `api.listIssueStatuses`)
 * at `issueStatusKeys.list(wsId)`. Each success patches that one array and
 * every settle invalidates it, so a response that drifts from the local guess
 * self-corrects on the next read.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateIssueStatusRequest,
  IssueStatusCategory,
  IssueStatusEntry,
  UpdateIssueStatusRequest,
} from "@multica/core/types";
import { z } from "zod";
import { ApiError, api } from "@/data/api";
import { issueStatusKeys } from "@/data/queries/issue-statuses";
import { useWorkspaceStore } from "@/data/workspace-store";
import { compareIssueStatusEntries } from "@/lib/issue-status";

/**
 * Insert or replace one entry in the cached catalog, then restore display
 * order. A create appended at the end would otherwise render below entries of
 * a later category until the settle-time refetch lands.
 */
function upsertEntry(
  entries: IssueStatusEntry[] | undefined,
  next: IssueStatusEntry,
): IssueStatusEntry[] | undefined {
  if (!entries) return entries;
  const merged = entries.some((entry) => entry.id === next.id)
    ? entries.map((entry) => (entry.id === next.id ? next : entry))
    : [...entries, next];
  return merged.sort(compareIssueStatusEntries);
}

/** Invalidate the one catalog key every mutation here writes. */
function useInvalidateCatalog() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return () => {
    qc.invalidateQueries({ queryKey: issueStatusKeys.list(wsId) });
  };
}

export function useCreateIssueStatus() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const invalidate = useInvalidateCatalog();

  return useMutation({
    mutationFn: (body: CreateIssueStatusRequest) => api.createIssueStatus(body),
    onSuccess: (entry) => {
      // A malformed 2xx parses to the empty entry; writing that would add a
      // nameless row the settle-time refetch then has to remove.
      if (!entry.id) return;
      qc.setQueryData<IssueStatusEntry[]>(issueStatusKeys.list(wsId), (old) =>
        upsertEntry(old, entry),
      );
    },
    onSettled: invalidate,
  });
}

export function useUpdateIssueStatus() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const invalidate = useInvalidateCatalog();

  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: UpdateIssueStatusRequest;
    }) => api.updateIssueStatus(id, body),
    onSuccess: (entry) => {
      if (!entry.id) return;
      qc.setQueryData<IssueStatusEntry[]>(issueStatusKeys.list(wsId), (old) =>
        upsertEntry(old, entry),
      );
    },
    onSettled: invalidate,
  });
}

/**
 * Archive a custom status — terminal, the server has no restore.
 *
 * Not optimistic: the 409 "issues still use this status" answer is the whole
 * point of the confirm step, and a row that vanished before the server agreed
 * would have to be put back to show it.
 */
export function useArchiveIssueStatus() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const invalidate = useInvalidateCatalog();

  return useMutation({
    mutationFn: (id: string) => api.archiveIssueStatus(id),
    onSuccess: (entry) => {
      if (!entry.id) return;
      qc.setQueryData<IssueStatusEntry[]>(issueStatusKeys.list(wsId), (old) =>
        upsertEntry(old, entry),
      );
    },
    onSettled: invalidate,
  });
}

/**
 * Rewrite one category's order.
 *
 * `include_system` is always true: the settings list renders built-ins in the
 * same section as custom rows, so a move has to be able to cross one. Web
 * passes true for the same reason.
 */
export function useReorderIssueStatuses() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const invalidate = useInvalidateCatalog();

  return useMutation({
    mutationFn: ({
      category,
      ids,
    }: {
      category: IssueStatusCategory;
      ids: string[];
    }) => api.reorderIssueStatuses(category, ids, true),
    onSuccess: (response) => {
      // The reorder response IS the full catalog, so it replaces the cache
      // outright — no local re-derivation of the new positions.
      if (!response.statuses.length) return;
      qc.setQueryData<IssueStatusEntry[]>(
        issueStatusKeys.list(wsId),
        response.statuses,
      );
    },
    onSettled: invalidate,
  });
}

const inUseErrorSchema = z.object({
  code: z.literal("issue_status_in_use"),
  issue_count: z.number().int().positive(),
});

/**
 * The "N issues still use this status" count from an archive refusal, or null
 * when the failure is anything else — so the caller falls back to the generic
 * failure copy instead of quoting a number it made up. Mirrors core's
 * `issueStatusArchiveConflictCount` (packages/core/issue-statuses/archive.ts)
 * against mobile's own ApiError.
 */
export function issueStatusArchiveConflictCount(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const parsed = inUseErrorSchema.safeParse(error.body);
  return parsed.success ? parsed.data.issue_count : null;
}
