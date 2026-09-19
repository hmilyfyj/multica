/**
 * Mobile inbox mutations. Mirrors the optimistic-update + invalidate pattern
 * of packages/core/inbox/mutations.ts — written here in mobile-owned code
 * per Sharing Principles (no runtime imports from @multica/core mutations).
 *
 * Behavioral parity:
 *   - mark-read: flip `read` to true locally; rollback on error; settle invalidate.
 *     `onMutate` writes setQueryData BEFORE awaiting cancelQueries — this is
 *     load-bearing for iOS Stack push transitions: when the user taps an
 *     inbox row and we router.push to issue/[id], iOS captures a snapshot of
 *     the source view for the slide animation; if the read-state flip hadn't
 *     landed in cache by that snapshot, the row appears unread frozen in
 *     the animation. Synchronous setQueryData ensures the next paint already
 *     has the flipped state. (Previously the caller did this hack at tap
 *     site; moved into the mutation so every caller benefits.)
 *   - mark-unread: the reverse flip on the same row, plus every archived page
 *     that holds it. `read` and `archived` are orthogonal fields (an archived
 *     row keeps its real read state so a restore brings it back), so the
 *     archived list has to be patched too even though the row on screen is the
 *     main one.
 *   - archive single: flip `archived` to true on the item AND on every other
 *     inbox row that shares the same `issue_id` (web does the same — see
 *     packages/core/inbox/mutations.ts:37-46). Visually the row disappears
 *     because `deduplicateInboxItems` (apps/mobile/lib/inbox-display.ts)
 *     filters archived items out before render.
 *   - unarchive: flip `archived` to false on the item AND on every sibling row
 *     sharing its `issue_id` (the endpoint unarchives by issue —
 *     `UnarchiveInboxByIssue`). Same group rule as archive, mirrored.
 *   - mark-all-read: flip `read` to true on every non-archived row (matches
 *     web; the server-side query does the same predicate).
 *   - archive batch (all / all-read / completed): no optimistic patch — the
 *     row predicates depend on server-side state (e.g. issue.status="done"
 *     isn't carried on every row, and mobile shouldn't re-derive the filter).
 *     Just invalidate on settle. Matches web.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { InboxItem } from "@multica/core/types";
import { api } from "@/data/api";
import {
  inboxKeys,
  isArchivedPagesCache,
  patchArchivedInboxCaches,
  restoreArchivedInboxCaches,
} from "@/data/queries/inbox";
import {
  refreshInboxList,
  refreshInboxUnreadSummary,
} from "@/data/realtime/inbox-ws-updaters";
import { useWorkspaceStore } from "@/data/workspace-store";

/**
 * Re-read both inbox caches a write can change: the workspace list and the
 * cross-workspace unread summary that backs the tab badge. The summary lives
 * under its own account-level key, so refreshing the list does not reach it —
 * every mutation here can change the number it holds.
 *
 * Deliberately the shared entry points rather than local copies: a mutation
 * racing a first load hits exactly the same in-flight hole a WS event does,
 * and a plain invalidate of the list would let it fall behind the badge.
 * Not awaited by `onSettled` — the mutation is done once the server answers.
 *
 * Rows are optimistic, the badge is not: it follows the server's confirmation.
 * Mirrors the same decision in packages/core/inbox/mutations.ts, whose comment
 * carries the reasoning — recomputing the count from the list cache and
 * writing it back cannot be made correct once the list is paginated, and races
 * an in-flight summary response that no `cancelQueries` here covers.
 */
function refreshInboxAfterWrite(qc: QueryClient, wsId: string | null) {
  if (wsId) void refreshInboxList(qc, wsId);
  void refreshInboxUnreadSummary(qc);
}

export function useMarkInboxRead() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (id: string) => api.markInboxRead(id),
    onMutate: async (id) => {
      const key = inboxKeys.list(wsId);
      // Synchronous patch FIRST — see the file-level doc comment for why.
      qc.setQueryData<InboxItem[]>(key, (old) =>
        old?.map((item) => (item.id === id ? { ...item, read: true } : item)),
      );
      // Then the standard cancel + snapshot dance for rollback.
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<InboxItem[]>(key);
      return { prev, key };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: () => {
      refreshInboxAfterWrite(qc, wsId);
    },
  });
}

/**
 * The other half of the read/unread pair web's row menu offers.
 *
 * No synchronous-patch-first trick here (unlike useMarkInboxRead): that exists
 * for the iOS push snapshot, and this action never runs on the way into a
 * transition. Both lists are cancelled and patched — web cancels the whole
 * `inboxKeys.all` prefix for the same reason: the badge is about to rise again,
 * and an archived row that gets restored must come back unread.
 */
