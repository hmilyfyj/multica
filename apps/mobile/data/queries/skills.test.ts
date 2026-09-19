import { describe, expect, it, vi } from "vitest";

import { skillDetailOptions, skillKeys, skillListOptions } from "./skills";

vi.mock("@/data/api", () => ({ api: {} }));

describe("skillKeys", () => {
  it("nests the detail under the list prefix so the domain has one root", () => {
    const prefix = skillKeys.all("ws-1");
    expect([...prefix]).toEqual(["skills", "ws-1"]);
    expect(
      skillListOptions("ws-1").queryKey.slice(0, prefix.length),
    ).toEqual([...prefix]);
    expect(
      skillDetailOptions("ws-1", "sk-1").queryKey.slice(0, prefix.length),
    ).toEqual([...prefix]);
  });

  it("separates workspaces and skills", () => {
    expect(skillDetailOptions("ws-1", "sk-1").queryKey).not.toEqual(
      skillDetailOptions("ws-1", "sk-2").queryKey,
    );
    expect(skillListOptions("ws-1").queryKey).not.toEqual(
      skillListOptions("ws-2").queryKey,
    );
  });
});

describe("skill query enablement", () => {
  it("needs a workspace, and an id for the detail", () => {
    expect(skillListOptions("ws-1").enabled).toBe(true);
    expect(skillListOptions(null).enabled).toBe(false);

    expect(skillDetailOptions("ws-1", "sk-1").enabled).toBe(true);
    expect(skillDetailOptions(null, "sk-1").enabled).toBe(false);
    expect(skillDetailOptions("ws-1", "").enabled).toBe(false);
  });
});
