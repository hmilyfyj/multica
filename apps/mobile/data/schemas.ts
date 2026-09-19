/**
 * Mobile-local zod schemas + fallbacks for endpoints whose responses aren't
 * yet schematised in @multica/core/api/schemas. Lenient by design — see the
 * leniency rationale at the top of the core file (string enums tolerated,
 * loose() so unknown server fields pass through, defaults so a missing
 * array doesn't take the page down).
 *
 * If web/desktop later need these same schemas, promote them to core; until
 * then they live here so mobile satisfies its "Parse, don't cast" rule
 * (root CLAUDE.md "API Response Compatibility") for these endpoints.
 */
import { z } from "zod";
import type {
  Agent,
  AgentInvocationTarget,
  AgentTask,
  Attachment,
  Autopilot,
  AutopilotTrigger,
  ChatMessage,
  ChatPendingTask,
  ChatSession,
  Comment,
  GetAutopilotResponse,
  InboxItem,
  InboxWorkspaceUnread,
  IssueLabelsResponse,
  Label,
  ListAutopilotRunsResponse,
  ListAutopilotsResponse,
  ListLabelsResponse,
  ListProjectResourcesResponse,
  ListProjectsResponse,
  MemberWithUser,
  PinnedItem,
  Project,
  ProjectResource,
  RuntimeDevice,
  RuntimeUsage,
  SearchIssuesResponse,
  SearchProjectsResponse,
  SendChatMessageResponse,
  SkillSummary,
  Squad,
  SquadMember,
  SquadMemberPreview,
  TaskMessagePayload,
  User,
  Workspace,
} from "@multica/core/types";
import {
  AutopilotRunSchema,
  EMPTY_SKILL_SUMMARY,
  IssueSchema,
  SkillSummarySchema,
} from "@multica/core/api/schemas";

/** Upload response. Only fields mobile actually consumes — `url` to put
 *  into the markdown link, `filename` for the `[📎 name](url)` form, `id`
 *  for future linking. `.loose()` so the server can add fields without
 *  breaking mobile. Web's AttachmentSchema (packages/core/api/schemas.ts:41)
 *  is even looser (only `id`); mobile validates more because the upload
 *  flow inserts `url` directly into editable text and an empty `url` would
 *  produce a broken link the user only notices after submit. */
export const AttachmentSchema: z.ZodType<Attachment> = z.object({
  id: z.string(),
  workspace_id: z.string().default(""),
  issue_id: z.string().nullable().default(null),
  comment_id: z.string().nullable().default(null),
  chat_session_id: z.string().nullable().default(null),
  chat_message_id: z.string().nullable().default(null),
  uploader_type: z.string().default(""),
  uploader_id: z.string().default(""),
  filename: z.string(),
  url: z.string(),
  download_url: z.string().default(""),
  markdown_url: z.string().default(""),
  content_type: z.string().default(""),
  size_bytes: z.number().default(0),
  created_at: z.string().default(""),
}).loose();

/** GET /api/issues/:id/attachments — array of attachments for the issue.
 *  Empty array fallback so a 5xx or shape mismatch doesn't crash markdown
 *  rendering — image URIs simply fail to resolve and fall back to fetch. */
export const AttachmentListSchema = z.array(AttachmentSchema).default([]);
export const EMPTY_ATTACHMENT_LIST: Attachment[] = [];

/** Comment write endpoints all return a full Comment. Used by createComment /
 *  updateComment / resolveComment / unresolveComment via fetchValidatedWith.
 *  Empty fallback yields `id: ""` so downstream code (the mutations'
 *  onSuccess writers) can detect drift and fall back to invalidate. */
export const CommentSchema = z.object({
  id: z.string(),
  issue_id: z.string().default(""),
  author_type: z.string().default("member"),
  author_id: z.string().default(""),
  content: z.string().default(""),
  type: z.string().default("comment"),
  parent_id: z.string().nullable().default(null),
  reactions: z.array(z.unknown()).default([]),
  attachments: z.array(z.unknown()).default([]),
  created_at: z.string().default(""),
  updated_at: z.string().default(""),
  resolved_at: z.string().nullable().default(null),
  resolved_by_type: z.string().nullable().default(null),
  resolved_by_id: z.string().nullable().default(null),
  source_task_id: z.string().nullable().optional(),
  // Tombstone marker (#8296); a malformed value reads as a live comment.
  deleted_at: z.string().nullable().optional().catch(undefined),
}).loose() as unknown as z.ZodType<Comment>;

export const EMPTY_COMMENT: Comment = {
  id: "",
  issue_id: "",
  author_type: "member",
  author_id: "",
  content: "",
  type: "comment",
  parent_id: null,
  reactions: [],
  attachments: [],
  created_at: "",
  updated_at: "",
  resolved_at: null,
  resolved_by_type: null,
  resolved_by_id: null,
};

/** GET/PUT /api/notification-preferences. Preferences are partial — absent
 *  keys mean "default (= all)", an explicit "muted" turns the group off.
 *  Loose() so future group additions on the backend don't break parsing.
 *  Value type is z.string() (not z.enum) so a future server-side value like
 *  "snoozed" downgrades gracefully (read sites treat unknown as enabled)
 *  instead of failing schema parse and dropping the entire preferences map.
 *  Per CLAUDE.md "Enum drift downgrades, not crashes". */