export function useMarkInboxUnread() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (id: string) => api.markInboxUnread(id),
    onMutate: async (id) => {
      const key = inboxKeys.list(wsId);
      await qc.cancelQueries({ queryKey: inboxKeys.all(wsId) });
      const prev = qc.getQueryData<InboxItem[]>(key);
      const markUnread = (items: InboxItem[]) =>
        items.map((item) => (item.id === id ? { ...item, read: false } : item));
      qc.setQueryData<InboxItem[]>(key, (old) => old && markUnread(old));
      const prevArchived = patchArchivedInboxCaches(qc, wsId, markUnread);
      return { prev, key, prevArchived };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
      if (ctx?.prevArchived) restoreArchivedInboxCaches(qc, ctx.prevArchived);
    },
    onSettled: () => {
      refreshInboxAfterWrite(qc, wsId);
    },
  });
}

export function useArchiveInbox() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (id: string) => api.archiveInbox(id),
    onMutate: async (id) => {
      const key = inboxKeys.list(wsId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<InboxItem[]>(key);
      // Match web: archive every row that shares the same issue_id — the
      // single archive endpoint archives all sibling rows server-side too
      // (`server/internal/queries/inbox.sql` UPDATE … WHERE issue_id = ?).
      // Patching only the tapped row would let dedup'd siblings briefly
      // resurface between the request and the WS invalidate.
      const target = prev?.find((i) => i.id === id);
      const issueId = target?.issue_id ?? null;
      qc.setQueryData<InboxItem[]>(key, (old) =>
        old?.map((item) =>
          item.id === id || (issueId && item.issue_id === issueId)
            ? { ...item, archived: true }
            : item,
        ),
      );
      return { prev, key };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: () => {
      refreshInboxAfterWrite(qc, wsId);
    },
  });
}

/**
 * The archived view's row action: restore a row — and its issue's siblings —
 * to whichever list the issue belongs in.
 *
 * The optimistic patch removes them from the archived pages, which is what
 * makes the row leave the archived list on the next render
 * (`deduplicateArchivedInboxItems` keeps only `archived` rows).
 *
 * The main list is deliberately NOT patched: the server decides which list an
 * issue belongs to (an issue with an active row is not in the archive), so
 * adding a row back locally could contradict the next fetch. It appears when
 * `refreshInboxAfterWrite` settles.
 */
export function useUnarchiveInbox() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (id: string) => api.unarchiveInbox(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: inboxKeys.all(wsId) });
      // Resolve the group once, across every loaded page: sibling rows of the
      // same issue move with the tapped one.
      let issueId: string | null | undefined;
      for (const [, data] of qc.getQueriesData<unknown>({
        queryKey: inboxKeys.archived(wsId),
      })) {
        if (!isArchivedPagesCache(data)) continue;
        for (const page of data.pages) {
          issueId ??= page.items.find((item) => item.id === id)?.issue_id;
        }
      }
      const prevArchived = patchArchivedInboxCaches(qc, wsId, (items) =>
        items.map((item) =>
          item.id === id || (issueId && item.issue_id === issueId)
            ? { ...item, archived: false }
            : item,
        ),
      );
      return { prevArchived };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prevArchived) restoreArchivedInboxCaches(qc, ctx.prevArchived);
    },
    onSettled: () => {
      refreshInboxAfterWrite(qc, wsId);
    },
  });
}

export function useMarkAllInboxRead() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: () => api.markAllInboxRead(),
    onMutate: async () => {
      const key = inboxKeys.list(wsId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<InboxItem[]>(key);
      qc.setQueryData<InboxItem[]>(key, (old) =>
        old?.map((item) =>
          !item.archived ? { ...item, read: true } : item,
        ),
      );
      return { prev, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: () => {
      refreshInboxAfterWrite(qc, wsId);
    },
  });
}

// Batch archive mutations — invalidate-only, matching web. The optimistic
// path isn't worth the complexity: archive-completed depends on the issue
// status of each linked issue (not carried on InboxItem), and predicting
// that on the client risks divergence with the server's SQL filter. The badge
// therefore catches up on settle rather than moving instantly.
export function useArchiveAllInbox() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return useMutation({
    mutationFn: () => api.archiveAllInbox(),
    onSettled: () => {
      refreshInboxAfterWrite(qc, wsId);
    },
  });
}

export function useArchiveAllReadInbox() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return useMutation({
    mutationFn: () => api.archiveAllReadInbox(),
    onSettled: () => {
      refreshInboxAfterWrite(qc, wsId);
    },
  });
}

export function useArchiveCompletedInbox() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return useMutation({
    mutationFn: () => api.archiveCompletedInbox(),
    onSettled: () => {
      refreshInboxAfterWrite(qc, wsId);
    },
  });
}
