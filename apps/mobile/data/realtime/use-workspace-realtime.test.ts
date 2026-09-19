import { beforeEach, describe, expect, it, vi } from "vitest";

type EventHandler = (payload: unknown) => void;

/** Minimal transport double: records each subscription, replays payloads. */
interface MockWS {
  on: (event: string, handler: EventHandler) => () => void;
  onReconnect: (handler: () => void) => () => void;
}

const { invalidateQueries, subscriptionSetups, auth } = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  subscriptionSetups: [] as Array<
    (ws: MockWS, wsId: string) => Array<() => void>
  >,
  // Mutable so a test can act as the signed-in user or as somebody else.
  auth: { userId: "me" as string | null },
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

vi.mock("@/data/auth-store", () => ({
  useAuthStore: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector(auth.userId ? { user: { id: auth.userId } } : { user: null }),
}));

import { useWorkspaceRealtime } from "./use-workspace-realtime";

/** Mount one hook instance and hand back dispatchers for its handlers. */
function mount(wsId = "workspace-1") {
  subscriptionSetups.length = 0;
  useWorkspaceRealtime();
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

describe("useWorkspaceRealtime", () => {
  beforeEach(() => {
    invalidateQueries.mockReset();
    auth.userId = "me";
  });

  it("refreshes the workspace list on update and delete", () => {
    const { dispatch, invalidatedKeys } = mount();

    dispatch("workspace:updated", { workspace: { id: "w1" } });
    expect(invalidatedKeys()).toEqual([["workspaces"]]);

    invalidateQueries.mockClear();
    dispatch("workspace:deleted", { workspace_id: "w1" });
    expect(invalidatedKeys()).toEqual([["workspaces"]]);
  });

  it("refreshes the member list for other members' churn", () => {
    const { dispatch, invalidatedKeys } = mount();

    dispatch("member:updated", { member: { user_id: "someone-else" } });
    expect(invalidatedKeys()).toEqual([["members", "workspace-1"]]);

    invalidateQueries.mockClear();
    dispatch("member:added", {
      member: { user_id: "someone-else" },
      workspace_id: "workspace-1",
    });
    expect(invalidatedKeys()).toEqual([["members", "workspace-1"]]);

    invalidateQueries.mockClear();
    dispatch("member:removed", {
      member_id: "m1",
      user_id: "someone-else",
      workspace_id: "workspace-1",
    });
    expect(invalidatedKeys()).toEqual([["members", "workspace-1"]]);
  });

  it("refreshes the workspace list too when the membership is mine", () => {
    const { dispatch, invalidatedKeys } = mount();

    // Joining a workspace elsewhere (the server emits member:added before
    // invitation:accepted) must surface it in the switcher.
    dispatch("member:added", {
      member: { user_id: "me" },
      workspace_id: "workspace-1",
    });
    expect(invalidatedKeys()).toEqual([
      ["members", "workspace-1"],
      ["workspaces"],
    ]);

    invalidateQueries.mockClear();
    // Being removed is what lets the workspace layout redirect out.
    dispatch("member:removed", {
      member_id: "m1",
      user_id: "me",
      workspace_id: "workspace-1",
    });
    expect(invalidatedKeys()).toEqual([
      ["members", "workspace-1"],
      ["workspaces"],
    ]);
  });

  it("refreshes both keys on reconnect", () => {
    const { reconnect, invalidatedKeys } = mount();

    reconnect();

    expect(invalidatedKeys()).toEqual([
      ["members", "workspace-1"],
      ["workspaces"],
    ]);
  });
});