export const NotificationPreferenceResponseSchema = z.object({
  workspace_id: z.string().default(""),
  preferences: z.record(z.string(), z.string()).default({}),
}).loose();
export const EMPTY_NOTIFICATION_PREFERENCES = {
  workspace_id: "",
  preferences: {},
} as const;

const LabelSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  name: z.string(),
  color: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
}).loose();

export const ListLabelsResponseSchema = z.object({
  labels: z.array(LabelSchema).default([]),
  total: z.number().default(0),
}).loose();

export const EMPTY_LIST_LABELS_RESPONSE: ListLabelsResponse = {
  labels: [],
  total: 0,
};

export const IssueLabelsResponseSchema = z.object({
  labels: z.array(LabelSchema).default([]),
}).loose();

export const EMPTY_ISSUE_LABELS_RESPONSE: IssueLabelsResponse = {
  labels: [],
};

export const ProjectSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  status: z.string(),
  priority: z.string(),
  lead_type: z.string().nullable(),
  lead_id: z.string().nullable(),
  // .default(null) so a project from an older backend that omits these keys
  // parses to null instead of degrading the batch to the empty fallback.
  start_date: z.string().nullable().default(null),
  due_date: z.string().nullable().default(null),
  created_at: z.string(),
  updated_at: z.string(),
  issue_count: z.number().default(0),
  done_count: z.number().default(0),
  resource_count: z.number().default(0),
}).loose();

export const ListProjectsResponseSchema = z.object({
  projects: z.array(ProjectSchema).default([]),
  total: z.number().default(0),
}).loose();

export const EMPTY_LIST_PROJECTS_RESPONSE: ListProjectsResponse = {
  projects: [],
  total: 0,
};

// Fallback for `GET /api/projects/{id}` when the response shape drifts.
// `id` defaults to empty — caller can detect "not found / drift" by checking
// `data.id === ""` and rendering an error state instead of pretending the
// data is valid. Status / priority cast to the enum literals so TS callers
// downstream still flow correctly; runtime values came from the schema
// (`z.string()`), which would have already passed.
export const EMPTY_PROJECT: Project = {
  id: "",
  workspace_id: "",
  title: "",
  description: null,
  icon: null,
  status: "planned",
  priority: "none",
  lead_type: null,
  lead_id: null,
  start_date: null,
  due_date: null,
  created_at: "",
  updated_at: "",
  issue_count: 0,
  done_count: 0,
  resource_count: 0,
};

// Project resources are typed pointers to external resources (today: GitHub
// repos). resource_ref shape varies per resource_type; lenient on both
// `resource_type` (so a future type doesn't crash the list) and
// `resource_ref` (passes through unchanged for the renderer to dispatch on).
const ProjectResourceSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  workspace_id: z.string(),
  resource_type: z.string(),
  resource_ref: z.unknown(),
  label: z.string().nullable(),
  position: z.number().default(0),
  created_at: z.string(),
  created_by: z.string().nullable(),
}).loose();

export const ListProjectResourcesResponseSchema = z.object({
  resources: z.array(ProjectResourceSchema).default([]),
  total: z.number().default(0),
}).loose();

export const EMPTY_LIST_PROJECT_RESOURCES_RESPONSE: ListProjectResourcesResponse = {
  resources: [],
  total: 0,
};

// =====================================================
// Chat (sessions / messages / pending task)
// =====================================================
// Lenient on every field that's purely informational (status enum, timestamps,
// agent/creator ids). `.loose()` so server-added fields pass through. The two
// fields mobile keys behaviour on — `id` and `chat_session_id` — are required.

export const ChatSessionSchema: z.ZodType<ChatSession> = z.object({
  id: z.string(),
  workspace_id: z.string().default(""),
  agent_id: z.string().default(""),
  creator_id: z.string().default(""),
  title: z.string().default(""),
  // Enum drift defense (root CLAUDE.md "Enum drift downgrades, not crashes"):
  // unknown server values fall back to "active" so the row still renders.
  status: z.enum(["active", "archived"]).catch("active"),
  has_unread: z.boolean().default(false),
  // Unread assistant messages after the read cursor. Optional (not defaulted)
  // so the badge math can tell "older server didn't send it" from a real 0 —
  // the tab badge sums `unread_count ?? 0`, same rule as web's sidebar.
  unread_count: z.number().optional(),
  created_at: z.string().default(""),
  updated_at: z.string().default(""),
}).loose();

export const ChatSessionListSchema = z.array(ChatSessionSchema).default([]);

export const EMPTY_CHAT_SESSION_LIST: ChatSession[] = [];

