import { QueryClient } from "@tanstack/react-query";
import type * as ReactQuery from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CancelTaskResponse,
  ChatMessage,
  ChatPendingTask,
  ChatSession,
} from "@multica/core/types";
import { api } from "@/data/api";
import { chatKeys } from "@/data/queries/chat";
import { useCancelChatTask, useRenameChatSession } from "./chat";

const state = vi.hoisted(() => ({
  qc: undefined as unknown as QueryClient,
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactQuery>();
  return {
    ...actual,
    // Drive the hooks through a real MutationObserver so the test runs the
    // same mutate → onMutate → onSettled lifecycle as the app.
    useQueryClient: () => state.qc,
    useMutation: (
      options: ConstructorParameters<typeof actual.MutationObserver>[1],
    ) => {
      const observer = new actual.MutationObserver(state.qc, options);
      return {
        mutateAsync: (variables: unknown) => observer.mutate(variables),
      };
    },
  };
});

vi.mock("@/data/api", () => ({
  api: {
    cancelChatTask: vi.fn(),
    updateChatSession: vi.fn(),
  },
}));

vi.mock("@/data/workspace-store", () => ({
  useWorkspaceStore: (
    selector: (s: { currentWorkspaceId: string }) => unknown,
  ) => selector({ currentWorkspaceId: "workspace-1" }),
}));

const wsId = "workspace-1";
const sessionId = "session-1";
const sessionsKey = chatKeys.sessions(wsId);
const messagesKey = chatKeys.messages(sessionId);
const pendingKey = chatKeys.pendingTask(sessionId);

function session(id: string, overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id,
    workspace_id: wsId,
    agent_id: "agent-1",
    creator_id: "user-1",
    title: "New chat",
    status: "active",
    has_unread: false,
    created_at: "2026-09-19T00:00:00Z",
    updated_at: "2026-09-19T00:00:00Z",
    ...overrides,
  };
}

function message(id: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    chat_session_id: sessionId,
    role: "user",
    content: "deploy the thing",
    task_id: "task-1",
    created_at: "2026-09-19T00:00:00Z",
    ...overrides,
  };
}

const running: ChatPendingTask = {
  task_id: "task-1",
  status: "running",
  created_at: "2026-09-19T00:00:00Z",
};

beforeEach(() => {
  state.qc = new QueryClient();
  vi.resetAllMocks();
  vi.mocked(api.updateChatSession).mockResolvedValue(undefined);
});

describe("useCancelChatTask", () => {
  // The status line and the Stop button both key off this cache, so the tap
  // has to clear it before the round trip — otherwise the UI keeps saying
  // "Thinking" for a task the user just stopped.
  it("clears the pending task before the server answers", async () => {
    state.qc.setQueryData<ChatPendingTask>(pendingKey, running);
    let seenDuringRequest: ChatPendingTask | undefined;
    vi.mocked(api.cancelChatTask).mockImplementation(async () => {
      seenDuringRequest = state.qc.getQueryData<ChatPendingTask>(pendingKey);
      return { id: "task-1" } as CancelTaskResponse;
    });

    await useCancelChatTask().mutateAsync({ taskId: "task-1", sessionId });

    // `{}` is the cache's "no in-flight task" shape, and `task_id` is what the
    // screen's status line reads.
    expect(seenDuringRequest?.task_id).toBeUndefined();
  });

  // The server deletes the cancelled prompt in the same transaction that
  // produced this response. Leaving the row in the cache shows the user a
  // message they no longer have until the settle refetch lands.
  it("prunes the cancelled prompt and keeps the rest of the transcript", async () => {
    state.qc.setQueryData<ChatMessage[]>(messagesKey, [
      message("message-1"),
      message("message-2", { id: "message-2", role: "assistant" }),
    ]);
    vi.mocked(api.cancelChatTask).mockResolvedValue({
      id: "task-1",
      cancelled_chat_message: {
        chat_session_id: sessionId,
        message_id: "message-1",
        content: "deploy the thing",
        restore_to_input: true,
      },
    } as CancelTaskResponse);

    await useCancelChatTask().mutateAsync({ taskId: "task-1", sessionId });

    expect(
      state.qc.getQueryData<ChatMessage[]>(messagesKey)?.map((m) => m.id),
    ).toEqual(["message-2"]);
  });

  // The caller is what puts the prompt back in the composer, and it can only
  // do that from the resolved response.
  it("hands the restorable prompt back to the caller", async () => {
    vi.mocked(api.cancelChatTask).mockResolvedValue({
      id: "task-1",
      cancelled_chat_message: {
        chat_session_id: sessionId,
        message_id: "message-1",
        content: "deploy the thing",
        restore_to_input: true,
      },
    } as CancelTaskResponse);

    const result = await useCancelChatTask().mutateAsync({
      taskId: "task-1",
      sessionId,
    });

    expect(result.cancelled_chat_message?.content).toBe("deploy the thing");
  });

  // A cancel can fail because the task already finished (404/409) or because
  // the phone is offline. The task the server still reports has to come back
  // rather than vanish from the UI forever.
  it("puts the pending task back when the cancel fails", async () => {
    state.qc.setQueryData<ChatPendingTask>(pendingKey, running);
    vi.mocked(api.cancelChatTask).mockRejectedValue(new Error("task not found"));

    await expect(
      useCancelChatTask().mutateAsync({ taskId: "task-1", sessionId }),
    ).rejects.toThrow("task not found");

    expect(state.qc.getQueryData<ChatPendingTask>(pendingKey)).toEqual(running);
  });
});

describe("useRenameChatSession", () => {
  it("shows the new title before the server answers", async () => {
    state.qc.setQueryData<ChatSession[]>(sessionsKey, [
      session(sessionId),
      session("session-2", { title: "Other chat" }),
    ]);
    let seenDuringRequest: ChatSession[] | undefined;
    vi.mocked(api.updateChatSession).mockImplementation(async () => {
      seenDuringRequest = state.qc.getQueryData<ChatSession[]>(sessionsKey);
    });

    await useRenameChatSession().mutateAsync({
      sessionId,
      title: "Deploy investigation",
    });

    expect(seenDuringRequest?.map((s) => s.title)).toEqual([
      "Deploy investigation",
      "Other chat",
    ]);
  });

  it("rolls the title back when the server refuses it", async () => {
    state.qc.setQueryData<ChatSession[]>(sessionsKey, [session(sessionId)]);
    vi.mocked(api.updateChatSession).mockRejectedValue(new Error("title taken"));

    await expect(
      useRenameChatSession().mutateAsync({ sessionId, title: "Taken" }),
    ).rejects.toThrow("title taken");

    expect(state.qc.getQueryData<ChatSession[]>(sessionsKey)?.[0]?.title).toBe(
      "New chat",
    );
  });

  // Seeding an unfetched list would show a one-row sheet until the first
  // fetch resolved, which reads as "every other chat disappeared".
  it("does not invent a session list that was never fetched", async () => {
    await useRenameChatSession().mutateAsync({ sessionId, title: "Renamed" });

    expect(state.qc.getQueryData(sessionsKey)).toBeUndefined();
  });
});
