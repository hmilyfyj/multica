import { describe, expect, it, vi } from "vitest";

import {
  autopilotDetailOptions,
  autopilotKeys,
  autopilotListOptions,
  autopilotRunsOptions,
} from "./autopilots";

vi.mock("@/data/api", () => ({ api: {} }));

describe("autopilotKeys", () => {
  it("nests every entry under the workspace prefix so one invalidation covers the feature", () => {
    const prefix = autopilotKeys.all("ws-1");

    expect(autopilotKeys.list("ws-1").slice(0, prefix.length)).toEqual([
      ...prefix,
    ]);
    expect(
      autopilotDetailOptions("ws-1", "ap-1").queryKey.slice(0, prefix.length),
    ).toEqual([...prefix]);
    expect(
      autopilotRunsOptions("ws-1", "ap-1").queryKey.slice(0, prefix.length),
    ).toEqual([...prefix]);
  });

  it("separates workspaces and autopilots", () => {
    expect(autopilotRunsOptions("ws-1", "ap-1").queryKey).not.toEqual(
      autopilotRunsOptions("ws-1", "ap-2").queryKey,
    );
    expect(autopilotListOptions("ws-1").queryKey).not.toEqual(
      autopilotListOptions("ws-2").queryKey,
    );
  });
});

describe("autopilot query enablement", () => {
  it("stays disabled without a workspace, and without an id for the record queries", () => {
    expect(autopilotListOptions("ws-1").enabled).toBe(true);
    expect(autopilotListOptions(null).enabled).toBe(false);

    expect(autopilotDetailOptions("ws-1", "ap-1").enabled).toBe(true);
    expect(autopilotDetailOptions(null, "ap-1").enabled).toBe(false);
    expect(autopilotDetailOptions("ws-1", "").enabled).toBe(false);

    expect(autopilotRunsOptions("ws-1", "ap-1").enabled).toBe(true);
    expect(autopilotRunsOptions(null, "ap-1").enabled).toBe(false);
    expect(autopilotRunsOptions("ws-1", "").enabled).toBe(false);
  });
});