// `attachments` carried for parity rendering only — v1 doesn't author them on
// mobile. AttachmentSchema is reused as-is.
export const ChatMessageSchema: z.ZodType<ChatMessage> = z.object({
  id: z.string(),
  chat_session_id: z.string(),
  // If the server ever introduces a third role, fall back to "assistant" so
  // the message renders (as a left-aligned bubble) instead of crashing the
  // list. Matches Enum drift defense.
  role: z.enum(["user", "assistant"]).catch("assistant"),
  content: z.string().default(""),
  task_id: z.string().nullable().default(null),
  created_at: z.string().default(""),
  attachments: z.array(AttachmentSchema).optional(),
  failure_reason: z.string().nullable().optional(),
  elapsed_ms: z.number().nullable().optional(),
  message_kind: z.enum(["message", "no_response"]).catch("message").optional(),
  // One malformed optional suggestion must not erase an otherwise valid
  // conversation. The server validates these too; this is mixed-version and
  // corrupted-cache defense at the mobile boundary.
  quick_actions: z.array(z.object({
    label: z.string(),
    prompt: z.string(),
    primary: z.boolean().optional(),
  }).loose()).catch([]).optional().default([]),
}).loose();

export const ChatMessageListSchema = z.array(ChatMessageSchema).default([]);

export const EMPTY_CHAT_MESSAGE_LIST: ChatMessage[] = [];

const ChatQueuedTaskSchema = z.object({
  task_id: z.string(),
  status: z.string().default("queued"),
  created_at: z.string().default(""),
  message_id: z.string().optional(),
  content: z.string().optional(),
}).loose();

const ChatQueuedTasksSchema = z.array(z.unknown()).transform((tasks) =>
  tasks.flatMap((task) => {
    const parsed = ChatQueuedTaskSchema.safeParse(task);
    return parsed.success ? [parsed.data] : [];
  }),
);

// All root fields are optional — server returns an empty object when no
// task is in flight. Ignore malformed queue rows without discarding a valid
// head, matching packages/core/api/schemas.ts.
export const ChatPendingTaskSchema: z.ZodType<ChatPendingTask> = z.object({
  task_id: z.string().optional(),
  status: z.string().optional(),
  created_at: z.string().optional(),
  supports_queue: z.boolean().optional(),
  queued_tasks: ChatQueuedTasksSchema.optional(),
}).loose();

export const EMPTY_CHAT_PENDING_TASK: ChatPendingTask = {};

export const SendChatMessageResponseSchema: z.ZodType<SendChatMessageResponse> = z.object({
  message_id: z.string(),
  task_id: z.string(),
  supports_queue: z.boolean().optional(),
  queued: z.boolean().optional().catch(undefined),
  created_at: z.string().default(""),
}).loose();

// Live timeline emitted by the agent runtime while a task is running. Each
// row is one execution step (thinking / tool_use / tool_result / text /
// error). Mirrors web's TaskMessagePayload type and the WS `task:message`
// payload so the mobile cache shape stays interchangeable with web's.
export const TaskMessagePayloadSchema: z.ZodType<TaskMessagePayload> = z.object({
  task_id: z.string(),
  issue_id: z.string().default(""),
  chat_session_id: z.string().optional(),
  seq: z.number().default(0),
  // Enum drift defense: unknown server-side types fall back to "text" so
  // the row still renders (as a plain markdown chunk) instead of crashing
  // the timeline. Matches root CLAUDE.md "Enum drift downgrades, not crashes".
  type: z
    .enum(["text", "thinking", "tool_use", "tool_result", "error"])
    .catch("text"),
  tool: z.string().optional(),
  content: z.string().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  output: z.string().optional(),
  // Optional with no default: absent means no daemon measured this record's
  // completeness, which is not the same as measured-and-complete. `.catch`
  // keeps a malformed value from failing the row and emptying the transcript.
  output_truncated: z.boolean().optional().catch(undefined),
  created_at: z.string().optional(),
}).loose();

export const TaskMessageListSchema = z.array(TaskMessagePayloadSchema).default([]);

export const EMPTY_TASK_MESSAGE_LIST: TaskMessagePayload[] = [];

// =====================================================
// Search (issues + projects)
// =====================================================
// Mirrors SearchIssueResult / SearchProjectResult in packages/core/types/api.ts.
// Web does not currently route search responses through parseWithFallback, so
// the schemas live mobile-side. Promote to core when web adopts the same
// defense.
//
// match_source is the server's hint of which field matched. Enum-drift defense
// (root CLAUDE.md "Enum drift downgrades, not crashes"): unknown values fall
// back to "title" so the row still renders without a snippet line.

const SearchIssueResultSchema = IssueSchema.safeExtend({
  match_source: z.enum(["title", "description", "comment"]).catch("title"),
  matched_snippet: z.string().optional(),
});

export const SearchIssuesResponseSchema = z.object({
  issues: z.array(SearchIssueResultSchema).default([]),
}).loose();

export const EMPTY_SEARCH_ISSUES_RESPONSE: SearchIssuesResponse = {
  issues: [],
};

const SearchProjectResultSchema = ProjectSchema.safeExtend({
  match_source: z.enum(["title", "description"]).catch("title"),
  matched_snippet: z.string().optional(),
});

export const SearchProjectsResponseSchema = z.object({
  projects: z.array(SearchProjectResultSchema).default([]),
}).loose();

export const EMPTY_SEARCH_PROJECTS_RESPONSE: SearchProjectsResponse = {
  projects: [],
};

