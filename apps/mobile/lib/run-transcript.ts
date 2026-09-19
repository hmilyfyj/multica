/**
 * Run-transcript mapping — the pure layer behind the run-detail surface
 * (`app/(app)/[workspace]/issue/[id]/runs/[taskId].tsx`) and the run row's
 * inline steps fold.
 *
 * Mobile counterpart of web's
 * `packages/views/common/task-transcript/build-timeline.ts` + `redact.ts` +
 * `trace-event-presenter.ts`, narrowed to what these two surfaces render.
 * Same rules, same order, so the two clients describe one run identically:
 *
 *   - messages sort by `seq` (server-assigned, monotonic per task) — NOT by
 *     `created_at`, which is daemon wall-clock and can tie or skew;
 *   - adjacent `text` / `thinking` fragments merge, because the daemon flushes
 *     streaming text in pieces and one thought would otherwise render as ten
 *     rows;
 *   - redaction runs AFTER merging (a credential split across two flushed
 *     fragments must still be caught) and covers `content` / `output` — the
 *     server redacts first; this is the display-side safety net web also keeps.
 *
 * Pure functions only — no React, no network — so the node-only Vitest lane
 * (`apps/mobile/vitest.config.ts` collects `lib/**` + `data/**`) can cover the
 * mapping directly.
 */
import type { TaskMessagePayload } from "@multica/core/types";
import { truncateWithEllipsis } from "@multica/core/utils";

export type RunTranscriptKind =
  | "text"
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "error";

/** One rendered timeline row. Mirrors web's `TimelineItem`. */
export interface RunTranscriptEntry {
  /** Stable list key: `task_id` + `seq`, so two tasks sharing one cache entry list stay distinct. */
  key: string;
  seq: number;
  kind: RunTranscriptKind;
  tool?: string;
  /** `thinking` / `text` / `error` body (merged for the streaming kinds). */
  content?: string;
  input?: Record<string, unknown>;
  output?: string;
  /**
   * Whether the stored `output` dropped bytes at the source (`tool_result`
   * only). `undefined` means unknown — the record predates the flag or came
   * from an older daemon — and must never be rendered as "complete".
   */
  outputTruncated?: boolean;
  createdAt?: string;
}

/** Rows revealed per "show earlier steps" tap. Web's inline run uses 12; the
 *  detail sheet has the full height, so a slightly larger page costs fewer
 *  taps on the long transcripts this screen exists for. */
export const RUN_TRANSCRIPT_PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Redaction (port of packages/views/common/task-transcript/redact.ts)
// ---------------------------------------------------------------------------

const REDACTION_RULES: { re: RegExp; replacement: string }[] = [
  // AWS access key IDs
  { re: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "[REDACTED AWS KEY]" },
  // AWS secret access keys
  {
    re: /(?:aws_secret_access_key|secret_?access_?key)\s*[=:]\s*[A-Za-z0-9/+=]{40}/gi,
    replacement: "[REDACTED AWS SECRET]",
  },
  // PEM private keys
  {
    re: /-----BEGIN[A-Z\s]*PRIVATE KEY-----[\s\S]*?-----END[A-Z\s]*PRIVATE KEY-----/g,
    replacement: "[REDACTED PRIVATE KEY]",
  },
  // GitHub OAuth / classic tokens (ghp_/gho_/ghu_/ghs_/ghr_)
  {
    re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,255}\b/g,
    replacement: "[REDACTED GITHUB TOKEN]",
  },
  // GitHub fine-grained PATs (github_pat_…, recommended since 2022)
  {
    re: /\bgithub_pat_[A-Za-z0-9_]{20,255}\b/g,
    replacement: "[REDACTED GITHUB TOKEN]",
  },
  // Google API keys (AIza…, e.g. Gemini / Maps / Firebase)
  {
    re: /\bAIza[0-9A-Za-z_-]{35}([^0-9A-Za-z_-]|$)/g,
    replacement: "[REDACTED GOOGLE API KEY]$1",
  },
  // GitLab personal access tokens
  { re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g, replacement: "[REDACTED GITLAB TOKEN]" },
  // OpenAI / Anthropic API keys
  { re: /\bsk-[A-Za-z0-9_-]{20,}\b/g, replacement: "[REDACTED API KEY]" },
  // Slack tokens
  { re: /\bxox[bporas]-[A-Za-z0-9-]{10,}\b/g, replacement: "[REDACTED SLACK TOKEN]" },
  // JWT tokens
  {
    re: /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacement: "[REDACTED JWT]",
  },
  // Bearer tokens
  { re: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, replacement: "Bearer [REDACTED]" },
  // Connection strings with embedded passwords
  {
    re: /(?:postgres|mysql|mongodb|redis|amqp)(?:ql)?:\/\/[^:\s]+:[^@\s]+@/gi,
    replacement: "[REDACTED CONNECTION STRING]@",
  },
  // Generic key=value secret env vars
  {
    re: /(?:API_KEY|API_SECRET|SECRET_KEY|SECRET|ACCESS_TOKEN|AUTH_TOKEN|PRIVATE_KEY|DATABASE_URL|DB_PASSWORD|DB_URL|REDIS_URL|PASSWORD|TOKEN)\s*[=:]\s*\S+/gi,
    replacement: "[REDACTED CREDENTIAL]",
  },
];

