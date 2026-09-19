import { describe, expect, it, vi } from "vitest";

import { runtimeListOptions, runtimeUsageKeys, runtimeUsageOptions } from "./runtimes";

vi.mock("@/data/api", () => ({ api: {} }));

describe("runtimeKeys", () => {
  it("keeps the roster on the key the presence realtime invalidates", () => {
    // data/realtime/use-presence-realtime.ts hardcodes ["runtimes", wsId] and
    // its test asserts that exact key. Renaming the roster key would leave the
    // presence dot refetching a cache nothing reads.
    expect(runtimeListOptions("ws-1").queryKey).toEqual(["runtimes", "ws-1"]);
  });

  it("keeps usage off that prefix, so a heartbeat never refetches a usage rollup", () => {
    const prefix = runtimeListOptions("ws-1").queryKey;
    expect(
      runtimeUsageOptions("ws-1", "rt-1", 30).queryKey.slice(0, prefix.length),
    ).not.toEqual([...prefix]);
    expect(runtimeUsageKeys.all("ws-1")).toEqual(["runtime-usage", "ws-1"]);
  });

  it("separates workspaces, runtimes and windows", () => {
    expect(runtimeUsageOptions("ws-1", "rt-1", 30).queryKey).not.toEqual(
      runtimeUsageOptions("ws-2", "rt-1", 30).queryKey,
    );
    expect(runtimeUsageOptions("ws-1", "rt-1", 30).queryKey).not.toEqual(
      runtimeUsageOptions("ws-1", "rt-2", 30).queryKey,
    );
    expect(runtimeUsageOptions("ws-1", "rt-1", 30).queryKey).not.toEqual(
      runtimeUsageOptions("ws-1", "rt-1", 90).queryKey,
    );
  });
});

describe("runtime query enablement", () => {
  it("needs a workspace, and an id for the usage rollup", () => {
    expect(runtimeListOptions("ws-1").enabled).toBe(true);
    expect(runtimeListOptions(null).enabled).toBe(false);

    expect(runtimeUsageOptions("ws-1", "rt-1", 30).enabled).toBe(true);
    expect(runtimeUsageOptions(null, "rt-1", 30).enabled).toBe(false);
    expect(runtimeUsageOptions("ws-1", "", 30).enabled).toBe(false);
  });
});