// =====================================================
// Agent tasks (per-issue runs, active + history)
// =====================================================
// Mirrors AgentTask in packages/core/types/agent.ts. Backend handlers:
//   GET  /api/issues/{id}/active-task → { tasks: AgentTask[] } (may be empty)
//   GET  /api/issues/{id}/task-runs   → AgentTask[]
// Lenient on every field — status / kind use `.catch()` so a future
// server-side enum value renders a generic fallback rather than crashing the
// row (root CLAUDE.md "Enum drift downgrades, not crashes"). failure_reason is
// an open string instead: its taxonomy grows on the backend's cadence, so a
// value this build has never seen must survive parsing and degrade at render.

export const AgentTaskSchema: z.ZodType<AgentTask> = z.object({
  id: z.string(),
  agent_id: z.string().default(""),
  runtime_id: z.string().default(""),
  issue_id: z.string().default(""),
  status: z
    .enum(["queued", "dispatched", "running", "completed", "failed", "cancelled"])
    .catch("queued"),
  priority: z.number().default(0),
  dispatched_at: z.string().nullable().default(null),
  started_at: z.string().nullable().default(null),
  completed_at: z.string().nullable().default(null),
  result: z.unknown().default(null),
  error: z.string().nullable().default(null),
  // Open string, not an enum — same contract as `failure_reason` in
  // packages/core/types/agent.ts and as the chat message schema above. The
  // backend taxonomy passed the six coarse values at MUL-1949 and keeps
  // growing (26 canonical reasons today), so an installed build meets reasons
  // it predates.
  //
  // This field WAS a closed six-value enum, which made the whole thing moot:
  // `.catch("")` erased every refined reason to `undefined`, so run-row's
  // badge map has been unreachable for anything but the coarse values since
  // MUL-5370 widened it, and every agent_error.* / skill_bundle_unavailable /
  // environment_prepare_failed run rendered a bare "Failed" (#7913). Unknown
  // reasons are the badge map's problem to degrade, not the parser's to drop.
  //
  // Backend uses empty string ("") as the "not failed" sentinel (Go
  // `omitempty` on a custom string-typed enum). Normalize that to `undefined`
  // so downstream truthy checks (`if (task.failure_reason)`) don't have to
  // special-case both null/undefined AND "".
  failure_reason: z
    .string()
    .optional()
    .catch(undefined)
    .transform((v) => (v === "" ? undefined : v)),
  created_at: z.string().default(""),
  chat_session_id: z.string().optional(),
  autopilot_run_id: z.string().optional(),
  parent_task_id: z.string().optional(),
  attempt: z.number().optional(),
  trigger_comment_id: z.string().optional(),
  trigger_summary: z.string().optional(),
  kind: z.enum(["comment", "autopilot", "chat", "quick_create", "direct"]).optional().catch("direct"),
  work_dir: z.string().optional(),
}).loose();

export const AgentTaskListSchema = z.array(AgentTaskSchema).default([]);

export const ActiveTasksResponseSchema = z.object({
  tasks: z.array(AgentTaskSchema).default([]),
}).loose();

export interface ActiveTasksResponse {
  tasks: AgentTask[];
}

export const EMPTY_AGENT_TASK_LIST: AgentTask[] = [];
export const EMPTY_ACTIVE_TASKS_RESPONSE: ActiveTasksResponse = { tasks: [] };

// =====================================================
// User / Workspace / Inbox / Member / Agent
// =====================================================
// Mobile reads these on every cold start (auth → workspaces → inbox → members
// → agents form the boot sequence). A schema drift in any of them used to
// cascade — getMe failure flushed the user, listWorkspaces failure landed the
// app on the workspace picker with no entries. With parseWithFallback every
// drift downgrades to "stale defaults render", and the user can keep working.
//
// All five are `.loose()` so additive backend fields (`onboarded_at` style
// flags) pass through without breaking parsing. Required identity fields
// (id, slug, etc.) stay required — a response that genuinely lacks them is
// unusable and parseWithFallback should fall back to the empty sentinel.

export const UserSchema: z.ZodType<User> = z.object({
  id: z.string(),
  name: z.string().default(""),
  email: z.string().default(""),
  avatar_url: z.string().nullable().default(null),
  onboarded_at: z.string().nullable().default(null),
  onboarding_questionnaire: z.record(z.string(), z.unknown()).default({}),
  starter_content_state: z.string().nullable().default(null),
  language: z.string().nullable().default(null),
  profile_description: z.string().default(""),
  timezone: z.string().nullable().default(null),
  created_at: z.string().default(""),
  updated_at: z.string().default(""),
}).loose();

// `id: ""` is the sentinel for "drifted / unauthenticated"; downstream code
// that switches on `user.id` will treat empty-string as a logged-out state
// (the auth hook also clears the cache on 401, so this is rarely seen).
export const EMPTY_USER: User = {
  id: "",
  name: "",
  email: "",
  avatar_url: null,
  onboarded_at: null,
  onboarding_questionnaire: {},
  starter_content_state: null,
  language: null,
  profile_description: "",
  timezone: null,
  created_at: "",
  updated_at: "",
};

export const WorkspaceSchema: z.ZodType<Workspace> = z.object({
  id: z.string(),
  name: z.string().default(""),
  slug: z.string().default(""),
  description: z.string().nullable().default(null),
  context: z.string().nullable().default(null),
  settings: z.record(z.string(), z.unknown()).default({}),
  repos: z.array(z.object({ url: z.string() }).loose()).default([]),
  issue_prefix: z.string().default(""),
  avatar_url: z.string().nullable().default(null),
  created_at: z.string().default(""),
  updated_at: z.string().default(""),
}).loose();

