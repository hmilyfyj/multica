/**
 * Inbox filtering — mobile-owned mirror of `packages/core/inbox/filter-store.ts`
 * plus the faceted counters the filter sheet needs (web keeps those in
 * `packages/views/inbox/components/inbox-filter-menu.tsx`).
 *
 * Mirrored rather than imported for the same reason `lib/inbox-display.ts` is:
 * the core module is a zustand store reachable from web's API client graph,
 * and mobile's import whitelist is `import type` plus pure schemas/utilities
 * (apps/mobile/AGENTS.md "Sharing and Dependencies"). The TYPES are shared, so
 * the two sides cannot drift on shape; the predicates below are restated
 * verbatim so they cannot drift on behavior either.
 *
 * Behavioral parity (apps/AGENTS.md "Behavioral Parity"):
 *   - OR within a dimension, AND between dimensions.
 *   - Every dimension is read off the row the list actually renders — the
 *     newest notification of a deduped group. Filtering by an actor buried in
 *     an older row would answer a different question ("issues Alice has ever
 *     touched") than the row then displays, so selecting Alice would fill the
 *     list with Bob. What you filter by is what you see.
 *   - `unreadOnly` reads the same rendered row's `read`, which is also what the
 *     server's unread summary counts — so "only unread" and the badge next to
 *     Inbox cannot disagree.
 *   - A row missing a dimension's field (issue_status / issue_priority null,
 *     no usable actor attribution) never matches a selection in that dimension,
 *     exactly as a row without an issue can never match a status one.
 */
import type { InboxItem, IssuePriority, IssueStatus } from "@multica/core/types";

export interface InboxFilters {
  readonly statuses: readonly IssueStatus[];
  readonly priorities: readonly IssuePriority[];
  /** Actor keys — see `inboxActorKey`. */
  readonly actors: readonly string[];
  readonly unreadOnly: boolean;
}

export const EMPTY_INBOX_FILTERS: InboxFilters = Object.freeze({
  statuses: Object.freeze([]),
  priorities: Object.freeze([]),
  actors: Object.freeze([]),
  unreadOnly: false,
});

/** True when nothing is selected in any dimension. */
export function isEmptyInboxFilters(filters: InboxFilters): boolean {
  return inboxFilterCount(filters) === 0;
}

/**
 * Stable identity for "who this notification came from", used as the value of
 * the `actors` dimension.
 *
 * Members and agents key on their id. `system` has no id — the backend writes
 * an invalid UUID that serializes to null — so it keys on the type alone and
 * every system notification collapses into one bucket. Returns null when the
 * row carries no usable attribution; such a row can never match an actor
 * selection.
 */
export function inboxActorKey(item: InboxItem): string | null {
  const type = item.actor_type;
  if (!type) return null;
  if (type === "system") return "system";
  return item.actor_id ? `${type}:${item.actor_id}` : null;
}

/** Inverse of `inboxActorKey`, for resolving a selection back to a directory. */
export function inboxActorKeyParts(key: string): { type: string; id: string } {
  const separator = key.indexOf(":");
  if (separator === -1) return { type: key, id: "" };
  return { type: key.slice(0, separator), id: key.slice(separator + 1) };
}

export type InboxPriorityFilterSupport =
  | "unknown"
  | "supported"
  | "unsupported";

/**
 * Capability inferred from the parsed response, not from a version string.
 *
 * The current backend serializes `issue_priority` for every Inbox row
 * (including null for notifications without an issue); an older one omits it.
 * Requiring EVERY returned row to carry a defined value also keeps a priority
 * cache patch from making a mixed rolling-deploy response look supported.
 */
export function inboxPriorityFilterSupport(
  items: readonly InboxItem[],
): InboxPriorityFilterSupport {
  if (items.length === 0) return "unknown";
  return items.every((item) => item.issue_priority !== undefined)
    ? "supported"
    : "unsupported";
}

