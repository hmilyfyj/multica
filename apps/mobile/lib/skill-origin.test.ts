import { describe, expect, it } from "vitest";
import type { SkillSummary } from "@multica/core/types";
import {
  formatFileSize,
  readSkillOrigin,
  SKILL_MD,
  skillFileList,
  skillOriginLabel,
} from "@/lib/skill-origin";

function skill(config: Record<string, unknown> = {}): SkillSummary {
  return {
    id: "sk-1",
    workspace_id: "ws-1",
    name: "audit-website",
    description: "",
    config,
    created_by: null,
    created_at: "",
    updated_at: "",
  };
}

describe("readSkillOrigin", () => {
  it("synthesises manual for a skill created in the app", () => {
    expect(readSkillOrigin(skill())).toEqual({ type: "manual" });
  });

  it("reads a runtime-local import with its runtime and provider", () => {
    expect(
      readSkillOrigin(
        skill({
          origin: {
            type: "runtime_local",
            runtime_id: "rt-1",
            provider: "claude",
            source_path: "/Users/x/.claude/skills/audit",
          },
        }),
      ),
    ).toEqual({ type: "runtime_local", runtime_id: "rt-1", provider: "claude" });
  });

  it("reads the hosted origins", () => {
    expect(readSkillOrigin(skill({ origin: { type: "clawhub" } })).type).toBe(
      "clawhub",
    );
    expect(readSkillOrigin(skill({ origin: { type: "skills_sh" } })).type).toBe(
      "skills_sh",
    );
    expect(readSkillOrigin(skill({ origin: { type: "github" } })).type).toBe(
      "github",
    );
  });

  it("degrades an unrecognised or malformed origin to manual", () => {
    expect(readSkillOrigin(skill({ origin: { type: "gist" } })).type).toBe(
      "manual",
    );
    expect(readSkillOrigin(skill({ origin: "github" })).type).toBe("manual");
  });

  it("drops non-string runtime fields instead of showing them", () => {
    expect(
      readSkillOrigin(skill({ origin: { type: "runtime_local", runtime_id: 7 } })),
    ).toEqual({
      type: "runtime_local",
      runtime_id: undefined,
      provider: undefined,
    });
  });
});

describe("skillOriginLabel", () => {
  it("names the runtime a local skill came from", () => {
    expect(
      skillOriginLabel({ type: "runtime_local", runtime_id: "rt-1" }, "MacBook Pro"),
    ).toBe("From MacBook Pro");
  });

  it("falls back to the provider, then to a generic runtime", () => {
    expect(skillOriginLabel({ type: "runtime_local", provider: "claude" })).toBe(
      "From claude runtime",
    );
    expect(skillOriginLabel({ type: "runtime_local" })).toBe("From a runtime");
  });

  it("names each hosted origin", () => {
    expect(skillOriginLabel({ type: "clawhub" })).toBe("From ClawHub");
    expect(skillOriginLabel({ type: "skills_sh" })).toBe("From Skills.sh");
    expect(skillOriginLabel({ type: "github" })).toBe("From GitHub");
  });

  it("labels an in-app skill as manually created", () => {
    expect(skillOriginLabel({ type: "manual" })).toBe("Created manually");
  });
});

describe("skillFileList", () => {
  it("puts SKILL.md first and keeps the server's supporting order", () => {
    expect(
      skillFileList({
        content_size: 2048,
        files: [
          { path: "references/a.md", size: 10 },
          { path: "scripts/run.sh", size: 20 },
        ],
      }),
    ).toEqual([
      { path: SKILL_MD, size: 2048 },
      { path: "references/a.md", size: 10 },
      { path: "scripts/run.sh", size: 20 },
    ]);
  });

  it("still lists SKILL.md for a skill with no supporting files", () => {
    expect(skillFileList({ content_size: 0, files: [] })).toEqual([
      { path: SKILL_MD, size: 0 },
    ]);
  });
});

describe("formatFileSize", () => {
  it("shows plain bytes below 1 KB", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1023)).toBe("1023 B");
  });

  it("steps up through KB, MB and GB", () => {
    expect(formatFileSize(1024)).toBe("1 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(1024 * 1024)).toBe("1 MB");
    expect(formatFileSize(1024 * 1024 * 1024)).toBe("1 GB");
  });

  it("does not print a negative or non-finite size", () => {
    expect(formatFileSize(-5)).toBe("0 B");
    expect(formatFileSize(Number.NaN)).toBe("0 B");
  });
});
