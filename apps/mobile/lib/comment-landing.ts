/**
 * Deep-link landing for the issue timeline: which comment a notification
 * points at, and how the list gets there.
 *
 * An inbox notification carries the id of the comment it is about, which on
 * its own says nothing about a scroll position: mobile renders one row per
 * thread root, with the whole reply chain nested inside that root's card
 * (`lib/timeline-thread.ts`). A reply target therefore lives *inside* its
 * root's row — the row index alone cannot express it, and neither can the
 * FlashList `scrollToIndex` that only understands rows.
 *
 * So landing is split in two:
 *
 *   - `resolveCommentLanding` turns the id into the row to bring into the
 *     render window plus the view inside that row which is the anchor.
 *   - `startLanding` drives the list onto that anchor and holds it there
 *     while the row's async heights (Shiki, images) settle.
 *
 * The anchor carries web's deleted-reply rule: a deleted reply renders
 * nothing (no row, no bubble), so an id pointing at one falls back to the
 * nearest visible comment above it. See `commentLandingTarget` in
 * `packages/core/issues/comment-deletion.ts`.
 *
 * Everything here talks to the list through the structural interfaces below,
 * so the module stays free of the list library and of React Native — the
 * timeline passes its live refs in, a test passes a fake.
 */
import { commentLandingTarget } from "@multica/core/issues/comment-deletion";
import type { TimelineRow } from "./timeline-thread";

export interface CommentLanding {
  /** Index into the rendered row array — divider rows included, because that
   *  array is what the list is given. */
  rowIndex: number;
  /** Comment id whose view is the anchor. Equal to `rowIndex`'s entry id for
   *  a root target, a reply id for a reply target. */
  anchorId: string;
}

/**
 * Resolve `commentId` against the rows currently rendered.
 *
 * Returns `null` when there is nothing to land on — no id at all (an
 * issue-level notification: the timeline keeps its normal top-of-issue
 * position), or an id that is not in the loaded timeline (a comment deleted
 * without a reply to fall back to, or one outside the fetched window).
 */
export function resolveCommentLanding(
  rows: readonly TimelineRow[],
  commentId: string | null | undefined,
): CommentLanding | null {
  if (!commentId) return null;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]!;
    // A root target is its own anchor. This includes a deleted root, which
    // still renders as its thread's placeholder head (unlike a deleted reply).
    if (row.entry.id === commentId) return { rowIndex, anchorId: commentId };
    if (row.replies.some((reply) => reply.id === commentId)) {
      return {
        rowIndex,
        anchorId: commentLandingTarget(commentId, row.entry.id, row.replies),
      };
    }
  }
  return null;
}

/** The slice of a FlashList the landing driver needs. */
export interface LandingList {
  /** Current scroll offset, in the units `scrollToOffset` takes. */
  getAbsoluteLastScrollOffset: () => number;
  /** Layout of a row, or `undefined` while the model does not cover it yet. */
  getLayout: (index: number) => { height: number } | undefined;
  getWindowSize: () => { width: number; height: number };
  scrollToOffset: (params: {
    offset: number;
    animated: boolean;
    skipFirstItemOffset: boolean;
  }) => void;
  scrollToIndex: (params: {
    index: number;
    animated: boolean;
    viewPosition: number;
  }) => Promise<void>;
}

/** A host view measurable in window coordinates. */
export interface Measurable {
  measureInWindow: (
    callback: (x: number, y: number, width: number, height: number) => void,
  ) => void;
}

/** Landing geometry: the anchor's top edge is parked this far below the top
 *  of the list, leaving a sliver of the row above as orientation instead of
 *  clipping the target flush against the header. */
export const LANDING_TOP_INSET_PX = 12;

/** Sub-pixel drift is measurement noise, not a real offset. */
const LANDING_TOLERANCE_PX = 1;

/** Consecutive in-tolerance frames before the landing counts as settled.
 *  Async heights (Shiki, image natural-size) keep reflowing for a few frames
 *  after the jump, and every reflow moves the anchor. */
const LANDING_STABLE_FRAMES = 3;

/** Frame budget for one landing (~2.5s at 60fps). MVCP holds the position
 *  from there on, so chasing longer would only fight the user. */