export const WorkspaceListSchema = z.array(WorkspaceSchema).default([]);
export const EMPTY_WORKSPACE_LIST: Workspace[] = [];

/** Pin metadata only — display fields (title / status / icon) are NOT here,
 *  consumers derive them from `issueDetailOptions` / `projectDetailOptions`.
 *  Matches the design in packages/core/types/pin.ts. */
export const PinnedItemSchema: z.ZodType<PinnedItem> = z.object({
  id: z.string(),
  workspace_id: z.string().default(""),
  user_id: z.string().default(""),
  item_type: z.enum(["issue", "project"]).catch("issue"),
  item_id: z.string(),
  position: z.number().default(0),
  created_at: z.string().default(""),
}).loose();

export const PinListSchema = z.array(PinnedItemSchema).default([]);
export const EMPTY_PIN_LIST: PinnedItem[] = [];

const InboxItemSchema: z.ZodType<InboxItem> = z.object({
  id: z.string(),
  workspace_id: z.string().default(""),
  // Recipient is always a real actor in the dataset, but defend against
  // either field going missing — mobile's actor lookup tolerates null.
  recipient_type: z.enum(["member", "agent"]).catch("member"),
  recipient_id: z.string().default(""),
  // `actor_type` includes "system" for platform-triggered notifications
  // (packages/core/types/inbox.ts:28). ActorAvatar handles all three plus
  // null. Enum drift falls back to null so the row still renders without an
  // avatar instead of crashing the list.
  actor_type: z
    .enum(["member", "agent", "system"])
    .nullable()
    .catch(null),
  actor_id: z.string().nullable().default(null),
  // `type` discriminates the rendered detail-label. Unknown values pass
  // through as raw strings — `InboxDetailLabel` has a default branch that
  // shows the raw type as fallback (components/inbox/detail-label.tsx).
  type: z.string() as unknown as z.ZodType<InboxItem["type"]>,
  severity: z
    .enum(["action_required", "attention", "info"])
    .catch("info"),
  issue_id: z.string().nullable().default(null),
  title: z.string().default(""),
  body: z.string().nullable().default(null),
  issue_status: z.string().nullable().default(null) as unknown as z.ZodType<
    InboxItem["issue_status"]
  >,
  read: z.boolean().default(false),
  archived: z.boolean().default(false),
  created_at: z.string().default(""),
  details: z.record(z.string(), z.string()).nullable().default(null),
}).loose();

export const InboxListSchema = z.array(InboxItemSchema).default([]);
export const EMPTY_INBOX_LIST: InboxItem[] = [];

// Cross-workspace unread summary (`GET /api/inbox/unread-summary`): one entry
// per workspace the user belongs to that has unread items, already
// deduplicated per issue server-side. Backs the inbox tab badge. Mirrors
// InboxUnreadSummarySchema in packages/core/api/schemas.ts. On malformed JSON
// the fallback is an empty list, which reads as "nothing unread" — the badge
// simply hides rather than showing a wrong number.
const InboxWorkspaceUnreadSchema: z.ZodType<InboxWorkspaceUnread> = z
  .object({
    workspace_id: z.string(),
    count: z.number().catch(0),
  })
  .loose();

export const InboxUnreadSummarySchema = z
  .array(InboxWorkspaceUnreadSchema)
  .default([]);
export const EMPTY_INBOX_UNREAD_SUMMARY: InboxWorkspaceUnread[] = [];

export const MemberWithUserSchema: z.ZodType<MemberWithUser> = z.object({
  id: z.string(),
  workspace_id: z.string().default(""),
  user_id: z.string().default(""),
  role: z.enum(["owner", "admin", "member"]).catch("member"),
  created_at: z.string().default(""),
  name: z.string().default(""),
  email: z.string().default(""),
  avatar_url: z.string().nullable().default(null),
}).loose();

export const MemberListSchema = z.array(MemberWithUserSchema).default([]);
export const EMPTY_MEMBER_LIST: MemberWithUser[] = [];

const AgentInvocationTargetSchema: z.ZodType<AgentInvocationTarget> = z
  .object({
    target_type: z.enum(["workspace", "member", "team"]).catch("team"),
    target_id: z
      .string()
      .nullable()
      .optional()
      .catch(null)
      .transform((v) => v ?? null),
  })
  .loose();

