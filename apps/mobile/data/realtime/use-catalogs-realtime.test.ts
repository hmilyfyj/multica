import { beforeEach, describe, expect, it, vi } from "vitest";

type EventHandler = (payload: unknown) => void;

/** Minimal transport double: records each subscription, replays payloads. */
interface MockWS {
  on: (event: string, handler: EventHandler) => () => void;
  onReconnect: (handler: () => void) => () => void;
}

const { invalidateQueries, subscriptionSetups } = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  subscriptionSetups: [] as Array<
    (ws: MockWS, wsId: string) => Array<() => void>
  >,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
  // The key factories under test are `queryOptions(...)` calls; keep them
  // usable without booting the real query machinery.
  queryOptions: (options: unknown) => options,
}));

vi.mock("@/lib/use-ws-subscriptions", () => ({
  useWSSubscriptions: (
    setup: (ws: MockWS, wsId: string) => Array<() => void>,
  ) => {
    subscriptionSetups.push(setup);
  },
}));

vi.mock("@/data/api", () => ({ api: {} }));

import { useCatalogsRealtime } from "./use-catalogs-realtime";

/** Mount one hook instance and hand back dispatchers for its handlers. */
function mount(wsId = "workspace-1") {
  subscriptionSetups.length = 0;
  useCatalogsRealtime();
  expect(subscriptionSetups).toHaveLength(1);

  const handlers = new Map<string, EventHandler>();
  let reconnect: (() => void) | undefined;
  const ws: MockWS = {
    on: (event, handler) => {
      handlers.set(event, handler);
      return () => {};
    },
    onReconnect: (handler) => {
      reconnect = handler;
      return () => {};
    },
  };
  subscriptionSetups[0](ws, wsId);

  return {
    invalidatedKeys: () =>
      invalidateQueries.mock.calls.map(([query]) => query.queryKey),
    dispatch: (event: string, payload: unknown = {}) => {
      const handler = handlers.get(event);
      if (!handler) throw new Error(`${event} is not subscribed`);
      handler(payload);
    },
    reconnect: () => reconnect?.(),
  };
}

describe("useCatalogsRealtime", () => {
  beforeEach(() => {
    invalidateQueries.mockReset();
  });

  it("refreshes the squad list, and the issues too when a squad is deleted", () => {
    const { dispatch, invalidatedKeys } = mount();

    dispatch("squad:created");
    expect(invalidatedKeys()).toEqual([["squads", "workspace-1"]]);

    invalidateQueries.mockClear();
    dispatch("squad:updated");
    expect(invalidatedKeys()).toEqual([["squads", "workspace-1"]]);

    invalidateQueries.mockClear();
    // Deletion transfers the squad's issues to another assignee.
    dispatch("squad:deleted");
    expect(invalidatedKeys()).toEqual([
      ["squads", "workspace-1"],
      ["issues", "workspace-1"],
    ]);
  });

  it("refreshes the label catalog and the issue caches that inline it", () => {
    for (const event of ["label:created", "label:updated", "label:deleted"]) {
      const { dispatch, invalidatedKeys } = mount();
      invalidateQueries.mockClear();
      dispatch(event);

      // Issue detail renders issue.labels inline; agents/skills are not
      // refreshed because mobile shows no labels there.
      expect(invalidatedKeys()).toEqual([
        ["labels", "workspace-1"],
        ["issues", "workspace-1"],
      ]);
    }
  });

  it("refreshes only the status catalog, leaving issue caches alone", () => {
    const { dispatch, invalidatedKeys } = mount();

    dispatch("issue_status:changed", { action: "updated" });

    expect(invalidatedKeys()).toEqual([["issue-statuses", "workspace-1"]]);
  });

  it("refreshes every catalog on reconnect", () => {
    const { reconnect, invalidatedKeys } = mount();

    reconnect();

    expect(invalidatedKeys()).toEqual([
      ["squads", "workspace-1"],
      ["labels", "workspace-1"],
      ["issue-statuses", "workspace-1"],
    ]);
  });
});
