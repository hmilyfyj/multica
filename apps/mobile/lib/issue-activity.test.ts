import { describe, expect, it } from "vitest";
import type { AgentTask } from "@multica/core/types";
import {
  AGENT_ACTIVITY_LABEL,
  deriveIssueAgentActivity,
} from "./issue-activity";

function task(overrides: Partial<AgentTask>): AgentTask {
  return {
    id: "task-1",
    agent_id: "agent-1",
    runtime_id: "runtime-1",
    issue_id: "issue-1",
    status: "running",
    priority: 0,
    dispatched_at: null,
    started_at: null,
    completed_at: null,
    result: null,
    error: null,
    created_at: "2026-09-19T00:00:00Z",
    ...overrides,
  };
}

describe("deriveIssueAgentActivity", () => {
  it("reads a running task as working, with the agent on the stack", () => {
    const activity = deriveIssueAgentActivity(
      [task({ status: "running", agent_id: "agent-7" })],
      "issue-1",
    );

    expect(activity).toEqual({ kind: "running", agentIds: ["agent-7"] });
    expect(AGENT_ACTIVITY_LABEL[activity!.kind]).toBe("Working");
  });

  it.each([
    "queued",
    "dispatched",
    "waiting_local_directory",
  ] as const)("buckets %s as queued, the same state as queued", (status) => {
    const activity = deriveIssueAgentActivity(
      [task({ status, agent_id: "agent-3" })],
      "issue-1",
    );

    expect(activity).toEqual({ kind: "queued", agentIds: ["agent-3"] });
    expect(AGENT_ACTIVITY_LABEL[activity!.kind]).toBe("Queued");
  });

  it("prefers the running agent over queued ones", () => {
    const activity = deriveIssueAgentActivity(
      [
        task({ id: "t-queued", status: "queued", agent_id: "agent-queued" }),
        task({ id: "t-running", status: "running", agent_id: "agent-live" }),
      ],
      "issue-1",
    );

    expect(activity).toEqual({ kind: "running", agentIds: ["agent-live"] });
  });

  it.each(["completed", "failed", "cancelled"] as const)(
    "ignores %s — the snapshot's last-activity half keeps an issue_id",
    (status) => {
      expect(
        deriveIssueAgentActivity([task({ status })], "issue-1"),
      ).toBeNull();
    },
  );

  it("keeps showing the live run when the issue also has finished ones", () => {
    const activity = deriveIssueAgentActivity(
      [
        task({ id: "t-done", status: "completed" }),
        task({ id: "t-live", status: "running", agent_id: "agent-live" }),
      ],
      "issue-1",
    );

    expect(activity).toEqual({ kind: "running", agentIds: ["agent-live"] });
  });

  it("ignores tasks belonging to another issue", () => {
    expect(
      deriveIssueAgentActivity(
        [task({ issue_id: "issue-2", status: "running" })],
        "issue-1",
      ),
    ).toBeNull();
  });

  it.each([null, undefined, ""])(
    "renders nothing for an item with no issue (%s)",
    (issueId) => {
      expect(
        deriveIssueAgentActivity([task({ status: "running" })], issueId),
      ).toBeNull();
    },
  );

  it("lists each agent once and stops the stack at three", () => {
    const activity = deriveIssueAgentActivity(
      [
        task({ id: "t-1", status: "queued", agent_id: "agent-1" }),
        task({ id: "t-2", status: "dispatched", agent_id: "agent-2" }),
        task({ id: "t-3", status: "queued", agent_id: "agent-1" }),
        task({ id: "t-4", status: "queued", agent_id: "agent-3" }),
        task({ id: "t-5", status: "queued", agent_id: "agent-4" }),
      ],
      "issue-1",
    );

    expect(activity).toEqual({
      kind: "queued",
      agentIds: ["agent-1", "agent-2", "agent-3"],
    });
  });
});
