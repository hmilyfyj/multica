/**
 * Sub-issue helpers for the issue-detail sub-issues block — the mobile
 * counterpart of web's `groupSubIssuesByStage` and the done-count it renders
 * (`packages/views/issues/components/issue-detail.tsx`).
 *
 * Pure by design: no react-native, no list library, so the Node lane in
 * `vitest.config.ts` locks the grouping and the count mapping the panel
 * depends on.
 *
 * Product semantics mirrored from web rather than re-derived:
 *
 *   - stage grouping: staged groups ascending by stage, the unstaged group
 *     (`stage === null`) last. A caller draws a stage header only when the set
 *     is actually staged, so an unstaged issue's sub-issues stay headerless —
 *     same rule as web, and the reason the "last group" placement matters.
 *   - completion: judged by LIFECYCLE CATEGORY (`issueBehavesAs(child, "done")`),
 *     never by comparing `status` to the built-in `"done"` key. A workspace
 *     custom status in the done category counts as completed; cancelled /
 *     closed does not (MUL-6243).
 */
import type { Issue } from "@multica/core/types";
import { issueBehavesAs } from "./issue-status";

/** One stage bucket of a parent's children, in display order. */
export interface SubIssueStageGroup {
  /** Barrier group among siblings; `null` = the unstaged group. */
  stage: number | null;
  items: Issue[];
}

/**
 * Orders a parent's children for display: staged groups ascending by stage,
 * then the unstaged group last. Input order is preserved inside a group —
 * the server already returns siblings in their canonical order.
 *
 * `staged` is not returned: web's render draws per-group stage headers only
 * when `children.some((c) => c.stage != null)`, and that is one expression at
 * the call site.
 */
export function groupSubIssuesByStage(
  children: readonly Issue[],
): SubIssueStageGroup[] {
  const byStage = new Map<number, Issue[]>();
  const unstaged: Issue[] = [];
  for (const child of children) {
    if (child.stage != null) {
      const bucket = byStage.get(child.stage);
      if (bucket) bucket.push(child);
      else byStage.set(child.stage, [child]);
    } else {
      unstaged.push(child);
    }
  }
  const groups: SubIssueStageGroup[] = [...byStage.keys()]
    .sort((a, b) => a - b)
    .map((stage) => ({ stage, items: byStage.get(stage) as Issue[] }));
  if (unstaged.length > 0) groups.push({ stage: null, items: unstaged });
  return groups;
}

/** Whether the group set needs per-group stage headers (web's `staged`). */
export function hasStagedChildren(children: readonly Issue[]): boolean {
  return children.some((child) => child.stage != null);
}

/** Completed / total child count, for the section header badge. */
export interface SubIssueProgress {
  done: number;
  total: number;
}

/**
 * done/total for the section header. Same expression web renders next to the
 * progress ring (`childIssues.filter((c) => issueBehavesAs(c, "done")).length`).
 */
export function childProgressOf(
  children: readonly Issue[],
): SubIssueProgress {
  let done = 0;
  for (const child of children) {
    if (issueBehavesAs(child, "done")) done += 1;
  }
  return { done, total: children.length };
}

/**
 * Row badge text for a sub-issue's OWN children, read from the workspace-wide
 * child-progress map (`GET /api/issues/child-progress`).
 *
 * Null when the map has no entry for the row — which is how "this sub-issue has
 * no children" is represented, since the endpoint only lists parents — and when
 * the entry reports `total <= 0`. A `0/0` badge would claim progress that does
 * not exist.
 */
export function subIssueProgressLabel(
  progress: SubIssueProgress | undefined,
): string | null {
  if (!progress || progress.total <= 0) return null;
  return `${progress.done}/${progress.total}`;
}
