/**
 * Thread navigation index for the issue timeline — the mobile counterpart of
 * web's quick-jump outline (`packages/views/issues/components/thread-minimap.tsx`)
 * and the grouping it is fed from (`thread-utils.ts`).
 *
 * A thread on mobile is one rendered root-comment row: `lib/timeline-thread.ts`
 * bundles a root's whole descendant chain into that row, so the order the list
 * renders IS the thread order the outline shows. This module derives what the
 * outline and the prev/next stepper need from those rows, and adds no second
 * grouping rule:
 *
 *   - a thread is a root-comment row (web's root/reply split: no `parent_id`);
 *     activity rows and the injected unread-divider row are not threads;
 *   - `replyCount` skips deleted replies, which render nothing (web's
 *     ResolvedThreadBar count does the same);
 *   - `resolved` is web's `deriveThreadResolution` verdict — the root's
 *     `resolved_at`, or any reply's. The server lets either carry it
 *     (server/internal/handler/comment.go folds reply-resolved threads too),
 *     and `ListTimeline` ships `resolved_at` unfolded precisely so the client
 *     can derive it (server/internal/handler/activity.go).
 *
 * Pure by design: no react-native, no list library, so the Node lane in
 * `vitest.config.ts` locks the row → thread mapping the jump depends on.
 */
import type { TimelineEntry } from "@multica/core/types";
import { isDeletedComment } from "@multica/core/issues/comment-deletion";
import { stripMarkdown } from "./strip-markdown";
import type { TimelineRow } from "./timeline-thread";

/**
 * Threads needed before the jump affordance pays for its screen space.
 * Mirrors web's `MIN_THREADS` in thread-minimap.tsx.
 */
export const MIN_THREADS = 2;

/** Placeholder heading for a deleted thread root — same literal the card
 *  renders for it (comment-card.tsx), so the outline and the row agree. */
const DELETED_ROOT_PREVIEW = "This comment was deleted";

export interface ThreadNavItem {
  /** Root comment id. Doubles as the jump target: landing on it parks the
   *  root's row (or its folded resolved bar) at the top of the viewport. */
  rootId: string;
  /** Index of that row in the rendered array — the same array the list is
   *  given (divider row included), so it is directly usable as a target. */
  rowIndex: number;
  /** The root comment, for the outline's author + preview. */
  entry: TimelineEntry;
  /** Non-deleted replies. A thread with none still shows (its root is a
   *  thread); the outline just reads "0 replies". */
  replyCount: number;
  /** Root- or reply-level resolution. */
  resolved: boolean;
}

/** Web's `deriveThreadResolution(...).kind !== "none"`, without the id. */
function isThreadResolved(
  root: TimelineEntry,
  replies: readonly TimelineEntry[],
): boolean {
  if (root.resolved_at) return true;
  return replies.some((reply) => !!reply.resolved_at);
}

/**
 * One item per thread, in rendered order (oldest first, as the timeline runs).
 * Resolved threads are included even while folded behind their bar, matching
 * web's outline.
 */
export function buildThreadNav(rows: readonly TimelineRow[]): ThreadNavItem[] {
  const items: ThreadNavItem[] = [];
  rows.forEach((row, rowIndex) => {
    if (row.entry.type !== "comment") return;
    items.push({
      rootId: row.entry.id,
      rowIndex,
      entry: row.entry,
      replyCount: row.replies.filter((reply) => !isDeletedComment(reply)).length,
      resolved: isThreadResolved(row.entry, row.replies),
    });
  });
  return items;
}

/**
 * Which thread the viewport top is inside — `topRowIndex` being the smallest
 * row index currently on screen (FlashList's viewability callback supplies it).
 *
 * The last thread starting at or above that row: an activity row, the unread
 * divider, or a thread's own replies all belong to the thread above them,
 * because that is the content the reader is looking at the tail of. Returns
 * `-1` above the first thread (the reader is in the header/description), which
 * is also the stepper's "no previous thread" state.
 */
export function threadIndexAtRow(
  nav: readonly ThreadNavItem[],
  topRowIndex: number,
): number {
  let index = -1;
  for (let i = 0; i < nav.length; i++) {
    if (nav[i]!.rowIndex > topRowIndex) break;
    index = i;
  }
  return index;
}

/**
 * One-line summary of a thread root for the outline. First non-empty line of
 * the stripped markdown — web's `commentPreview` takes the same first line as
 * its title, trimmed here to a single line because the row is one line tall on
 * a phone. Deleted roots keep the card's placeholder.
 */
export function threadPreview(entry: TimelineEntry): string {
  if (isDeletedComment(entry)) return DELETED_ROOT_PREVIEW;
  const firstLine = stripMarkdown(entry.content ?? "")
    .split("\n")
    .find((line) => line.trim() !== "");
  return firstLine?.trim() ?? "";
}
