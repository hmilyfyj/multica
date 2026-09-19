import { beforeEach, describe, expect, it } from "vitest";
import { useInboxViewStore } from "./inbox-view-store";

/**
 * The store is small, but two of its decisions are load-bearing for the
 * parity rules the screen depends on:
 *
 *   1. `clearPriorityFilters` must not take other dimensions down with it —
 *      it exists for the capability guard (a backend that stops reporting
 *      issue_priority), and dropping a status/actor/unread selection the user
 *      made would silently widen the list.
 *   2. `view` is not a filter: clearing filters from inside the archived
 *      sub-view must leave the user in the archive (web's clear does not touch
 *      the URL either).
 */
const store = () => useInboxViewStore.getState();

beforeEach(() => {
  useInboxViewStore.setState({
    view: "inbox",
    statuses: [],
    priorities: [],
    actors: [],
    unreadOnly: false,
  });
});

describe("inbox view store", () => {
  it("toggles each dimension on and off", () => {
    store().toggleStatusFilter("in_progress");
    store().toggleStatusFilter("done");
    store().toggleStatusFilter("in_progress");
    store().togglePriorityFilter("high");
    store().toggleActorFilter("member:member-1");
    store().toggleUnreadOnly();

    expect(store().statuses).toEqual(["done"]);
    expect(store().priorities).toEqual(["high"]);
    expect(store().actors).toEqual(["member:member-1"]);
    expect(store().unreadOnly).toBe(true);

    store().togglePriorityFilter("high");
    store().toggleActorFilter("member:member-1");
    store().toggleUnreadOnly();
    expect(store().priorities).toEqual([]);
    expect(store().actors).toEqual([]);
    expect(store().unreadOnly).toBe(false);
  });

  it("clears only the priority dimension when asked for that", () => {
    store().toggleStatusFilter("done");
    store().togglePriorityFilter("high");
    store().toggleActorFilter("system");
    store().toggleUnreadOnly();

    store().clearPriorityFilters();

    expect(store().priorities).toEqual([]);
    expect(store().statuses).toEqual(["done"]);
    expect(store().actors).toEqual(["system"]);
    expect(store().unreadOnly).toBe(true);
  });

  it("clears every dimension but keeps the view", () => {
    store().setView("archived");
    store().toggleStatusFilter("done");
    store().togglePriorityFilter("high");
    store().toggleActorFilter("system");
    store().toggleUnreadOnly();

    store().clearFilters();

    expect(store().statuses).toEqual([]);
    expect(store().priorities).toEqual([]);
    expect(store().actors).toEqual([]);
    expect(store().unreadOnly).toBe(false);
    expect(store().view).toBe("archived");
  });

  it("keeps the filters when switching lists", () => {
    store().toggleUnreadOnly();
    store().setView("archived");
    expect(store().unreadOnly).toBe(true);
    store().setView("inbox");
    expect(store().unreadOnly).toBe(true);
  });
});
