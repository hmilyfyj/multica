import { describe, expect, it } from "vitest";

import { SquadListSchema, SquadMemberListSchema, SquadSchema } from "./schemas";

const row = {
  id: "sq-1",
  workspace_id: "ws-1",
  name: "Reviewers",
  leader_id: "agent-1",
};

describe("SquadSchema", () => {
  it("reads the member count and preview the list row renders", () => {
    // Both are server-derived columns (server/internal/handler/squad.go
    // applySquadMemberSummary). Without them in the schema the list row would
    // read 0 members on a squad that has some.
    const squad = SquadSchema.parse({
      ...row,
      member_count: 3,
      member_preview: [{ member_type: "agent", member_id: "agent-1", role: "member" }],
    });
    expect(squad.member_count).toBe(3);
    expect(squad.member_preview).toHaveLength(1);
    expect(squad.member_preview?.[0]?.member_id).toBe("agent-1");
  });

  it("defaults an older backend's missing member fields rather than dropping the squad", () => {
    const squad = SquadSchema.parse(row);
    expect(squad.member_count).toBe(0);
    expect(squad.member_preview).toEqual([]);
  });

  it("catches an unknown preview member kind instead of failing the list", () => {
    const squad = SquadSchema.parse({
      ...row,
      member_preview: [{ member_type: "service", member_id: "svc-1" }],
    });
    expect(squad.member_preview?.[0]?.member_type).toBe("agent");
  });

  it("keeps the instructions body the detail screen shows", () => {
    expect(
      SquadSchema.parse({ ...row, instructions: "Always start with a test." })
        .instructions,
    ).toBe("Always start with a test.");
  });

  it("degrades a whole list response that drifts to empty instead of throwing", () => {
    expect(SquadListSchema.parse(undefined)).toEqual([]);
  });
});

describe("SquadMemberSchema", () => {
  it("keeps the member_type / member_id pair the roster resolves names from", () => {
    const members = SquadMemberListSchema.parse([
      { id: "sm-1", squad_id: "sq-1", member_type: "member", member_id: "user-1" },
      { id: "sm-2", squad_id: "sq-1", member_type: "agent", member_id: "agent-1" },
    ]);
    expect(members.map((m) => m.member_type)).toEqual(["member", "agent"]);
    expect(members[0]?.member_id).toBe("user-1");
  });

  it("catches an unknown member kind rather than failing the whole roster", () => {
    const members = SquadMemberListSchema.parse([
      { id: "sm-1", member_type: "service", member_id: "svc-1" },
    ]);
    expect(members[0]?.member_type).toBe("agent");
  });

  it("defaults a roster response that drifts to empty", () => {
    expect(SquadMemberListSchema.parse(undefined)).toEqual([]);
  });
});
