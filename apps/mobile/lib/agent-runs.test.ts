import { describe, expect, it } from "vitest";
import type { AgentTask } from "@multica/core/types";

import {
  isActiveTask,
  latestActivityAt,
  runDurationLabel,
  runDurationMs,
  sortByRecentActivity,
  splitAgentTasks,
} from "./agent-runs";

const NOW = Date.parse("2026-09-19T12:00:00.000Z");

function task(overrides: Partial<AgentTask>): AgentTask {
  return {
    id: "t1",
    agent_id: "a1",
    runtime_id: "r1",
    issue_id: "",
    status: "completed",
    priority: 0,
    dispatched_at: null,
    started_at: null,
    completed_at: null,
    result: null,
    error: null,
    created_at: "2026-09-19T10:00:00.000Z",
    ...overrides,
  } as AgentTask;
}

describe("isActiveTask", () => {
  it("treats every non-terminal status as active, including the local-directory hold", () => {
    expect(isActiveTask(task({ status: "queued" }))).toBe(true);
    expect(isActiveTask(task({ status: "dispatched" }))).toBe(true);
    expect(isActiveTask(task({ status: "running" }))).toBe(true);
    expect(isActiveTask(task({ status: "waiting_local_directory" }))).toBe(true);
    expect(isActiveTask(task({ status: "completed" }))).toBe(false);
    expect(isActiveTask(task({ status: "failed" }))).toBe(false);
    expect(isActiveTask(task({ status: "cancelled" }))).toBe(false);
  });
});

describe("splitAgentTasks", () => {
  it("buckets by terminal state and orders active by newest trigger", () => {
    const older = task({
      id: "older",
      status: "running",
      created_at: "2026-09-19T09:00:00.000Z",
    });
    const newer = task({
      id: "newer",
      status: "queued",
      created_at: "2026-09-19T11:00:00.000Z",
    });
    const done = task({ id: "done", status: "completed" });

    const { active, past } = splitAgentTasks([older, done, newer]);

    expect(active.map((t) => t.id)).toEqual(["newer", "older"]);
    expect(past.map((t) => t.id)).toEqual(["done"]);
  });

  it("orders past by completion time, then by how much attention the status needs", () => {
    const olderDone = task({
      id: "olderDone",
      status: "completed",
      completed_at: "2026-09-19T08:00:00.000Z",
    });
    const newerDone = task({
      id: "newerDone",
      status: "completed",
      completed_at: "2026-09-19T10:00:00.000Z",
    });
    const sameStampCancelled = task({
      id: "cancelled",
      status: "cancelled",
      completed_at: "2026-09-19T10:00:00.000Z",
    });
    const sameStampFailed = task({
      id: "failed",
      status: "failed",
      completed_at: "2026-09-19T10:00:00.000Z",
    });

    const { past } = splitAgentTasks([
      olderDone,
      newerDone,
      sameStampCancelled,
      sameStampFailed,
    ]);

    expect(past.map((t) => t.id)).toEqual([
      "failed",
      "cancelled",
      "newerDone",
      "olderDone",
    ]);
  });
});

describe("latestActivityAt", () => {
  it("counts a running task as activity now and a finished one at its completion", () => {
    expect(
      latestActivityAt([
        task({
          status: "completed",
          created_at: "2026-09-19T07:00:00.000Z",
          completed_at: "2026-09-19T09:30:00.000Z",
        }),
        task({ status: "running", created_at: "2026-09-19T09:00:00.000Z" }),
      ]),
    ).toBe("2026-09-19T09:30:00.000Z");
  });

  it("returns null for an agent with no visible history", () => {
    expect(latestActivityAt([])).toBeNull();
  });
});

describe("runDurationMs", () => {
  it("measures a finished run from start to completion", () => {
    expect(
      runDurationMs(
        task({
          status: "completed",
          started_at: "2026-09-19T10:00:00.000Z",
          completed_at: "2026-09-19T10:02:04.000Z",
        }),
        NOW,
      ),
    ).toBe(124_000);
  });

  it("measures a live run up to now", () => {
    expect(
      runDurationMs(
        task({
          status: "running",
          started_at: "2026-09-19T11:59:00.000Z",
        }),
        NOW,
      ),
    ).toBe(60_000);
  });

  it("falls back to created_at when the daemon never stamped started_at", () => {
    expect(
      runDurationMs(
        task({
          status: "failed",
          created_at: "2026-09-19T09:00:00.000Z",
          completed_at: "2026-09-19T09:00:30.000Z",
        }),
        NOW,
      ),
    ).toBe(30_000);
  });

  it("refuses to invent a duration for a terminal run with no completion stamp", () => {
    expect(
      runDurationMs(
        task({ status: "completed", started_at: "2026-09-19T10:00:00.000Z" }),
        NOW,
      ),
    ).toBeUndefined();
  });
});

describe("runDurationLabel", () => {
  it("renders minutes and seconds the way every other elapsed caption does", () => {
    expect(
      runDurationLabel(
        task({
          status: "completed",
          started_at: "2026-09-19T10:00:00.000Z",
          completed_at: "2026-09-19T10:02:04.000Z",
        }),
        NOW,
      ),
    ).toBe("2m 4s");
  });

  it("renders nothing when the duration is unknown", () => {
    expect(runDurationLabel(task({ status: "completed" }), NOW)).toBeUndefined();
  });
});

describe("sortByRecentActivity", () => {
  it("puts the most recent activity first and never-active agents last", () => {
    const sorted = sortByRecentActivity([
      { name: "Zoe", lastActivityAt: null },
      { name: "Ada", lastActivityAt: "2026-09-19T09:00:00.000Z" },
      { name: "Bo", lastActivityAt: "2026-09-19T11:00:00.000Z" },
      { name: "Cid", lastActivityAt: null },
    ]);

    expect(sorted.map((r) => r.name)).toEqual(["Bo", "Ada", "Cid", "Zoe"]);
  });
});
