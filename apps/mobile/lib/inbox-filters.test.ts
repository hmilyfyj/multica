import { describe, expect, it } from "vitest";
import type { InboxItem } from "@multica/core/types";
import {
  EMPTY_INBOX_FILTERS,
  filterInboxItems,
  inboxActorCounts,
  inboxActorKey,
  inboxActorKeyParts,
  inboxFacetItems,
  inboxFilterCount,
  inboxFiltersForPrioritySupport,
  inboxPriorityCounts,
  inboxPriorityFilterSupport,
  inboxStatusCounts,
  inboxUnreadCountOf,
  isEmptyInboxFilters,
  normalizeInboxFilters,
  type InboxFilters,
} from "./inbox-filters";

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: "inbox-1",
    workspace_id: "workspace-1",
    recipient_type: "member",
    recipient_id: "member-1",
    actor_type: "member",
    actor_id: "member-1",
    type: "new_comment",
    severity: "info",
    issue_id: "issue-1",
    title: "Issue title",
    body: null,
    issue_status: "in_progress",
    issue_priority: "high",
    read: false,
    archived: false,
    created_at: "2026-09-19T08:00:00Z",
    details: null,
    ...overrides,
  };
}

function filters(overrides: Partial<InboxFilters> = {}): InboxFilters {
  return { ...EMPTY_INBOX_FILTERS, ...overrides };
}

