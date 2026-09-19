import { describe, expect, it } from "vitest";

import { readSkillOrigin, skillFileList, skillOriginLabel } from "@/lib/skill-origin";
import { EMPTY_SKILL_DETAIL, SkillDetailSchema } from "./schemas";

// Wire shape from server/internal/handler/skill.go:136-149 — the
// `?include=metadata` response: the list summary, plus `content_size` (the
// SKILL.md body length it omits) and file metadata in place of file bodies.
const detail = {
  id: "sk-1",
  workspace_id: "ws-1",
  name: "audit-website",
  description: "Audits a site",
  config: { origin: { type: "github", source_url: "https://github.com/x/y" } },
  created_by: "user-1",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-02T00:00:00Z",
  content_size: 4096,
  files: [{ id: "f-1", skill_id: "sk-1", path: "references/a.md", size: 512 }],
};

describe("SkillDetailSchema", () => {
  it("reads the summary, the SKILL.md size and the file metadata", () => {
    const parsed = SkillDetailSchema.parse(detail);
    expect(parsed.name).toBe("audit-website");
    expect(parsed.description).toBe("Audits a site");
    expect(parsed.content_size).toBe(4096);
    expect(parsed.files).toHaveLength(1);
  });

  it("lists a file whose metadata an older backend trimmed", () => {
    // The metadata shape is opt-in (skill.go resolveSkillInclude), so a row is
    // allowed to arrive with only the two fields this screen reads.
    const parsed = SkillDetailSchema.parse({
      ...detail,
      files: [{ path: "references/b.md" }],
    });
    expect(parsed.files[0]?.path).toBe("references/b.md");
    expect(parsed.files[0]?.size).toBe(0);
  });

  it("defaults a missing size or file list instead of dropping the skill", () => {
    const parsed = SkillDetailSchema.parse({ ...detail, content_size: undefined, files: undefined });
    expect(parsed.content_size).toBe(0);
    expect(parsed.files).toEqual([]);
  });

  it("flags drift with the empty sentinel the screen renders as not-found", () => {
    expect(EMPTY_SKILL_DETAIL.id).toBe("");
  });

  it("hands the detail screen a file list with SKILL.md first", () => {
    // End-to-end: parse then list. Either half alone passes while the screen
    // still shows a skill with no main file.
    const parsed = SkillDetailSchema.parse(detail);
    expect(skillFileList(parsed)).toEqual([
      { path: "SKILL.md", size: 4096 },
      { path: "references/a.md", size: 512 },
    ]);
  });

  it("hands the row a source label it can print", () => {
    const parsed = SkillDetailSchema.parse(detail);
    expect(skillOriginLabel(readSkillOrigin(parsed))).toBe("From GitHub");
  });
});