/** Client-side fallback for redacting sensitive information in agent output.
 *  The server performs primary redaction; this is a display safety net. */
export function redactSecrets(text: string): string {
  let result = text;
  for (const { re, replacement } of REDACTION_RULES) {
    result = result.replace(re, replacement);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Timeline construction
// ---------------------------------------------------------------------------

function mergeInto(
  prev: RunTranscriptEntry,
  next: TaskMessagePayload,
): RunTranscriptEntry {
  return {
    ...prev,
    content: `${prev.content ?? ""}${next.content ?? ""}`,
    createdAt: next.created_at ?? prev.createdAt,
  };
}

function toEntry(message: TaskMessagePayload): RunTranscriptEntry {
  return {
    key: `${message.task_id}-${message.seq}`,
    seq: message.seq,
    kind: message.type,
    tool: message.tool,
    content: message.content,
    input: message.input,
    output: message.output,
    outputTruncated: message.output_truncated,
    createdAt: message.created_at,
  };
}

function redactEntry(entry: RunTranscriptEntry): RunTranscriptEntry {
  return {
    ...entry,
    content: entry.content ? redactSecrets(entry.content) : entry.content,
    output: entry.output ? redactSecrets(entry.output) : entry.output,
  };
}

/**
 * Raw task messages → render-ready timeline, in `seq` order.
 *
 * Adjacent `text` / `thinking` messages merge into one entry; everything else
 * keeps 1:1 with the wire, so a tool call and its result stay separate rows
 * exactly as the daemon emitted them.
 */
export function buildRunTranscript(
  messages: readonly TaskMessagePayload[],
): RunTranscriptEntry[] {
  const sorted = [...messages].sort((a, b) => a.seq - b.seq);
  const merged: RunTranscriptEntry[] = [];
  let previous: TaskMessagePayload | undefined;

  for (const message of sorted) {
    const last = merged[merged.length - 1];
    // Same rule as web's `canMergeStreamingText`: only the streaming kinds
    // coalesce, only with their own kind, and only inside one task's stream.
    if (
      last &&
      previous &&
      previous.task_id === message.task_id &&
      (previous.type === "text" || previous.type === "thinking") &&
      previous.type === message.type
    ) {
      merged[merged.length - 1] = mergeInto(last, message);
    } else {
      merged.push(toEntry(message));
    }
    previous = message;
  }

  return merged.map(redactEntry);
}

// ---------------------------------------------------------------------------
// Row descriptors
// ---------------------------------------------------------------------------

/** Human label, matching web's `traceEventLabel`. */
export function runEntryTitle(entry: RunTranscriptEntry): string {
  switch (entry.kind) {
    case "text":
      return "Agent";
    case "thinking":
      return "Thinking";
    case "error":
      return "Error";
    case "tool_use":
      return entry.tool && entry.tool.length > 0 ? entry.tool : "Tool";
    case "tool_result":
      return entry.tool && entry.tool.length > 0 ? entry.tool : "Result";
  }
}

/** Shorten a long path to `.../parent/leaf` so a summary stays one line. */
export function shortenTranscriptPath(path: string): string {
  const parts = path.split("/");
  if (parts.length <= 3) return path;
  return `.../${parts.slice(-2).join("/")}`;
}

// Providers commonly wrap the real command in a login-shell invocation; the
// wrapper is pure noise in a one-line summary (the full original stays in the
// expanded params). Matches `<shell> -lc '<cmd>'` / `-c "<cmd>"` forms.
const SHELL_WRAPPER_PATTERN =
  /^(?:\/[\w./-]*\/)?(?:zsh|bash|sh|fish)\s+(?:-[a-z]+\s+)*(['"])([\s\S]+)\1$/;

export function stripShellWrapper(command: string): string {
  const match = SHELL_WRAPPER_PATTERN.exec(command.trim());
  return match?.[2] ?? command;
}

/**
 * The single most informative argument of a tool call, as one line. Same
 * preference order as web's `traceToolArgSummary`, so a reviewer scanning
 * either client reads the same summary.
 */
export function runEntryToolSummary(entry: RunTranscriptEntry): string {
  if (entry.kind !== "tool_use" || !entry.input) return "";
  const input = entry.input;
  const str = (value: unknown): string =>
    typeof value === "string" ? value : "";

  const query = str(input.query);
  if (query) return query;
  const filePath = str(input.file_path);
  if (filePath) return shortenTranscriptPath(filePath);
  const path = str(input.path);
  if (path) return shortenTranscriptPath(path);
  const pattern = str(input.pattern);
  if (pattern) return pattern;
  const description = str(input.description);
  if (description) return description;
  const command = str(input.command) || str(input.cmd);
  if (command) return truncateWithEllipsis(stripShellWrapper(command), 120);
  const prompt = str(input.prompt);
  if (prompt) return truncateWithEllipsis(prompt, 120);
  const skill = str(input.skill);
  if (skill) return skill;
  for (const value of Object.values(input)) {
    if (typeof value === "string" && value.length > 0 && value.length < 120) {
      return value;
    }
  }
  return "";
}

/** Expanded tool-call params, pretty-printed and redacted. Redaction runs on
 *  each string value rather than on the serialized JSON, so a matched secret
 *  cannot eat the quoting that keeps the block parseable; the raw `input`
 *  never reaches the screen unfiltered (web redacts it in the same layer). */
export function runEntryInputText(entry: RunTranscriptEntry): string {
  if (!entry.input) return "";
  try {
    return JSON.stringify(
      entry.input,
      (_key, value) => (typeof value === "string" ? redactSecrets(value) : value),
      2,
    );
  } catch {
    // Circular / non-serializable input is not worth a crash in a reader.
    return "";
  }
}

/** Whether a `tool_result` is known to have dropped bytes at the source. */
export function isTranscriptOutputTruncated(entry: RunTranscriptEntry): boolean {
  return (
    entry.kind === "tool_result" &&
    (entry.output?.length ?? 0) > 0 &&
    entry.outputTruncated === true
  );
}

/** Collapse whitespace runs and clip — web's `collapseWhitespace` + `clip`. */
export function transcriptPreview(
  text: string | undefined,
  max = 80,
): string {
  const collapsed = (text ?? "").replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return "";
  return truncateWithEllipsis(collapsed, max);
}

/**
 * Which slice of the timeline is currently revealed: the newest `visibleCount`
 * entries, with everything before `start` collapsed behind the "show earlier"
 * affordance. The server has no pagination for task messages
 * (`GET /api/tasks/:id/messages` takes only an optional `since` cursor and
 * returns the whole run), so the window is a render-size decision, not a
 * transport one.
 */
export function transcriptWindow(
  total: number,
  visibleCount: number,
): { start: number; hiddenCount: number } {
  const start = Math.max(0, total - Math.max(0, visibleCount));
  return { start, hiddenCount: start };
}
