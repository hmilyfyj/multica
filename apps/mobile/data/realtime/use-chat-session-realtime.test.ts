import { beforeEach, describe, expect, it, vi } from "vitest";

type EventHandler = (payload: unknown) => void;

/** Minimal transport double: records each subscription, replays payloads. */
interface MockWS {
  on: (event: string, handler: EventHandler) => () => void;
  onReconnect: (handler: () => void) => () => void;
}

const { invalidateQueries, setQueryData, subscriptionSetups } = vi.hoisted(
  () => ({
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
    subscriptionSetups: [] as Array<
      (ws: MockWS, wsId: string) => Array<() => void>
    >,
  }),
);

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries, setQueryData }),
}));

vi.mock("@/lib/use-ws-subscriptions", () => ({
  useWSSubscriptions: (
    setup: (ws: MockWS, wsId: string) => Array<() => void>,
  ) => {
    subscriptionSetups.push(setup);
  },
}));

vi.mock("@/data/api", () => ({ api: {} }));

import { chatKeys } from "@/data/queries/chat";
import { useChatSessionRealtime } from "./use-chat-session-realtime";

function mount(sessionId = "session-1") {
  subscriptionSetups.length = 0;
  useChatSessionRealtime(sessionId);
  expect(subscriptionSetups).toHaveLength(1);

  const handlers = new Map<string, EventHandler>();
  const ws: MockWS = {
    on: (event, handler) => {
      handlers.set(event, handler);
      return () => {};
    },
    onReconnect: () => () => {},
  };
  subscriptionSetups[0](ws, "workspace-1");

  return {
    invalidatedKeys: () =>
      invalidateQueries.mock.calls.map(([query]) => query.queryKey),
    dispatch: (event: string, payload: unknown) => {
      const handler = handlers.get(event);
      if (!handler) throw new Error(`${event} is not subscribed`);
      handler(payload);
    },
  };
}

describe("useChatSessionRealtime — parked-task and cancellation frames", () => {
  beforeEach(() => {
    invalidateQueries.mockReset();
  });

  it("refreshes pendingTask when a task parks on a busy directory and resumes", () => {
    const { dispatch, invalidatedKeys } = mount();

    dispatch("task:waiting_local_directory", {
      task_id: "t1",
      chat_session_id: "session-1",
      status: "waiting_local_directory",
    });
    expect(invalidatedKeys()).toEqual([
      chatKeys.pendingTask("session-1"),
    ]);

    invalidateQueries.mockClear();
    dispatch("task:running", {
      task_id: "t1",
      chat_session_id: "session-1",
      status: "running",
    });
    expect(invalidatedKeys()).toEqual([
      chatKeys.pendingTask("session-1"),
    ]);
  });

  it("ignores those frames for another session", () => {
    const { dispatch, invalidatedKeys } = mount();

    dispatch("task:running", {
      task_id: "t1",
      chat_session_id: "session-2",
      status: "running",
    });

    expect(invalidatedKeys()).toEqual([]);
  });

  it("refreshes messages only when the cancellation settled as stopped", () => {
    const { dispatch, invalidatedKeys } = mount();

    dispatch("chat:cancel_finalized", {
      outcome: "restored",
      chat_session_id: "session-1",
      task_id: "t1",
    });
    expect(invalidatedKeys()).toEqual([
      chatKeys.pendingTask("session-1"),
    ]);

    invalidateQueries.mockClear();
    // `stopped` persists a "Stopped." assistant row.
    dispatch("chat:cancel_finalized", {
      outcome: "stopped",
      chat_session_id: "session-1",
      task_id: "t1",
    });
    expect(invalidatedKeys()).toEqual([
      chatKeys.pendingTask("session-1"),
      chatKeys.messages("session-1"),
    ]);
  });
});
