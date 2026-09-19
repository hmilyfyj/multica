import { describe, expect, it } from "vitest";
import {
  TIME_PLACEHOLDER,
  autopilotStatusLabel,
  executionModeLabel,
  formatAbsoluteTime,
  runNowBlockedMessage,
  runNowOutcome,
  runSourceLabel,
  runStatusLabel,
  runStatusTone,
  sortAutopilotsByRecentRun,
  triggerKindLabel,
  triggerKindsSummary,
  triggerScheduleLine,
} from "./autopilot-display";

describe("runNowOutcome", () => {
  it("treats only explicit start statuses as success", () => {
    expect(runNowOutcome("issue_created")).toBe("success");
    expect(runNowOutcome("running")).toBe("success");
  });

  it("warns for a skipped run and errors for a failure", () => {
    expect(runNowOutcome("skipped")).toBe("warning");
    expect(runNowOutcome("failed")).toBe("error");
  });

  it("never claims success for an unknown, future or absent status", () => {
    // The run response schema accepts any status string for forward
    // compatibility, so a status this build predates must not read as success.
    expect(runNowOutcome("deferred")).toBe("error");
    expect(runNowOutcome(undefined)).toBe("error");
    expect(runNowOutcome("")).toBe("error");
  });
});

describe("runNowBlockedMessage", () => {
  it("names the cause for a code the server sends", () => {
    expect(runNowBlockedMessage("runtime_offline")).toBe(
      "Not triggered — the agent's runtime is offline",
    );
    expect(runNowBlockedMessage("quota_exceeded")).toBe(
      "Not triggered — the run limit for this period has been reached",
    );
  });

  it("degrades an unknown or absent code to the generic sentence", () => {
    const generic = "Not triggered — the run was blocked";
    expect(runNowBlockedMessage("some_future_code")).toBe(generic);
    expect(runNowBlockedMessage(undefined)).toBe(generic);
  });
});

describe("triggerKindsSummary", () => {
  it("joins the enabled kinds in server order", () => {
    expect(triggerKindsSummary(["schedule", "webhook"])).toBe(
      "Schedule · Webhook",
    );
  });

  it("renders an unknown kind by its raw value instead of dropping the row", () => {
    expect(triggerKindsSummary(["schedule", "websocket"])).toBe(
      "Schedule · websocket",
    );
  });

  it("is empty for an autopilot with no enabled trigger", () => {
    expect(triggerKindsSummary([])).toBe("");
    expect(triggerKindsSummary(undefined)).toBe("");
  });
});

describe("sortAutopilotsByRecentRun", () => {
  const row = (title: string, lastRunAt: string | null) => ({
    title,
    last_run_at: lastRunAt,
  });

  it("puts the most recent run first and never-run rows last", () => {
    const sorted = sortAutopilotsByRecentRun([
      row("never", null),
      row("old", "2026-09-10T00:00:00Z"),
      row("new", "2026-09-18T00:00:00Z"),
    ]);
    expect(sorted.map((r) => r.title)).toEqual(["new", "old", "never"]);
  });

  it("breaks ties by title", () => {
    const same = "2026-09-18T00:00:00Z";
    const sorted = sortAutopilotsByRecentRun([
      row("beta", same),
      row("alpha", same),
      row("zeta", null),
      row("delta", null),
    ]);
    expect(sorted.map((r) => r.title)).toEqual([
      "alpha",
      "beta",
      "delta",
      "zeta",
    ]);
  });

  it("does not mutate the input", () => {
    const rows = [row("a", null), row("b", "2026-09-18T00:00:00Z")];
    sortAutopilotsByRecentRun(rows);
    expect(rows.map((r) => r.title)).toEqual(["a", "b"]);
  });
});

describe("triggerScheduleLine", () => {
  it("carries the configured zone next to the expression", () => {
    expect(
      triggerScheduleLine({
        cron_expression: "0 9 * * 1-5",
        timezone: "Asia/Shanghai",
      }),
    ).toBe("0 9 * * 1-5 (Asia/Shanghai)");
  });

  it("omits the zone when the trigger has none", () => {
    expect(
      triggerScheduleLine({ cron_expression: "*/15 * * * *", timezone: null }),
    ).toBe("*/15 * * * *");
  });

  it("is null without an expression", () => {
    expect(
      triggerScheduleLine({ cron_expression: null, timezone: "UTC" }),
    ).toBeNull();
  });
});

describe("formatAbsoluteTime", () => {
  it("renders an absolute local date and time", () => {
    const rendered = formatAbsoluteTime("2026-09-22T01:00:00Z");
    expect(rendered).not.toBe(TIME_PLACEHOLDER);
    expect(rendered).toMatch(/2026/);
  });

  it("falls back to the placeholder for a missing or unparseable value", () => {
    expect(formatAbsoluteTime(null)).toBe(TIME_PLACEHOLDER);
    expect(formatAbsoluteTime(undefined)).toBe(TIME_PLACEHOLDER);
    expect(formatAbsoluteTime("not-a-date")).toBe(TIME_PLACEHOLDER);
  });
});

describe("label maps", () => {
  it("renders the server vocabularies with web's copy", () => {
    expect(autopilotStatusLabel("active")).toBe("Active");
    expect(autopilotStatusLabel("paused")).toBe("Paused");
    expect(triggerKindLabel("webhook")).toBe("Webhook");
    expect(executionModeLabel("run_only")).toBe("Run Only");
    expect(runStatusLabel("issue_created")).toBe("Issue Created");
    expect(runSourceLabel("manual")).toBe("Manual");
  });

  it("passes an unknown value through rather than blanking the cell", () => {
    // status is CHECK-constrained server-side; the rest are open vocabularies.
    expect(triggerKindLabel("websocket")).toBe("websocket");
    expect(executionModeLabel("dry_run")).toBe("dry_run");
    expect(runStatusLabel("deferred")).toBe("deferred");
    expect(runSourceLabel("cron")).toBe("cron");
  });
});

describe("runStatusTone", () => {
  it("mutes a skipped run instead of reading it as a failure", () => {
    expect(runStatusTone("skipped")).toBe("muted");
    expect(runStatusTone("failed")).toBe("failure");
    expect(runStatusTone("completed")).toBe("success");
    expect(runStatusTone("issue_created")).toBe("info");
    expect(runStatusTone("running")).toBe("running");
    expect(runStatusTone("deferred")).toBe("muted");
  });
});