// Agent schema is loose on every enum / structural field — the agent table is
// where new modes/visibilities/statuses get added most often. We need only id,
// name, avatar_url, and a couple of flags for the assignee picker + chat
// header; everything else is informational and safe to default.
export const AgentSchema: z.ZodType<Agent> = z.object({
  id: z.string(),
  workspace_id: z.string().default(""),
  runtime_id: z.string().default(""),
  runtime_bound: z.boolean().optional(),
  name: z.string().default(""),
  description: z.string().default(""),
  instructions: z.string().default(""),
  conversation_starters: z
    .array(
      z
        .object({
          label: z.string().default(""),
          prompt: z.string().default(""),
        })
        .loose(),
    )
    .catch([])
    .default([]),
  avatar_url: z.string().nullable().default(null),
  runtime_mode: z.string().catch("daemon") as unknown as z.ZodType<
    Agent["runtime_mode"]
  >,
  runtime_config: z.record(z.string(), z.unknown()).default({}),
  custom_args: z.array(z.string()).default([]),
  // MUL-2600: agent resource shape no longer carries custom_env or
  // custom_env_redacted. Mobile keeps only the coarse metadata that
  // mirrors web's expectations. Real env values are reachable via the
  // dedicated /env endpoint and we don't expose env editing on mobile.
  has_custom_env: z.boolean().optional(),
  custom_env_key_count: z.number().optional(),
  visibility: z.string().catch("workspace") as unknown as z.ZodType<
    Agent["visibility"]
  >,
  permission_mode: z.enum(["private", "public_to"]).catch("private"),
  invocation_targets: z.array(AgentInvocationTargetSchema).default([]),
  status: z.string().catch("active") as unknown as z.ZodType<Agent["status"]>,
  max_concurrent_tasks: z.number().default(1),
  model: z.string().default(""),
  owner_id: z.string().nullable().default(null),
  skills: z.array(z.unknown()).default([]) as unknown as z.ZodType<
    Agent["skills"]
  >,
  created_at: z.string().default(""),
  updated_at: z.string().default(""),
  archived_at: z.string().nullable().default(null),
  archived_by: z.string().nullable().default(null),
}).loose();

export const AgentListSchema = z.array(AgentSchema).default([]);
export const EMPTY_AGENT_LIST: Agent[] = [];

// Runtime device — the daemon (local or cloud) an agent binds to. Mobile reads
// it for the presence dot: `status` + `last_seen_at` drive the three-state
// availability derivation in @multica/core/agents/derive-presence. All other
// fields default safely so a backend that adds optional new metadata
// (timezone, visibility flags, etc.) doesn't break the parse.
export const RuntimeSchema: z.ZodType<RuntimeDevice> = z.object({
  id: z.string(),
  workspace_id: z.string().default(""),
  daemon_id: z.string().nullable().default(null),
  name: z.string().default(""),
  runtime_mode: z.string().catch("local") as unknown as z.ZodType<
    RuntimeDevice["runtime_mode"]
  >,
  provider: z.string().default(""),
  launch_header: z.string().default(""),
  // The two fields presence derivation actually reads. Status defaults to
  // "offline" — a runtime row with an unparseable status is treated as
  // unreachable, which is the safe degrade for the dot.
  status: z.enum(["online", "offline"]).catch("offline"),
  last_seen_at: z.string().nullable().default(null),
  device_info: z.string().default(""),
  metadata: z.record(z.string(), z.unknown()).default({}),
  owner_id: z.string().nullable().default(null),
  visibility: z.string().catch("private") as unknown as z.ZodType<
    RuntimeDevice["visibility"]
  >,
  timezone: z.string().default(""),
  created_at: z.string().default(""),
  updated_at: z.string().default(""),
}).loose();

export const RuntimeListSchema = z.array(RuntimeSchema).default([]);
export const EMPTY_RUNTIME_LIST: RuntimeDevice[] = [];

// Squad member preview — the server attaches up to three of these per squad
// (server/internal/handler/squad.go `addSquadMemberPreview`) so a list row can
// show a member stack without a per-squad request. Declared before SquadSchema
// because that schema evaluates this one at module-init time.
export const SquadMemberPreviewSchema: z.ZodType<SquadMemberPreview> = z
  .object({
    // Two values on the wire, same as the roster's own member_type.
    member_type: z.enum(["agent", "member"]).catch("agent"),
    member_id: z.string().default(""),
    role: z.string().default(""),
  })
  .loose();

// Squad schema — fields mobile consumes for the @mention suggestion bar (id,
// name, archived_at filter) and for the read-only Squads views (member count /
// preview, leader) plus identity/timestamp fields that are safe to default.
// `.loose()` so the server can add squad fields without breaking the parser.
export const SquadSchema: z.ZodType<Squad> = z.object({
  id: z.string(),
  workspace_id: z.string().default(""),
  name: z.string().default(""),
  description: z.string().default(""),
  instructions: z.string().default(""),
  avatar_url: z.string().nullable().default(null),
  leader_id: z.string().default(""),
  creator_id: z.string().default(""),
  created_at: z.string().default(""),
  updated_at: z.string().default(""),
  archived_at: z.string().nullable().default(null),
  archived_by: z.string().nullable().default(null),
  member_count: z.number().default(0),
  member_preview: z.array(SquadMemberPreviewSchema).default([]),
}).loose();

export const SquadListSchema = z.array(SquadSchema).default([]);
export const EMPTY_SQUAD_LIST: Squad[] = [];

