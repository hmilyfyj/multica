/**
 * Whether the sub-issues section of an issue detail page is collapsed, keyed by
 * issue id. Only collapsed ids are stored — expanded is the default.
 *
 * Mirrors `packages/core/issues/stores/sub-issues-collapse-store.ts`, including
 * both of its deliberate choices:
 *
 *   - **Not persisted.** The state lives in a store rather than in the panel's
 *     component state so leaving an issue and navigating back finds the section
 *     as it was left, while a reload returns to the default — the same
 *     session-scoped contract as the other stores in this directory.
 *   - **A `Set`, not a `Record`.** Membership changes at runtime for every issue
 *     the user visits (added on collapse, removed on expand) and the only
 *     question asked is membership, which is what `Set` is for.
 */
import { create } from "zustand";

interface SubIssuesCollapseStore {
  collapsedIssueIds: ReadonlySet<string>;
  setCollapsed: (issueId: string, collapsed: boolean) => void;
}

export const useSubIssuesCollapseStore = create<SubIssuesCollapseStore>()(
  (set) => ({
    collapsedIssueIds: new Set<string>(),
    setCollapsed: (issueId, collapsed) =>
      set((s) => {
        // No-op when nothing changes: the header's toggle re-renders on every
        // store write, and a redundant Set identity would notify subscribers
        // for a state that did not move.
        if (s.collapsedIssueIds.has(issueId) === collapsed) return s;
        const next = new Set(s.collapsedIssueIds);
        if (collapsed) next.add(issueId);
        else next.delete(issueId);
        return { collapsedIssueIds: next };
      }),
  }),
);