/**
 * The filters the LIST renders with. A priority selection is dropped unless the
 * backend proved it serializes `issue_priority` — a list narrowed by a field
 * the response does not carry would come back empty for no visible reason.
 *
 * This does not clear the user's selection: the store keeps it (so a transient
 * "unknown" — an empty list proves nothing — does not silently undo a choice),
 * and the screen drops it only once incompatibility is confirmed. Same split as
 * web's filter menu, where the derived filters and the store effect are two
 * separate mechanisms.
 */
export function inboxFiltersForPrioritySupport(
  filters: InboxFilters,
  support: InboxPriorityFilterSupport,
): InboxFilters {
  if (support === "supported" || filters.priorities.length === 0) {
    return filters;
  }
  return { ...filters, priorities: [] };
}

export function filterInboxItems(
  items: InboxItem[],
  filters: InboxFilters,
): InboxItem[] {
  if (isEmptyInboxFilters(filters)) return items;

  const statuses = new Set(filters.statuses);
  const priorities = new Set(filters.priorities);
  const actors = new Set(filters.actors);
  return items.filter((item) => {
    const actor = inboxActorKey(item);
    return (
      (statuses.size === 0 ||
        (item.issue_status != null && statuses.has(item.issue_status))) &&
      (priorities.size === 0 ||
        (item.issue_priority != null &&
          priorities.has(item.issue_priority))) &&
      (actors.size === 0 || (actor != null && actors.has(actor))) &&
      (!filters.unreadOnly || item.read !== true)
    );
  });
}

/** Number of active selections across all four dimensions. */
export function inboxFilterCount(filters: InboxFilters): number {
  return (
    filters.statuses.length +
    filters.priorities.length +
    filters.actors.length +
    (filters.unreadOnly ? 1 : 0)
  );
}

/**
 * Rows with no linked issue carry a null status, so they are counted under no
 * key rather than under a synthetic one — a "no status" bucket would offer a
 * filter that web cannot express.
 */
export function inboxStatusCounts(items: InboxItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.issue_status == null) continue;
    counts.set(item.issue_status, (counts.get(item.issue_status) ?? 0) + 1);
  }
  return counts;
}

export function inboxPriorityCounts(items: InboxItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.issue_priority == null) continue;
    counts.set(
      item.issue_priority,
      (counts.get(item.issue_priority) ?? 0) + 1,
    );
  }
  return counts;
}

export function inboxActorCounts(items: InboxItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = inboxActorKey(item);
    if (key == null) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * The "only unread" row's count, faceted the same way: every other active
 * dimension is respected so the number says how many rows selecting it can
 * actually reveal.
 */
export function inboxUnreadCountOf(items: InboxItem[]): number {
  return items.filter((item) => item.read !== true).length;
}

/**
 * Faceted counts for one dimension: the numbers are computed over the list
 * filtered by every OTHER active dimension, ignoring the one being counted.
 * Each number then says how many rows selecting that value can reveal, rather
 * than how many the current selection already hides.
 */
export function inboxFacetItems(
  items: InboxItem[],
  filters: InboxFilters,
  dimension: "statuses" | "priorities" | "actors" | "unreadOnly",
): InboxItem[] {
  switch (dimension) {
    case "statuses":
      return filterInboxItems(items, { ...filters, statuses: [] });
    case "priorities":
      return filterInboxItems(items, { ...filters, priorities: [] });
    case "actors":
      return filterInboxItems(items, { ...filters, actors: [] });
    case "unreadOnly":
      return filterInboxItems(items, { ...filters, unreadOnly: false });
  }
}

/**
 * Canonical key fragment for an archived page / facets query.
 *
 * Sorted so the same selection always maps to one cache entry — an unsorted
 * array would make two identical selections two different keys (web's
 * `normalizedInboxFilters` exists for the same reason).
 */
export function normalizeInboxFilters(filters: InboxFilters): InboxFilters {
  return {
    statuses: [...filters.statuses].sort(),
    priorities: [...filters.priorities].sort(),
    actors: [...filters.actors].sort(),
    unreadOnly: filters.unreadOnly,
  };
}