// Single-issue fallback used by getIssue. Mobile reuses IssueSchema from core
// for parsing; this sentinel lets parseWithFallback yield a structurally-
// valid Issue when the response drifts. `id: ""` flags drift downstream — the
// detail screen treats it as "issue not found" and shows the empty state.
export const EMPTY_ISSUE_FALLBACK: import("@multica/core/types").Issue = {
  id: "",
  workspace_id: "",
  number: 0,
  identifier: "",
  title: "",
  description: null,
  status: "backlog",
  priority: "none",
  assignee_type: null,
  assignee_id: null,
  creator_type: "member",
  creator_id: "",
  parent_issue_id: null,
  project_id: null,
  position: 0,
  stage: null,
  start_date: null,
  due_date: null,
  metadata: {},
  properties: {},
  created_at: "",
  updated_at: "",
};

// Helpers re-exported for ergonomic single-import at the call site.
export type { Label, Project, ProjectResource };

// --- Autopilots: detail payload + run history ---
//
// The list response and the single-run response already have core schemas
// (`ListAutopilotsResponseSchema` / `AutopilotRunSchema`), and this file's
// detail/run-list envelopes parse their rows with the core run schema. What
// core does not schematise yet is the detail payload (`{ autopilot, triggers }`)
// and the run-list envelope, so those live here like the rest of this file.
//
// Every closed vocabulary (`status`, `execution_mode`, `assignee_type`, trigger
// `kind`) stays a lenient `z.string()` behind a `ZodType<...>` cast: the server
// owns these enums, so a value this build predates must degrade to the generic
// UI fallback instead of failing the parse and blanking the screen.

export const AutopilotSchema: z.ZodType<Autopilot> = z
  .object({
    id: z.string(),
    workspace_id: z.string().default(""),
    title: z.string().default(""),
    description: z.string().nullable().default(null),
    project_id: z.string().nullable().optional(),
    assignee_type: z
      .string()
      .catch("agent") as unknown as z.ZodType<Autopilot["assignee_type"]>,
    assignee_id: z.string().default(""),
    // Unreadable status degrades to "paused": the safe direction is the one
    // that does NOT offer Run now for a state we could not confirm.
    status: z.string().catch("paused") as unknown as z.ZodType<
      Autopilot["status"]
    >,
    pause_reason: z.string().nullable().optional(),
    execution_mode: z
      .string()
      .catch("create_issue") as unknown as z.ZodType<
      Autopilot["execution_mode"]
    >,
    issue_title_template: z.string().nullable().default(null),
    created_by_type: z.string().default(""),
    created_by_id: z.string().default(""),
    last_run_at: z.string().nullable().default(null),
    created_at: z.string().default(""),
    updated_at: z.string().default(""),
    // List-endpoint-only derived fields; absent on detail/create/update.
    trigger_kinds: z.array(z.string()).optional(),
    next_run_at: z.string().nullable().optional(),
    last_run_status: z.string().nullable().optional(),
    // Per-caller capability flags; absent on older servers (treated as unknown).
    can_write: z.boolean().optional(),
    can_manage_access: z.boolean().optional(),
  })
  .loose();

export const AutopilotTriggerSchema: z.ZodType<AutopilotTrigger> = z
  .object({
    id: z.string(),
    autopilot_id: z.string().default(""),
    kind: z.string().catch("schedule") as unknown as z.ZodType<
      AutopilotTrigger["kind"]
    >,
    enabled: z.boolean().default(false),
    cron_expression: z.string().nullable().default(null),
    timezone: z.string().nullable().default(null),
    next_run_at: z.string().nullable().default(null),
    webhook_token: z.string().nullable().default(null),
    webhook_path: z.string().nullable().optional(),
    webhook_url: z.string().nullable().optional(),
    label: z.string().nullable().default(null),
    event_filters: z
      .array(
        z
          .object({
            event: z.string(),
            actions: z.array(z.string()).optional(),
          })
          .loose(),
      )
      .nullable()
      .optional(),
    last_fired_at: z.string().nullable().default(null),
    created_at: z.string().default(""),
    updated_at: z.string().default(""),
  })
  .loose();

// `GET /api/autopilots/{id}` — the autopilot plus its triggers. Collaborators
// ride along on newer servers; nothing on mobile reads them, and `.loose()`
// keeps them out of the way.
export const AutopilotDetailSchema = z
  .object({
    autopilot: AutopilotSchema,
    triggers: z.array(AutopilotTriggerSchema).default([]),
  })
  .loose();

// Drift sentinel: `id: ""` makes the detail screen render its not-found state
// instead of an empty shell when the payload could not be read.
export const EMPTY_AUTOPILOT: Autopilot = {
  id: "",
  workspace_id: "",
  title: "",
  description: null,
  assignee_type: "agent",
  assignee_id: "",
  status: "paused",
  execution_mode: "create_issue",
  issue_title_template: null,
  created_by_type: "member",
  created_by_id: "",
  last_run_at: null,
  created_at: "",
  updated_at: "",
};

export const EMPTY_AUTOPILOT_DETAIL: GetAutopilotResponse = {
  autopilot: EMPTY_AUTOPILOT,
  triggers: [],
};

// `GET /api/autopilots/{id}/runs` envelope. Rows validate against the core run
// schema — the same one web's run-now flow parses — so a new run status or
// reason_code reaches mobile without a second definition.
export const AutopilotRunListSchema = z
  .object({
    runs: z.array(AutopilotRunSchema).default([]),
    total: z.number().default(0),
  })
  .loose();

