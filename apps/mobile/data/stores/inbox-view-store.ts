/**
 * Inbox view store — which list is showing, plus the active filter selection.
 *
 * Mirrors the shape of `packages/core/inbox/filter-store.ts` (four dimensions,
 * toggles, clear) and `packages/views/inbox/components/inbox-view.ts` (the
 * `inbox | archived` view), owned by mobile because web's store is keyed per
 * workspace and lives behind its API client graph.
 *
 * Two deliberate differences from web, both following the mobile convention
 * already set by `data/stores/my-issues-view-store.ts`:
 *
 * 1. **No `filtersByWorkspace` map.** Web keeps a bucket per workspace so a
 *    switch back restores what you had; mobile clears instead, through
 *    `useClearFiltersOnWorkspaceChange`, because the app is a single-workspace
 *    session and a stale bucket is the failure mode users actually hit.
 * 2. **No persist middleware.** Filters are session-scoped, like the issues
 *    filters beside them.
 *
 * `view` is NOT cleared with the filters: it is the list you are looking at,
 * not a selection, and `clearFilters` is reachable from inside the archived
 * view (web's clear does not touch the URL either).
 *
 * Empty array = "show all" for that dimension — the predicate semantics in
 * `lib/inbox-filters.ts` depend on it.
 */
import { useMemo } from "react";
import { create } from "zustand";
import type { IssuePriority, IssueStatus } from "@multica/core/types";
import type { InboxFilters } from "@/lib/inbox-filters";

/** Which of the inbox's two lists is showing. Same union as web's InboxView. */
export type InboxView = "inbox" | "archived";

interface InboxViewState {
  view: InboxView;
  statuses: IssueStatus[];
  priorities: IssuePriority[];
  /** Actor keys — `member:<id>` / `agent:<id>` / `system`. See inboxActorKey. */
  actors: string[];
  unreadOnly: boolean;
  setView: (view: InboxView) => void;
  toggleStatusFilter: (status: IssueStatus) => void;
  togglePriorityFilter: (priority: IssuePriority) => void;
  toggleActorFilter: (actor: string) => void;
  toggleUnreadOnly: () => void;
  /**
   * Drop the priority selection only. Exists for the capability guard: a
   * backend that stops reporting `issue_priority` must not leave a priority
   * filter silently narrowing the list to nothing.
   */
  clearPriorityFilters: () => void;
  clearFilters: () => void;
}

function toggleValue<T extends string>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((candidate) => candidate !== value)
    : [...values, value];
}

export const useInboxViewStore = create<InboxViewState>((set) => ({
  view: "inbox",
  statuses: [],
  priorities: [],
  actors: [],
  unreadOnly: false,
  setView: (view) => set({ view }),
  toggleStatusFilter: (status) =>
    set((state) => ({ statuses: toggleValue(state.statuses, status) })),
  togglePriorityFilter: (priority) =>
    set((state) => ({ priorities: toggleValue(state.priorities, priority) })),
  toggleActorFilter: (actor) =>
    set((state) => ({ actors: toggleValue(state.actors, actor) })),
  toggleUnreadOnly: () => set((state) => ({ unreadOnly: !state.unreadOnly })),
  clearPriorityFilters: () =>
    set((state) => (state.priorities.length === 0 ? state : { priorities: [] })),
  clearFilters: () =>
    set({ statuses: [], priorities: [], actors: [], unreadOnly: false }),
}));

/**
 * The active selection as an `InboxFilters`, memoized across the four slices.
 *
 * Read as four separate selectors rather than one object selector: zustand
 * compares selector output by reference, so an inline object selector would
 * hand back a new identity every render and re-render on every unrelated
 * store write.
 */
export function useInboxFilters(): InboxFilters {
  const statuses = useInboxViewStore((s) => s.statuses);
  const priorities = useInboxViewStore((s) => s.priorities);
  const actors = useInboxViewStore((s) => s.actors);
  const unreadOnly = useInboxViewStore((s) => s.unreadOnly);
  return useMemo(
    () => ({ statuses, priorities, actors, unreadOnly }),
    [statuses, priorities, actors, unreadOnly],
  );
}
