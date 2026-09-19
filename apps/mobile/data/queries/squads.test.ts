import { describe, expect, it, vi } from "vitest";

import {
  squadDetailOptions,
  squadKeys,
  squadListOptions,
  squadMembersOptions,
} from "./squads";

vi.mock("@/data/api", () => ({ api: {} }));

describe("squadKeys", () => {
  it("nests detail and roster under the list prefix the catalog events invalidate", () => {
    // data/realtime/use-catalogs-realtime.ts invalidates squadListOptions(wsId)
    // on squad:created/updated. Nesting means an open squad screen refreshes on
    // the same event instead of showing a renamed squad or a stale roster.
    const prefix = squadListOptions("ws-1").queryKey;
    expect([...prefix]).toEqual(["squads", "ws-1"]);
    expect(squadKeys.all("ws-1")).toEqual(prefix);

    expect(
      squadDetailOptions("ws-1", "sq-1").queryKey.slice(0, prefix.length),
    ).toEqual([...prefix]);
    expect(
      squadMembersOptions("ws-1", "sq-1").queryKey.slice(0, prefix.length),
    ).toEqual([...prefix]);
  });

  it("separates workspaces and squads", () => {
    expect(squadDetailOptions("ws-1", "sq-1").queryKey).not.toEqual(
      squadDetailOptions("ws-1", "sq-2").queryKey,
    );
    expect(squadMembersOptions("ws-1", "sq-1").queryKey).not.toEqual(
      squadDetailOptions("ws-1", "sq-1").queryKey,
    );
    expect(squadListOptions("ws-1").queryKey).not.toEqual(
      squadListOptions("ws-2").queryKey,
    );
  });
});

describe("squad query enablement", () => {
  it("needs a workspace, and an id for the record queries", () => {
    expect(squadListOptions("ws-1").enabled).toBe(true);
    expect(squadListOptions(null).enabled).toBe(false);

    expect(squadDetailOptions("ws-1", "sq-1").enabled).toBe(true);
    expect(squadDetailOptions(null, "sq-1").enabled).toBe(false);
    expect(squadDetailOptions("ws-1", "").enabled).toBe(false);

    expect(squadMembersOptions("ws-1", "sq-1").enabled).toBe(true);
    expect(squadMembersOptions(null, "sq-1").enabled).toBe(false);
    expect(squadMembersOptions("ws-1", "").enabled).toBe(false);
  });
});