// The two list envelopes this feature parses. Typed by their wire contract
// rather than inferred from an empty literal, so the unwrapped arrays the api
// layer hands back are checked against the real shape.
export const EMPTY_AUTOPILOT_LIST: ListAutopilotsResponse = {
  autopilots: [],
  total: 0,
};

export const EMPTY_AUTOPILOT_RUN_LIST: ListAutopilotRunsResponse = {
  runs: [],
  total: 0,
};

// ---------------------------------------------------------------------------
// Runtimes — usage summary (FEATURE-569)
// ---------------------------------------------------------------------------

// One (date, provider, model) bucket of a runtime's daily usage. Cost arrives
// as ticks (1e-10 USD) because the provider's own charge is authoritative; the
// `uncosted_*` counts are the tokens that provider did not price and are
// optional because a backend older than the split omits them. Field names stay
// exactly as the wire spells them, so the api layer unwraps the real contract
// instead of a renamed copy.
export const RuntimeUsageSchema: z.ZodType<RuntimeUsage> = z
  .object({
    runtime_id: z.string().default(""),
    date: z.string(),
    provider: z.string().default(""),
    model: z.string().default(""),
    input_tokens: z.number().default(0),
    output_tokens: z.number().default(0),
    cache_read_tokens: z.number().default(0),
    cache_write_tokens: z.number().default(0),
    cost_usd_ticks: z.number().optional(),
    uncosted_input_tokens: z.number().optional(),
    uncosted_output_tokens: z.number().optional(),
    uncosted_cache_read_tokens: z.number().optional(),
    uncosted_cache_write_tokens: z.number().optional(),
  })
  .loose();

export const RuntimeUsageListSchema = z.array(RuntimeUsageSchema).default([]);
export const EMPTY_RUNTIME_USAGE_LIST: RuntimeUsage[] = [];

// ---------------------------------------------------------------------------
// Squads — member roster (FEATURE-569)
// ---------------------------------------------------------------------------

// `GET /api/squads/{id}/members`. `member_id` points at an agent or a human
// depending on `member_type`; the roster resolves names through the workspace
// lists, so this schema only has to carry the pair intact. Catching an unknown
// member_type to "agent" keeps a future server-side kind from failing the whole
// roster.
export const SquadMemberSchema: z.ZodType<SquadMember> = z
  .object({
    id: z.string(),
    squad_id: z.string().default(""),
    // Two values on the wire. An unknown third kind catches to "agent" rather
    // than failing the whole roster — the same rule the runtime status field uses.
    member_type: z.enum(["agent", "member"]).catch("agent"),
    member_id: z.string().default(""),
    role: z.string().default(""),
    created_at: z.string().default(""),
  })
  .loose();

export const SquadMemberListSchema = z.array(SquadMemberSchema).default([]);
export const EMPTY_SQUAD_MEMBER_LIST: SquadMember[] = [];

// ---------------------------------------------------------------------------
// Skills — read-only detail (FEATURE-569)
// ---------------------------------------------------------------------------

// `GET /api/skills/{id}?include=metadata`: the list shape plus `content_size`
// (the SKILL.md byte length that `content` would have carried) and per-file
// size/hash instead of per-file bodies. Mobile's detail page lists files
// read-only, so bodies would be payload thrown away on arrival — and a single
// SKILL.md routinely runs 50-200KB (server/internal/handler/skill.go:107-121),
// which is exactly why the server made this shrink opt-in for the CLI.
export const SkillFileMetadataSchema: z.ZodType<SkillFileMetadata> = z
  .object({
    id: z.string().default(""),
    skill_id: z.string().default(""),
    path: z.string(),
    size: z.number().default(0),
    content_hash: z.string().default(""),
    created_at: z.string().default(""),
    updated_at: z.string().default(""),
  })
  .loose();

export interface SkillFileMetadata {
  id: string;
  skill_id: string;
  path: string;
  size: number;
  content_hash: string;
  created_at: string;
  updated_at: string;
}

// The skill's own fields reuse the core summary schema: the list endpoint and
// this one return the same summary shape, so a second definition here would be
// a second thing to keep in step. The response is FLAT — Go embeds
// SkillSummaryResponse inside SkillWithFileMetadataResponse
// (server/internal/handler/skill.go:136-149), so the summary's fields sit
// beside `content_size`, not under a `skill` key.
//
// The cast is the same one this file already uses for a wire value narrower
// than the schema can express: core's `labels` parses `resource_type` as a
// plain string, so the extended object does not structurally satisfy
// `SkillSummary` without it.
export const SkillDetailSchema = SkillSummarySchema.extend({
    content_size: z.number().default(0),
    files: z.array(SkillFileMetadataSchema).default([]),
  })
  .loose() as unknown as z.ZodType<SkillDetail>;

export interface SkillDetail extends SkillSummary {
  /** Byte length of the SKILL.md body this response omits. */
  content_size: number;
  files: SkillFileMetadata[];
}

// Drift sentinel: `id: ""` makes the detail screen render its not-found state
// instead of an empty shell, the same contract the agent/autopilot details use.
export const EMPTY_SKILL_DETAIL: SkillDetail = {
  ...EMPTY_SKILL_SUMMARY,
  content_size: 0,
  files: [],
};
