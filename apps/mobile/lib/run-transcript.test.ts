import { describe, expect, it } from "vitest";
import type { TaskMessagePayload } from "@multica/core/types";

import {
  RUN_TRANSCRIPT_PAGE_SIZE,
  buildRunTranscript,
  isTranscriptOutputTruncated,
  redactSecrets,
  runEntryInputText,
  runEntryTitle,
  runEntryToolSummary,
  shortenTranscriptPath,
  stripShellWrapper,
  transcriptPreview,
  transcriptWindow,
} from "./run-transcript";

function msg(
  seq: number,
  type: TaskMessagePayload["type"],
  extra: Partial<TaskMessagePayload> = {},
): TaskMessagePayload {
  return { task_id: "task-1", issue_id: "issue-1", seq, type, ...extra };
}

describe("buildRunTranscript", () => {
  it("orders by seq, not by arrival order", () => {
    const out = buildRunTranscript([
      msg(3, "text", { content: "third" }),
      msg(1, "thinking", { content: "first" }),
      msg(2, "tool_use", { tool: "exec_command" }),
    ]);
    expect(out.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(out.map((e) => e.kind)).toEqual(["thinking", "tool_use", "text"]);
  });

  it("merges adjacent fragments of the same streaming kind", () => {
    const out = buildRunTranscript([
      msg(1, "text", { content: "Hello " }),
      msg(2, "text", { content: "world" }),
      msg(3, "thinking", { content: "hmm " }),
      msg(4, "thinking", { content: "ok" }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].content).toBe("Hello world");
    expect(out[0].seq).toBe(1);
    expect(out[1].content).toBe("hmm ok");
  });

  it("never merges across kinds or across a tool call", () => {
    const out = buildRunTranscript([
      msg(1, "text", { content: "a" }),
      msg(2, "thinking", { content: "b" }),
      msg(3, "text", { content: "c" }),
      msg(4, "tool_use", { tool: "exec_command" }),
      msg(5, "text", { content: "d" }),
      msg(6, "text", { content: "e" }),
    ]);
    expect(out.map((e) => e.kind)).toEqual([
      "text",
      "thinking",
      "text",
      "tool_use",
      "text",
    ]);
    expect(out[4].content).toBe("de");
  });

  it("carries the tool call payload through unchanged", () => {
    const out = buildRunTranscript([
      msg(1, "tool_result", {
        tool: "query",
        output: "rows",
        output_truncated: true,
      }),
    ]);
    expect(out[0]).toMatchObject({
      key: "task-1-1",
      kind: "tool_result",
      tool: "query",
      output: "rows",
      outputTruncated: true,
    });
  });

  it("keys rows per task so two tasks in one cache list stay distinct", () => {
    const out = buildRunTranscript([
      { task_id: "task-a", issue_id: "i", seq: 1, type: "text", content: "a" },
      { task_id: "task-b", issue_id: "i", seq: 1, type: "text", content: "b" },
    ]);
    expect(out.map((e) => e.key)).toEqual(["task-a-1", "task-b-1"]);
  });

  it("redacts content and output, including a secret split across fragments", () => {
    // The two fragments only match the AWS rule once merged — redacting the
    // pieces instead of the merged run is how a credential survives.
    const out = buildRunTranscript([
      msg(1, "text", { content: "key AKIAIOSFODNN7" }),
      msg(2, "text", { content: "EXAMPLE end" }),
      msg(3, "tool_result", {
        tool: "query",
        output: "postgres://user:hunter2@db.internal/x",
      }),
    ]);
    expect(out[0].content).toBe("key [REDACTED AWS KEY] end");
    expect(out[1].output).toBe("[REDACTED CONNECTION STRING]@db.internal/x");
  });
});

describe("redactSecrets", () => {
  it.each([
    ["ghp_" + "a".repeat(36), "[REDACTED GITHUB TOKEN]"],
    ["sk-" + "b".repeat(24), "[REDACTED API KEY]"],
    ["Authorization: Bearer abc.def", "Authorization: Bearer [REDACTED]"],
    ["API_KEY=supersecret", "[REDACTED CREDENTIAL]"],
  ])("redacts %s", (input, expected) => {
    expect(redactSecrets(input)).toBe(expected);
  });

  it("leaves ordinary text alone", () => {
    expect(redactSecrets("ran 3 tests in 1.2s")).toBe("ran 3 tests in 1.2s");
  });
});

describe("transcriptWindow", () => {
  it("reveals everything when the run fits the page", () => {
    expect(transcriptWindow(5, RUN_TRANSCRIPT_PAGE_SIZE)).toEqual({
      start: 0,
      hiddenCount: 0,
    });
    expect(transcriptWindow(RUN_TRANSCRIPT_PAGE_SIZE, RUN_TRANSCRIPT_PAGE_SIZE)).toEqual({
      start: 0,
      hiddenCount: 0,
    });
  });

  it("hides the head older than the window", () => {
    expect(transcriptWindow(21, 20)).toEqual({ start: 1, hiddenCount: 1 });
    expect(transcriptWindow(100, 20)).toEqual({ start: 80, hiddenCount: 80 });
  });

  it("widens by one page per tap", () => {
    expect(transcriptWindow(100, 20 + RUN_TRANSCRIPT_PAGE_SIZE)).toEqual({
      start: 60,
      hiddenCount: 60,
    });
  });

  it("degrades safely on an empty window", () => {
    expect(transcriptWindow(5, 0)).toEqual({ start: 5, hiddenCount: 5 });
    expect(transcriptWindow(0, 20)).toEqual({ start: 0, hiddenCount: 0 });
  });
});

describe("runEntryToolSummary", () => {
  const toolUse = (input: Record<string, unknown>) =>
    buildRunTranscript([msg(1, "tool_use", { tool: "t", input })])[0];

  it("prefers query, then a shortened file path", () => {
    expect(
      runEntryToolSummary(toolUse({ query: "needle", file_path: "/a/b/c/d.ts" })),
    ).toBe("needle");
    expect(runEntryToolSummary(toolUse({ file_path: "/a/b/c/d.ts" }))).toBe(
      ".../c/d.ts",
    );
    expect(runEntryToolSummary(toolUse({ path: "src/x/y.ts" }))).toBe("src/x/y.ts");
  });

  it("falls through pattern, description, command, prompt, skill", () => {
    expect(runEntryToolSummary(toolUse({ pattern: "TODO", description: "d" }))).toBe(
      "TODO",
    );
    expect(runEntryToolSummary(toolUse({ command: "ls -la" }))).toBe("ls -la");
    expect(runEntryToolSummary(toolUse({ prompt: "summarise" }))).toBe("summarise");
    expect(runEntryToolSummary(toolUse({ skill: "code-helper" }))).toBe("code-helper");
  });

  it("strips a login-shell wrapper and clips a long command", () => {
    expect(runEntryToolSummary(toolUse({ command: 'bash -lc "go test ./..."' }))).toBe(
      "go test ./...",
    );
    const long = `echo ${"x".repeat(400)}`;
    const summary = runEntryToolSummary(toolUse({ command: long }));
    expect(summary.startsWith("echo xxx")).toBe(true);
    expect(Array.from(summary).length).toBeLessThanOrEqual(120);
  });

  it("returns empty for non tool_use rows and inputless calls", () => {
    const thinking = buildRunTranscript([
      msg(1, "thinking", { content: "hi", input: { query: "q" } }),
    ])[0];
    expect(runEntryToolSummary(thinking)).toBe("");
    expect(runEntryToolSummary(toolUse({}))).toBe("");
  });
});

describe("stripShellWrapper / shortenTranscriptPath", () => {
  it("unwraps only a login-shell invocation", () => {
    expect(stripShellWrapper("zsh -lc 'pwd'")).toBe("pwd");
    expect(stripShellWrapper("pwd")).toBe("pwd");
  });

  it("shortens only paths deeper than three segments", () => {
    expect(shortenTranscriptPath("a/b/c.ts")).toBe("a/b/c.ts");
    expect(shortenTranscriptPath("a/b/c/d.ts")).toBe(".../c/d.ts");
  });
});

describe("runEntryTitle", () => {
  it("labels each kind, falling back when the tool name is missing", () => {
    const entries = buildRunTranscript([
      msg(1, "text", { content: "x" }),
      msg(2, "thinking", { content: "x" }),
      msg(3, "error", { content: "boom" }),
      msg(4, "tool_use", { tool: "exec_command" }),
      msg(5, "tool_use", {}),
      msg(6, "tool_result", {}),
    ]);
    expect(entries.map(runEntryTitle)).toEqual([
      "Agent",
      "Thinking",
      "Error",
      "exec_command",
      "Tool",
      "Result",
    ]);
  });
});

describe("isTranscriptOutputTruncated", () => {
  it("distinguishes truncated from unknown and complete", () => {
    const [truncated, unknown, complete, empty] = buildRunTranscript([
      msg(1, "tool_result", { output: "cut", output_truncated: true }),
      msg(2, "tool_result", { output: "who knows" }),
      msg(3, "tool_result", { output: "whole", output_truncated: false }),
      msg(4, "tool_result", { output: "", output_truncated: true }),
    ]);
    expect(isTranscriptOutputTruncated(truncated)).toBe(true);
    expect(isTranscriptOutputTruncated(unknown)).toBe(false);
    expect(isTranscriptOutputTruncated(complete)).toBe(false);
    expect(isTranscriptOutputTruncated(empty)).toBe(false);
  });
});

describe("runEntryInputText / transcriptPreview", () => {
  it("pretty-prints and redacts expanded params", () => {
    const entry = buildRunTranscript([
      msg(1, "tool_use", { tool: "t", input: { token: "API_KEY=abc123" } }),
    ])[0];
    expect(runEntryInputText(entry)).toBe('{\n  "token": "[REDACTED CREDENTIAL]"\n}');
    expect(runEntryInputText(buildRunTranscript([msg(1, "text", {})])[0])).toBe("");
  });

  it("collapses whitespace before clipping", () => {
    expect(transcriptPreview("line one\n\tline two", 40)).toBe("line one line two");
    expect(transcriptPreview("   ", 40)).toBe("");
    expect(transcriptPreview(undefined, 40)).toBe("");
    expect(Array.from(transcriptPreview("x".repeat(200), 80)).length).toBeLessThanOrEqual(80);
  });
});
