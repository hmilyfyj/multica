import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "@multica/core/types";
import {
  buildThreadNav,
  threadIndexAtRow,
  threadPreview,
} from "./thread-nav";
import type { TimelineRow } from "./timeline-thread";

const DIVIDER_ID = "__divider__";

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

/** The synthetic row the timeline injects before the unread anchor. */
function dividerRow(): TimelineRow {
  return {
    entry: {
      id: DIVIDER_ID,
      type: "activity",
      created_at: "",
      actor_type: "",
      actor_id: "",
    } as unknown as TimelineEntry,
    replies: [],
  };
}

describe("buildThreadNav", () => {
  const rows: TimelineRow[] = [
    { entry: activity("activity-1"), replies: [] },
    { entry: comment("root-1"), replies: [comment("reply-1"), comment("reply-2")] },
    dividerRow(),
    { entry: comment("root-2"), replies: [] },
  ];

  it("keeps one item per root comment and skips activity/divider rows", () => {
    expect(buildThreadNav(rows).map((t) => t.rootId)).toEqual([
      "root-1",
      "root-2",
    ]);
  });

  it("carries the rendered row index, divider offset included", () => {
    expect(buildThreadNav(rows).map((t) => t.rowIndex)).toEqual([1, 3]);
  });

  it("counts a root's whole nested reply chain, not just direct children", () => {
    const nested: TimelineRow[] = [
      {
        entry: comment("root-1"),
        // buildTimelineRows flattens the chain (root → child → grandchild)
        // into this one row, so every entry here belongs to the thread.
        replies: [comment("reply-1"), comment("reply-2"), comment("reply-3")],
      },
    ];
    expect(buildThreadNav(nested)[0]!.replyCount).toBe(3);
  });

  it("does not count replies that render nothing (deleted ones)", () => {
    const withDeleted: TimelineRow[] = [
      {
        entry: comment("root-1"),
        replies: [
          comment("reply-1"),
          comment("reply-2", { deleted_at: "2026-09-19T01:00:00Z" }),
        ],
      },
    ];
    expect(buildThreadNav(withDeleted)[0]!.replyCount).toBe(1);
  });

  it("reports a root-only reply count as 0, keeping the thread listed", () => {
    const nav = buildThreadNav([{ entry: comment("root-1"), replies: [] }]);
    expect(nav).toHaveLength(1);
    expect(nav[0]!.replyCount).toBe(0);
  });

  it("treats a thread as resolved when the root is", () => {
    const nav = buildThreadNav([
      {
        entry: comment("root-1", { resolved_at: "2026-09-19T02:00:00Z" }),
        replies: [comment("reply-1")],
      },
    ]);
    expect(nav[0]!.resolved).toBe(true);
  });

  it("treats a thread as resolved when a reply carries the resolution", () => {
    const nav = buildThreadNav([
      {
        entry: comment("root-1"),
        replies: [
          comment("reply-1"),
          comment("reply-2", { resolved_at: "2026-09-19T02:00:00Z" }),
        ],
      },
    ]);
    expect(nav[0]!.resolved).toBe(true);
  });

  it("leaves an unsettled thread unresolved", () => {
    const nav = buildThreadNav([
      { entry: comment("root-1"), replies: [comment("reply-1")] },
    ]);
    expect(nav[0]!.resolved).toBe(false);
  });
});

describe("threadIndexAtRow", () => {
  const nav = buildThreadNav([
    { entry: activity("activity-1"), replies: [] },
    { entry: comment("root-1"), replies: [comment("reply-1")] },
    { entry: activity("activity-2"), replies: [] },
    dividerRow(),
    { entry: comment("root-2"), replies: [] },
  ]);
  // rowIndex: root-1 → 1, root-2 → 4

  it("reports no thread while the viewport top is above the first one", () => {
    expect(threadIndexAtRow(nav, 0)).toBe(-1);
  });

  it("resolves the thread whose root row is at the top", () => {
    expect(threadIndexAtRow(nav, 1)).toBe(0);
    expect(threadIndexAtRow(nav, 4)).toBe(1);
  });

  it("keeps an activity row between threads with the thread above it", () => {
    expect(threadIndexAtRow(nav, 2)).toBe(0);
  });

  it("keeps the unread divider with the thread above it", () => {
    expect(threadIndexAtRow(nav, 3)).toBe(0);
  });

  it("holds the last thread once the top is past every root", () => {
    expect(threadIndexAtRow(nav, 9)).toBe(1);
  });

  it("has nothing to report for an empty timeline", () => {
    expect(threadIndexAtRow([], 3)).toBe(-1);
  });
});

describe("threadPreview", () => {
  it("takes the first non-empty line of the comment", () => {
    expect(threadPreview(comment("root-1", { content: "\nShip it\n\nlater" })))
      .toBe("Ship it");
  });

  it("flattens markdown links so the row reads as prose", () => {
    expect(
      threadPreview(
        comment("root-1", {
          content: "[MUL-1](mention://issue/uuid) is the blocker",
        }),
      ),
    ).toBe("MUL-1 is the blocker");
  });

  it("names a deleted root the way its card does", () => {
    expect(
      threadPreview(comment("root-1", { deleted_at: "2026-09-19T01:00:00Z" })),
    ).toBe("This comment was deleted");
  });

  it("returns an empty string for a comment with no text", () => {
    expect(threadPreview(comment("root-1", { content: "" }))).toBe("");
  });
});