describe("filterInboxItems", () => {
  it("returns the list untouched while nothing is selected", () => {
    const items = [item(), item({ id: "inbox-2", read: true })];
    expect(isEmptyInboxFilters(EMPTY_INBOX_FILTERS)).toBe(true);
    expect(filterInboxItems(items, EMPTY_INBOX_FILTERS)).toBe(items);
  });

  it("ORs within a dimension and ANDs between dimensions", () => {
    const inProgress = item({ id: "a" });
    const inReview = item({ id: "b", issue_status: "in_review" });
    const doneRead = item({
      id: "c",
      issue_status: "done",
      read: true,
    });

    const statusOnly = filterInboxItems(
      [inProgress, inReview, doneRead],
      filters({ statuses: ["in_progress", "in_review"] }),
    );
    expect(statusOnly.map((i) => i.id)).toEqual(["a", "b"]);

    // Adding the read dimension narrows that same selection rather than
    // widening it.
    const andUnread = filterInboxItems(
      [inProgress, inReview, doneRead],
      filters({ statuses: ["in_progress", "in_review", "done"], unreadOnly: true }),
    );
    expect(andUnread.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("never matches a status selection on a row without one", () => {
    const systemNotice = item({
      id: "system-1",
      issue_id: null,
      issue_status: null,
    });
    expect(
      filterInboxItems([systemNotice], filters({ statuses: ["in_progress"] })),
    ).toEqual([]);
  });

  it("never matches a priority selection on a row without one", () => {
    const oldBackendRow = item({ id: "old", issue_priority: undefined });
    const noIssue = item({ id: "no-issue", issue_id: null, issue_priority: null });
    expect(
      filterInboxItems(
        [oldBackendRow, noIssue],
        filters({ priorities: ["high"] }),
      ),
    ).toEqual([]);
  });

  it("keeps every row that is not read when unreadOnly is on", () => {
    const unread = item({ id: "unread", read: false });
    const read = item({ id: "read", read: true });
    expect(
      filterInboxItems([unread, read], filters({ unreadOnly: true })).map(
        (i) => i.id,
      ),
    ).toEqual(["unread"]);
  });

  it("filters by actor using the rendered row's attribution", () => {
    const fromAlice = item({ id: "alice" });
    const fromAgent = item({
      id: "agent",
      actor_type: "agent",
      actor_id: "agent-7",
    });
    const system = item({
      id: "system",
      actor_type: "system",
      actor_id: null,
    });
    const unattributed = item({ id: "none", actor_type: null, actor_id: null });

    const items = [fromAlice, fromAgent, system, unattributed];
    expect(
      filterInboxItems(items, filters({ actors: ["member:member-1"] })).map(
        (i) => i.id,
      ),
    ).toEqual(["alice"]);
    expect(
      filterInboxItems(items, filters({ actors: ["system"] })).map((i) => i.id),
    ).toEqual(["system"]);
    // A row with no usable attribution can never match any actor selection.
    expect(
      filterInboxItems(items, filters({ actors: ["member:member-1", "system"] }))
        .map((i) => i.id),
    ).toEqual(["alice", "system"]);
  });
});

describe("inboxActorKey", () => {
  it("collapses every system notice into one bucket", () => {
    // The backend writes an invalid UUID for system actors, which serializes to
    // null — keying on the type alone is what keeps them from each becoming
    // their own unselectable option.
    expect(
      inboxActorKey(item({ actor_type: "system", actor_id: null })),
    ).toBe("system");
  });

  it("keys members and agents on their id, and refuses partial rows", () => {
    expect(inboxActorKey(item())).toBe("member:member-1");
    expect(
      inboxActorKey(item({ actor_type: "agent", actor_id: "agent-7" })),
    ).toBe("agent:agent-7");
    expect(inboxActorKey(item({ actor_type: null, actor_id: null }))).toBe(null);
    expect(
      inboxActorKey(item({ actor_type: "agent", actor_id: null })),
    ).toBe(null);
  });

  it("round-trips a key back to its parts", () => {
    expect(inboxActorKeyParts("member:member-1")).toEqual({
      type: "member",
      id: "member-1",
    });
    expect(inboxActorKeyParts("system")).toEqual({ type: "system", id: "" });
  });
});

describe("faceted counts", () => {
  const items = [
    item({ id: "a", issue_status: "in_progress", read: false }),
    item({ id: "b", issue_status: "in_progress", read: true }),
    item({ id: "c", issue_status: "done", read: false }),
    item({ id: "d", issue_status: null, issue_priority: null, read: false }),
  ];

  it("counts a dimension under the OTHER active dimensions", () => {
    // Selecting "done" must not flatten the status counts to the one value
    // already selected — each number says what selecting that value reveals.
    const faceted = inboxFacetItems(
      items,
      filters({ statuses: ["done"], unreadOnly: true }),
      "statuses",
    );
    // b is read, so unreadOnly already removes it; d has no status but is
    // unread, so it survives this dimension.
    expect(faceted.map((i) => i.id)).toEqual(["a", "c", "d"]);

    // ...while the dimension being counted ignores its own selection: the
    // statuses facet for the same filters keeps both statuses.
    expect(inboxStatusCounts(faceted)).toEqual(
      new Map([
        ["in_progress", 1],
        ["done", 1],
      ]),
    );
  });

  it("skips rows with no value for the counted dimension", () => {
    expect(inboxStatusCounts(items).has("in_progress")).toBe(true);
    expect(inboxStatusCounts(items).size).toBe(2);
    expect(inboxPriorityCounts([item({ issue_priority: null })]).size).toBe(0);
    expect(
      inboxActorCounts([item({ actor_type: null, actor_id: null })]).size,
    ).toBe(0);
  });

  it("counts unread rows the same way the list filters them", () => {
    expect(inboxUnreadCountOf(items)).toBe(3);
  });
});

describe("priority capability", () => {
  it("reads capability off the response, not off a version", () => {
    expect(inboxPriorityFilterSupport([])).toBe("unknown");
    expect(inboxPriorityFilterSupport([item()])).toBe("supported");
    expect(
      inboxPriorityFilterSupport([item(), item({ issue_priority: undefined })]),
    ).toBe("unsupported");
  });
  it("drops a priority selection from the rendered filters unless support is proven", () => {
    const selected = filters({ priorities: ["high"] });
    // "unknown" (an empty list) proves nothing, so the row filters on
    // everything rather than on a field the response may not carry.
    expect(
      inboxFiltersForPrioritySupport(selected, "unknown").priorities,
    ).toEqual([]);
    expect(inboxFiltersForPrioritySupport(selected, "supported")).toBe(selected);
    expect(
      inboxFiltersForPrioritySupport(selected, "unsupported").priorities,
    ).toEqual([]);
    // Nothing selected: the same object comes back in every case, so the memo
    // above it cannot churn.
    const empty = filters();
    expect(inboxFiltersForPrioritySupport(empty, "unsupported")).toBe(empty);
  });
});


describe("inboxFilterCount and normalizeInboxFilters", () => {
  it("counts selections across all four dimensions", () => {
    expect(inboxFilterCount(EMPTY_INBOX_FILTERS)).toBe(0);
    expect(
      inboxFilterCount(
        filters({
          statuses: ["done"],
          priorities: ["high", "low"],
          actors: ["system"],
          unreadOnly: true,
        }),
      ),
    ).toBe(5);
  });

  it("sorts the arrays so one selection maps to one cache key", () => {
    const normalized = normalizeInboxFilters(
      filters({
        statuses: ["in_review", "done"],
        priorities: ["low", "urgent"],
        actors: ["system", "member:member-1"],
        unreadOnly: true,
      }),
    );
    expect(normalized).toEqual({
      statuses: ["done", "in_review"],
      priorities: ["low", "urgent"],
      actors: ["member:member-1", "system"],
      unreadOnly: true,
    });
  });
});