const LANDING_FRAME_BUDGET = 150;

/** While the anchor is still outside the render window, step the viewport
 *  down by this fraction of its height and look again — how a reply nested
 *  below a tall thread root gets found. */
const LANDING_PROBE_RATIO = 0.7;

/** Frames to wait before the first step down: the anchor's row may still be
 *  committing (a resolved thread expands to reveal its replies). */
const LANDING_PROBE_GRACE_FRAMES = 8;

/** Stop probing roughly seven screens below the target row. */
const LANDING_MAX_PROBES = 10;

/**
 * Drive a deep link onto its anchor and hold it there while the row settles.
 *
 * Two halves, because neither is enough alone:
 *
 *   1. `scrollToIndex` brings the target row into the render window and puts
 *      its top at the top of the viewport. The list positions rows against
 *      its own layout model, so this half is exact — but it only understands
 *      rows, and a reply target lives inside its root's row.
 *   2. A measurement loop reads the anchor's real position in window
 *      coordinates and turns the residual into a scroll offset. This is the
 *      half that lands a reply exactly, and the half that survives markdown
 *      resizing the row after the jump.
 *
 * Offsets are native scroll offsets — `skipFirstItemOffset: true` matches
 * `getAbsoluteLastScrollOffset()` — and every correction comes from a fresh
 * measurement rather than a predicted height, so a stale base costs one
 * extra frame instead of an overshoot.
 *
 * Returns a cancel function. The caller uses it for user drags and unmount;
 * the frame budget bounds the loop either way.
 */
export function startLanding({
  list,
  targetIndex,
  probeDown,
  anchorNode,
  viewport,
}: {
  list: LandingList;
  targetIndex: number;
  /** The anchor is nested inside the row rather than being its top edge, so
   *  an unmounted anchor has to be searched for further down. */
  probeDown: boolean;
  anchorNode: () => Measurable | null;
  viewport: () => Measurable | null;
}): () => void {
  let cancelled = false;
  let frame = 0;
  let frames = 0;
  let started = false;
  let stableFrames = 0;
  let missingFrames = 0;
  let probes = 0;

  const cancel = () => {
    cancelled = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };

  function schedule() {
    if (cancelled || frames++ >= LANDING_FRAME_BUDGET) return;
    frame = requestAnimationFrame(tick);
  }

  /** Move the viewport `delta` pixels from where it is right now. */
  const scrollBy = (delta: number) => {
    list.scrollToOffset({
      offset: Math.max(0, list.getAbsoluteLastScrollOffset() + delta),
      animated: false,
      skipFirstItemOffset: true,
    });
  };

  function tick() {
    frame = 0;
    if (cancelled) return;

    if (!started) {
      // The timeline data and the list's first layout pass land in different
      // commits — wait for the layout model to cover the target row.
      const layout = list.getLayout(targetIndex);
      if (!layout || layout.height <= 0) return schedule();
      started = true;
      list
        .scrollToIndex({ index: targetIndex, animated: false, viewPosition: 0 })
        .then(schedule, schedule);
      return;
    }

    const anchor = anchorNode();
    const window = viewport();
    if (!anchor || !window) {
      // Nothing to measure yet. A reply can sit below the row we already
      // landed on, so step down and look again instead of giving up.
      if (!probeDown || missingFrames++ < LANDING_PROBE_GRACE_FRAMES) {
        return schedule();
      }
      missingFrames = 0;
      if (probes++ >= LANDING_MAX_PROBES) return cancel();
      scrollBy(list.getWindowSize().height * LANDING_PROBE_RATIO);
      return schedule();
    }

    missingFrames = 0;
    anchor.measureInWindow((_x, y) => {
      if (cancelled) return;
      window.measureInWindow((_windowX, windowY) => {
        if (cancelled) return;
        const delta = y - (windowY + LANDING_TOP_INSET_PX);
        if (Math.abs(delta) <= LANDING_TOLERANCE_PX) {
          if (++stableFrames >= LANDING_STABLE_FRAMES) return cancel();
        } else {
          stableFrames = 0;
          scrollBy(delta);
        }
        schedule();
      });
    });
  }

  schedule();
  return cancel;
}
