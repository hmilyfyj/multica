import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TimelineEntry } from "@multica/core/types";
import {
  LANDING_TOP_INSET_PX,
  resolveCommentLanding,
  startLanding,
  type LandingList,
  type Measurable,
} from "./comment-landing";
import type { TimelineRow } from "./timeline-thread";

function comment(
  id: string,
  overrides: Partial<TimelineEntry> = {},
): TimelineEntry {
  return {
    id,
    type: "comment",
    parent_id: null,
    content: id,
    created_at: "2026-09-19T00:00:00Z",
    actor_type: "member",
    actor_id: "member-1",
    ...overrides,
  } as TimelineEntry;
}

function activity(id: string): TimelineEntry {
  return {
    id,
    type: "activity",
    created_at: "2026-09-19T00:00:00Z",
    actor_type: "member",
    actor_id: "member-1",
  } as TimelineEntry;
}

describe("resolveCommentLanding", () => {
  const rows: TimelineRow[] = [
    { entry: activity("activity-1"), replies: [] },
    { entry: comment("root-1"), replies: [comment("reply-1"), comment("reply-2")] },
    { entry: comment("root-2"), replies: [] },
  ];

  it("lands a root comment on its own row", () => {
    expect(resolveCommentLanding(rows, "root-2")).toEqual({
      rowIndex: 2,
      anchorId: "root-2",
    });
  });

  it("lands a reply on its root's row, anchored on the reply itself", () => {
    expect(resolveCommentLanding(rows, "reply-2")).toEqual({
      rowIndex: 1,
      anchorId: "reply-2",
    });
  });

  it("has nothing to land on without a comment id", () => {
    expect(resolveCommentLanding(rows, undefined)).toBeNull();
    expect(resolveCommentLanding(rows, null)).toBeNull();
    expect(resolveCommentLanding(rows, "")).toBeNull();
  });

  it("anchors a deleted reply on the nearest visible comment above it", () => {
    const withDeleted: TimelineRow[] = [
      {
        entry: comment("root-1"),
        replies: [
          comment("reply-1"),
          comment("reply-2", { deleted_at: "2026-09-19T01:00:00Z" }),
        ],
      },
    ];
    expect(resolveCommentLanding(withDeleted, "reply-2")).toEqual({
      rowIndex: 0,
      anchorId: "reply-1",
    });
  });

  it("has nothing to land on for a comment outside the loaded timeline", () => {
    expect(resolveCommentLanding(rows, "comment-from-another-issue")).toBeNull();
  });
});

// ── startLanding ─────────────────────────────────────────────────────────
// A fake list in window coordinates: `viewportTop` is where the list starts on
// screen, `offset` is its scroll offset, and a point at absolute content
// position `p` renders at `viewportTop + p - offset`. The anchor is available
// to measure only while it sits inside the list's render range, which is how a
// reply nested below a tall thread root goes missing in the real list.

const VIEWPORT_TOP = 100;
const WINDOW_HEIGHT = 800;
const TARGET_ROW_Y = 5000;
const RENDER_RANGE_WINDOWS = 1.5;

let frameQueue: (() => void)[] = [];
let nextFrameId = 1;

beforeEach(() => {
  frameQueue = [];
  nextFrameId = 1;
  globalThis.requestAnimationFrame = (callback: (time: number) => void) => {
    frameQueue.push(() => callback(0));
    return nextFrameId++;
  };
  globalThis.cancelAnimationFrame = () => {};
});

afterEach(() => {
  // @ts-expect-error — the node test environment has no rAF of its own.
  delete globalThis.requestAnimationFrame;
  // @ts-expect-error — same for the cancel half.
  delete globalThis.cancelAnimationFrame;
});

