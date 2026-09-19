import {
  infiniteQueryOptions,
  queryOptions,
} from "@tanstack/react-query";
import type {
  InfiniteData,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";
import type { ArchivedInboxPage, InboxItem } from "@multica/core/types";
import type { InboxFilters } from "@/lib/inbox-filters";
import { normalizeInboxFilters } from "@/lib/inbox-filters";
import { api } from "@/data/api";

/**
 * Inbox cache key factory.
 *
 * Shape mirrors web's `packages/core/inbox/queries.ts` — `["inbox", wsId, "list"]`
 * — so cross-platform mental model stays the same. Keying on wsId means
 * workspace switches naturally invalidate (TQ sees a new key and refetches).
 *
 * The archived sub-view hangs off the same prefix as the main list
 * (`["inbox", wsId, "archived", …]`), which is what lets one refresh —
 * `refreshInboxList` in data/realtime/inbox-ws-updaters.ts — cover both lists
 * plus the archived facets in a single prefix invalidation. The two lists are
 * mutually exclusive per issue (the server decides which one an issue belongs
 * to), so a write in either has to be visible in both.
 */
export const inboxKeys = {
  all: (wsId: string | null) => ["inbox", wsId] as const,
  list: (wsId: string | null) =>
    [...inboxKeys.all(wsId), "list"] as const,
  archived: (wsId: string | null) =>
    [...inboxKeys.all(wsId), "archived"] as const,
  pages: (wsId: string | null) =>
    [...inboxKeys.archived(wsId), "pages"] as const,
  facets: (wsId: string | null) =>
    [...inboxKeys.archived(wsId), "facets"] as const,
  // Account-level, not workspace-scoped: one cache entry holding unread
  // counts for every workspace the user belongs to. Same key shape as web
  // (packages/core/inbox/queries.ts) so the mental model stays shared.
  unreadSummary: () => ["inbox", "unread-summary"] as const,
};

export const inboxListOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: inboxKeys.list(wsId),
    queryFn: ({ signal }) => api.listInbox({ signal }),
    enabled: !!wsId,
  });

/**
 * The archived list: cursor pagination, server-side filters.
 *
 * Filters are part of the key (normalized, so the same selection is always one
 * entry) because they are part of the REQUEST — changing a filter is a
 * different query, not a re-sort of one already-loaded page. Switching a
 * filter therefore starts the archive from page one, which is web's behavior
 * too.
 */
export const archivedInboxPagesOptions = (
  wsId: string | null,
  filters: InboxFilters,
) =>
  infiniteQueryOptions({
    queryKey: [...inboxKeys.pages(wsId), normalizeInboxFilters(filters)],
    queryFn: ({ pageParam, signal }) =>
      api.listArchivedInboxPage(filters, {
        cursor: pageParam,
        signal,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: !!wsId,
    retry: false,
  });

/**
 * Faceted counts for the archived filter sheet. Only fetched while the sheet is
 * open in the archived view (the caller passes `enabled`) — the main inbox
 * counts its own already-loaded list instead, so this request exists only where
 * a client-side count is impossible.
 */
export const archivedInboxFacetsOptions = (
  wsId: string | null,
  filters: InboxFilters,
) =>
  queryOptions({
    queryKey: [...inboxKeys.facets(wsId), normalizeInboxFilters(filters)],
    queryFn: ({ signal }) => api.getArchivedInboxFacets(filters, { signal }),
    enabled: !!wsId,
    retry: false,
  });

/**
 * Cross-workspace unread inbox summary — the source of the tab badge count.
 *
 * Gated on an active workspace because the endpoint resolves through the
 * workspace-member middleware, same as web's sidebar does.
 */
export const inboxUnreadSummaryOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: inboxKeys.unreadSummary(),
    queryFn: ({ signal }) => api.getInboxUnreadSummary({ signal }),
    enabled: !!wsId,
  });

/**
 * Two shapes live under `inboxKeys.archived(wsId)`: the paginated list is an
 * InfiniteData of pages, the facets entry is a counts object. They share the
 * prefix, so a patcher has to tell them apart instead of assuming every match
 * carries rows.
 */
export type ArchivedInboxPagesCache = InfiniteData<ArchivedInboxPage>;

export function isArchivedPagesCache(
  data: unknown,
): data is ArchivedInboxPagesCache {
  return (
    typeof data === "object" &&
    data !== null &&
    Array.isArray((data as { pages?: unknown }).pages)
  );
}

/** Apply a row transform to one archived cache entry, whatever its shape. */
export function mapArchivedInboxCache(
  cache: unknown,
  patch: (items: InboxItem[]) => InboxItem[],
): unknown {
  if (!isArchivedPagesCache(cache)) return cache;
  return {
    ...cache,
    pages: cache.pages.map((page) => ({ ...page, items: patch(page.items) })),
  };
}

/**
 * Apply a row transform to every loaded archived page, mirroring web's
 * `patchArchivedInboxCaches`. Returns the matched entries (facets included) so
 * a mutation can roll the subtree back.
 *
 * Lives beside the key factory rather than in the mutation or the realtime
 * updater because both need it — mutations patch optimistically, WS events
 * patch authoritatively — and importing it across those two files would make a
 * cycle. Web keeps it in queries.ts for the same reason.
 */
export function patchArchivedInboxCaches(
  qc: QueryClient,
  wsId: string | null,
  patch: (items: InboxItem[]) => InboxItem[],
): [QueryKey, unknown][] {
  const snapshot = qc.getQueriesData<unknown>({
    queryKey: inboxKeys.archived(wsId),
  });
  for (const [key, data] of snapshot) {
    if (!isArchivedPagesCache(data)) continue;
    qc.setQueryData(key, (old) => mapArchivedInboxCache(old, patch));
  }
  return snapshot;
}

/** Undo a `patchArchivedInboxCaches` call from its returned snapshot. */
export function restoreArchivedInboxCaches(
  qc: QueryClient,
  snapshot: [QueryKey, unknown][],
): void {
  for (const [key, data] of snapshot) qc.setQueryData(key, data);
}
