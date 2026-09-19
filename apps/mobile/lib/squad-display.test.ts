import { describe, expect, it } from "vitest";
import type { SquadMember } from "@multica/core/types";
import {
  findSquadLeaderName,
  isSquadLeader,
  squadLeaderLabel,
  squadMemberCountLabel,
  squadMemberTypeLabel,
} from "@/lib/squad-display";

function member(over: Partial<SquadMember> = {}): SquadMember {
  return {
    id: "sm-1",
    squad_id: "sq-1",
    member_type: "agent",
    member_id: "agent-1",
    role: "member",
    created_at: "2026-09-01T00:00:00Z",
    ...over,
  };
}

describe("squadMemberTypeLabel", () => {
  it("names both member kinds", () => {
    expect(squadMemberTypeLabel("agent")).toBe("Agent");
    expect(squadMemberTypeLabel("member")).toBe("Member");
  });

  it("passes an unknown kind through", () => {
    expect(squadMemberTypeLabel("squad")).toBe("squad");
  });
});

describe("isSquadLeader", () => {
  it("marks the agent whose id is the squad's leader", () => {
    expect(isSquadLeader(member({ member_id: "agent-1" }), "agent-1")).toBe(true);
  });

  it("ignores a different agent", () => {
    expect(isSquadLeader(member({ member_id: "agent-2" }), "agent-1")).toBe(false);
  });

  it("ignores a human member that happens to share the id", () => {
    expect(
      isSquadLeader(member({ member_type: "member", member_id: "agent-1" }), "agent-1"),
    ).toBe(false);
  });
});

describe("findSquadLeaderName", () => {
  it("finds the leader in the agent roster", () => {
    expect(
      findSquadLeaderName("agent-1", [
        { id: "agent-1", name: "Reviewer" },
        { id: "agent-2", name: "Builder" },
      ]),
    ).toBe("Reviewer");
  });

  it("returns null for a leader that is not in the roster", () => {
    // A deleted agent must not read as "Unknown Agent" — the caller needs to
    // know there is no name so it can fall back to the id.
    expect(findSquadLeaderName("agent-9", [{ id: "agent-1", name: "R" }])).toBeNull();
    expect(findSquadLeaderName("", [])).toBeNull();
  });
});

describe("squadLeaderLabel", () => {
  it("prefers the resolved name", () => {
    expect(squadLeaderLabel("agent-1", "Reviewer")).toBe("Reviewer");
  });

  it("falls back to the truncated id when the roster has no name", () => {
    expect(squadLeaderLabel("0123456789abcdef", null)).toBe("01234567");
  });

  it("shows a dash when there is no leader at all", () => {
    expect(squadLeaderLabel("", null)).toBe("—");
  });
});

describe("squadMemberCountLabel", () => {
  it("singularises one and pluralises the rest", () => {
    expect(squadMemberCountLabel(0)).toBe("0 members");
    expect(squadMemberCountLabel(1)).toBe("1 member");
    expect(squadMemberCountLabel(4)).toBe("4 members");
  });
});
