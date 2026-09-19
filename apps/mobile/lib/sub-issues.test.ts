// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Issue } from "@multica/core/types";
import {
  childProgressOf,
  groupSubIssuesByStage,
  hasStagedChildren,
  subIssueProgressLabel,
} from "./sub-issues";

function issue(id: string, stage: number | null, patch: Partial<Issue> = {}): Issue {
  return {
    id,
    workspace_id: "ws-1",
    number: 1,
    identifier: `MUL-${id}`,
    title: id,
    description: null,
    status: "todo",
    priority: "none",
    assignee_type: null,
    assignee_id: null,
    creator_type: "member",
    creator_id: "user-1",
    parent_issue_id: "parent-1",
    project_id: null,
    position: 0,
    stage,
    start_date: null,
    due_date: null,
    metadata: {},
    properties: {},
    created_at: "",
    updated_at: "",
    ...patch,
  };
}

describe("groupSubIssuesByStage", () => {
  it("orders staged groups ascending and keeps the unstaged group last", () => {
    const groups = groupSubIssuesByStage([
      issue("unstaged", null),
      issue("stage-2", 2),
      issue("stage-1", 1),
    ]);
    expect(groups.map((g) => g.stage)).toEqual([1, 2, null]);
    expect(groups.map((g) => g.items.map((i) => i.id))).toEqual([
      ["stage-1"],
      ["stage-2"],
      ["unstaged"],
    ]);
  });

  it("merges siblings of one stage and preserves their input order", () => {
    const groups = groupSubIssuesByStage([
      issue("a", 3),
      issue("b", 3),
      issue("c", 3),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("yields one headerless group when nothing is staged", () => {
    const groups = groupSubIssuesByStage([issue("a", null), issue("b", null)]);
    expect(groups.map((g) => g.stage)).toEqual([null]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("omits the unstaged group when every child is staged", () => {
    const groups = groupSubIssuesByStage([issue("a", 1), issue("b", 2)]);
    expect(groups.map((g) => g.stage)).toEqual([1, 2]);
  });

  it("returns nothing for a childless parent", () => {
    expect(groupSubIssuesByStage([])).toEqual([]);
  });
});

describe("hasStagedChildren", () => {
  it("is true only when some child carries a stage", () => {
    expect(hasStagedChildren([issue("a", null), issue("b", 1)])).toBe(true);
    expect(hasStagedChildren([issue("a", null)])).toBe(false);
    expect(hasStagedChildren([])).toBe(false);
  });
});

describe("childProgressOf", () => {
  it("counts completion by lifecycle category, custom statuses included", () => {
    const progress = childProgressOf([
      issue("a", null, { status: "done" }),
      issue("b", null, { status: "shipped", status_category: "done" }),
      issue("c", null, { status: "in_progress" }),
    ]);
    expect(progress).toEqual({ done: 2, total: 3 });
  });

  it("does not count closed-status children as done", () => {
    const progress = childProgressOf([
      issue("a", null, { status: "cancelled" }),
      issue("b", null, { status: "dropped", status_category: "closed" }),
    ]);
    expect(progress).toEqual({ done: 0, total: 2 });
  });

  it("keeps an unresolvable custom status out of the done count", () => {
    // Neither a built-in key nor a server-resolved category: unresolved, and
    // the fail-safe direction is "not done".
    const progress = childProgressOf([issue("a", null, { status: "weird" })]);
    expect(progress).toEqual({ done: 0, total: 1 });
  });

  it("reports 0/0 for a childless parent", () => {
    expect(childProgressOf([])).toEqual({ done: 0, total: 0 });
  });
});

describe("subIssueProgressLabel", () => {
  it("renders the done/total badge for a sub-issue that has children", () => {
    expect(subIssueProgressLabel({ done: 2, total: 5 })).toBe("2/5");
    expect(subIssueProgressLabel({ done: 0, total: 3 })).toBe("0/3");
  });

  it("renders nothing without an entry — the row has no children", () => {
    expect(subIssueProgressLabel(undefined)).toBeNull();
  });

  it("renders nothing rather than 0/0 when the entry has no children", () => {
    expect(subIssueProgressLabel({ done: 0, total: 0 })).toBeNull();
  });
});
