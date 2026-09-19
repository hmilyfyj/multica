import { describe, expect, it, vi } from "vitest";
import type { Agent } from "@multica/core/types";

import { agentListOptions, agentTasksOptions } from "./agents";

vi.mock("@/data/api", () => ({ api: {} }));

describe("agentListOptions", () => {
  it("polls only while projected runtime availability can age offline", () => {
    const options = agentListOptions("ws-1");
    const interval = options.refetchInterval;
    expect(typeof interval).toBe("function");
    if (typeof interval !== "function") return;

    const queryState = (data: Agent[]) =>
      interval({ state: { status: "success", data } } as never);

    expect(queryState([{ runtime_availability: "online" } as Agent])).toBe(30_000);
    expect(queryState([{ runtime_availability: "unstable" } as Agent])).toBe(30_000);
    expect(queryState([{ runtime_availability: "offline" } as Agent])).toBe(false);
    expect(queryState([{ runtime_availability: undefined } as Agent])).toBe(false);
    expect(
      queryState([
        {
          archived_at: "2026-09-04T00:00:00Z",
          runtime_availability: "online",
        } as Agent,
      ]),
    ).toBe(false);
    expect(queryState([])).toBe(false);
  });
});


describe("agentTasksOptions", () => {
  it("nests the per-agent key under the roster key so agent:* invalidations reach it", () => {
    const rosterKey = agentListOptions("ws-1").queryKey;
    const tasksKey = agentTasksOptions("ws-1", "agent-1").queryKey;

    expect(tasksKey.slice(0, rosterKey.length)).toEqual([...rosterKey]);
    expect(tasksKey).not.toEqual(
      agentTasksOptions("ws-1", "agent-2").queryKey,
    );
  });

  it("stays disabled without both a workspace and an agent", () => {
    expect(agentTasksOptions("ws-1", "agent-1").enabled).toBe(true);
    expect(agentTasksOptions(null, "agent-1").enabled).toBe(false);
    expect(agentTasksOptions("ws-1", "").enabled).toBe(false);
  });
});