function harness({
  anchorOffsetInRow,
  probeDown,
}: {
  anchorOffsetInRow: number;
  probeDown: boolean;
}) {
  const anchorY = TARGET_ROW_Y + anchorOffsetInRow;
  let offset = 0;
  let scrollCalls = 0;

  const anchorScreenY = () => VIEWPORT_TOP + anchorY - offset;
  const anchorRendered = () => {
    const y = anchorScreenY();
    const reach = RENDER_RANGE_WINDOWS * WINDOW_HEIGHT;
    return y >= VIEWPORT_TOP - reach && y <= VIEWPORT_TOP + reach;
  };

  const list: LandingList = {
    getAbsoluteLastScrollOffset: () => offset,
    getLayout: (index) => (index === 0 ? { height: 400 } : undefined),
    getWindowSize: () => ({ width: 400, height: WINDOW_HEIGHT }),
    scrollToOffset: ({ offset: next }) => {
      offset = next;
      scrollCalls += 1;
    },
    // Landing on the row puts its top at the top of the viewport.
    scrollToIndex: async () => {
      offset = TARGET_ROW_Y;
    },
  };

  const anchor: Measurable = {
    measureInWindow: (callback) =>
      callback(0, anchorScreenY(), 400, 60),
  };
  const viewport: Measurable = {
    measureInWindow: (callback) =>
      callback(0, VIEWPORT_TOP, 400, WINDOW_HEIGHT),
  };

  return {
    list,
    viewport,
    /** `null` while the anchor is outside the list's render range. */
    anchorNode: () => (anchorRendered() ? anchor : null),
    probeDown,
    offset: () => offset,
    anchorScreenY,
    scrollCalls: () => scrollCalls,
  };
}

/** Run queued frames and the promise continuations they schedule, until the
 *  landing stops asking for more. */
async function settle(maxRounds = 400) {
  for (let round = 0; round < maxRounds; round++) {
    if (frameQueue.length === 0) return;
    const pending = frameQueue.splice(0, frameQueue.length);
    for (const callback of pending) callback();
    const flushed = Promise.withResolvers<void>();
    setImmediate(flushed.resolve);
    await flushed.promise;
  }
  throw new Error("landing never stopped scheduling frames");
}

describe("startLanding", () => {
  it("parks the anchor at the top inset and stops correcting", async () => {
    const fake = harness({ anchorOffsetInRow: 0, probeDown: false });

    startLanding({
      list: fake.list,
      targetIndex: 0,
      probeDown: fake.probeDown,
      anchorNode: fake.anchorNode,
      viewport: () => fake.viewport,
    });
    await settle();

    expect(fake.anchorScreenY()).toBe(VIEWPORT_TOP + LANDING_TOP_INSET_PX);
  });

  it("finds a reply parked below the row it first landed on", async () => {
    const fake = harness({ anchorOffsetInRow: 3000, probeDown: true });

    startLanding({
      list: fake.list,
      targetIndex: 0,
      probeDown: fake.probeDown,
      anchorNode: fake.anchorNode,
      viewport: () => fake.viewport,
    });
    await settle();

    expect(fake.anchorScreenY()).toBe(VIEWPORT_TOP + LANDING_TOP_INSET_PX);
  });

  it("stops moving the list once the user takes over", async () => {
    const fake = harness({ anchorOffsetInRow: 0, probeDown: false });

    const cancel = startLanding({
      list: fake.list,
      targetIndex: 0,
      probeDown: fake.probeDown,
      anchorNode: fake.anchorNode,
      viewport: () => fake.viewport,
    });
    cancel();
    await settle();

    expect(fake.offset()).toBe(0);
    expect(fake.scrollCalls()).toBe(0);
  });

  it("gives up instead of spinning when the anchor never renders", async () => {
    const fake = harness({ anchorOffsetInRow: 0, probeDown: false });

    startLanding({
      list: fake.list,
      targetIndex: 0,
      probeDown: fake.probeDown,
      // A collapsed resolved thread: the row is on screen, its replies are not.
      anchorNode: () => null,
      viewport: () => fake.viewport,
    });

    await settle();
    expect(frameQueue).toHaveLength(0);
  });
});
