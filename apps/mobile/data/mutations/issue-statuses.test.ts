import { QueryClient } from "@tanstack/react-query";
import type * as ReactQuery from "@tanstack/react-query";
import type { IssueStatusCategory, IssueStatusEntry } from "@multica/core/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "@/data/api";
import { issueStatusKeys } from "@/data/queries/issue-statuses";
import {
  issueStatusArchiveConflictCount,
  useArchiveIssueStatus,
  useCreateIssueStatus,
  useReorderIssueStatuses,
  useUpdateIssueStatus,
} from "./issue-statuses";

// The real client refuses to load without a base URL; set it before the import
// runs so the mocked module can still spread the real exports (ApiError).
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_URL = "https://api.example.test";
});

const state = vi.hoisted(() => ({
  qc: undefined as unknown as QueryClient,
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactQuery>();
  return {
    ...actual,
    useQueryClient: () => state.qc,
    // Drive the hook through a real MutationObserver so the test runs the same
    // mutate → onSuccess → onSettled lifecycle as the app.
    useMutation: (
      options: ConstructorParameters<typeof actual.MutationObserver>[1],
    ) => {
      const observer = new actual.MutationObserver(state.qc, options);
      return { mutateAsync: (variables: unknown) => observer.mutate(variables) };
    },
  };
});

vi.mock("@/data/api", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactQuery>();
  return {
    ...actual,
    api: {
      createIssueStatus: vi.fn(),
      updateIssueStatus: vi.fn(),
      archiveIssueStatus: vi.fn(),
      reorderIssueStatuses: vi.fn(),
    },
  };
});

vi.mock("@/data/workspace-store", () => ({
  useWorkspaceStore: (
    selector: (s: { currentWorkspaceId: string }) => unknown,
  ) => selector({ currentWorkspaceId: "workspace-1" }),
}));

const wsId = "workspace-1";
const catalogKey = issueStatusKeys.list(wsId);

function entry(
  id: string,
  overrides: Partial<IssueStatusEntry> = {},
): IssueStatusEntry {
  return {
    id,
    workspace_id: wsId,
    key: id,
    name: id,
    description: "",
    category: "started",
    color: "#3b82f6",
    icon: null,
    is_system: false,
    position: 1,
    archived_at: null,
    created_at: "2026-09-19T00:00:00Z",
    updated_at: "2026-09-19T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  state.qc = new QueryClient();
  vi.resetAllMocks();
});

describe("useCreateIssueStatus", () => {
  // The new row belongs where its position puts it, not at the bottom of the
  // array — appending would render it under a later category's rows until the
  // settle-time refetch landed.
  it("inserts the created status at its position", async () => {
    state.qc.setQueryData<IssueStatusEntry[]>(catalogKey, [
      entry("later", { position: 2 }),
      entry("earlier", { position: 1 }),
    ]);
    vi.mocked(api.createIssueStatus).mockResolvedValue(
      entry("middle", { position: 1.5 }),
    );

    await useCreateIssueStatus().mutateAsync({
      name: "Middle",
      category: "started",
      color: "#3b82f6",
    });

    expect(
      state.qc.getQueryData<IssueStatusEntry[]>(catalogKey)?.map((e) => e.id),
    ).toEqual(["earlier", "middle", "later"]);
  });

  // A malformed 2xx parses to the empty entry; caching it would add a nameless
  // row that the next refetch has to remove.
  it("ignores a response that parsed to nothing", async () => {
    state.qc.setQueryData<IssueStatusEntry[]>(catalogKey, [entry("existing")]);
    vi.mocked(api.createIssueStatus).mockResolvedValue(entry("", { id: "" }));

    await useCreateIssueStatus().mutateAsync({
      name: "Middle",
      category: "started",
      color: "#3b82f6",
    });

    expect(
      state.qc.getQueryData<IssueStatusEntry[]>(catalogKey)?.map((e) => e.id),
    ).toEqual(["existing"]);
  });

  it("refetches the catalog once the write settles", async () => {
    state.qc.setQueryData<IssueStatusEntry[]>(catalogKey, []);
    vi.mocked(api.createIssueStatus).mockResolvedValue(entry("qa"));

    await useCreateIssueStatus().mutateAsync({
      name: "QA",
      category: "started",
      color: "#3b82f6",
    });

    expect(state.qc.getQueryState(catalogKey)?.isInvalidated).toBe(true);
  });
});

describe("useUpdateIssueStatus", () => {
  it("replaces the edited row in place", async () => {
    state.qc.setQueryData<IssueStatusEntry[]>(catalogKey, [
      entry("qa", { position: 1 }),
      entry("gate", { position: 2 }),
    ]);
    vi.mocked(api.updateIssueStatus).mockResolvedValue(
      entry("gate", { position: 2, name: "Gate approved", color: "#22c55e" }),
    );

    await useUpdateIssueStatus().mutateAsync({
      id: "gate",
      body: { name: "Gate approved", color: "#22c55e" },
    });

    const cached = state.qc.getQueryData<IssueStatusEntry[]>(catalogKey);
    expect(cached?.map((e) => e.id)).toEqual(["qa", "gate"]);
    expect(cached?.[1]).toMatchObject({
      name: "Gate approved",
      color: "#22c55e",
    });
  });
});

describe("useArchiveIssueStatus", () => {
  // Not optimistic on purpose: the 409 "issues still use this status" answer
  // is the whole point of the confirm step, and a row that vanished before the
  // server agreed would have to be put back in order to show it.
  it("leaves the row live until the server agrees", async () => {
    state.qc.setQueryData<IssueStatusEntry[]>(catalogKey, [entry("gate")]);
    let resolveArchive!: (value: IssueStatusEntry) => void;
    vi.mocked(api.archiveIssueStatus).mockReturnValue(
      new Promise<IssueStatusEntry>((resolve) => {
        resolveArchive = resolve;
      }),
    );

    const pending = useArchiveIssueStatus().mutateAsync("gate");

    expect(
      state.qc.getQueryData<IssueStatusEntry[]>(catalogKey)?.[0]?.archived_at,
    ).toBeNull();

    resolveArchive(entry("gate", { archived_at: "2026-09-19T10:00:00Z" }));
    await pending;

    expect(
      state.qc.getQueryData<IssueStatusEntry[]>(catalogKey)?.[0]?.archived_at,
    ).toBe("2026-09-19T10:00:00Z");
  });
});

describe("useReorderIssueStatuses", () => {
  // Built-ins are draggable in the settings list, so the request has to opt
  // them into the scope — the endpoint refuses a payload that omits a row it
  // considers in-scope.
  it("sends the category scope with built-ins included", async () => {
    vi.mocked(api.reorderIssueStatuses).mockResolvedValue({
      statuses: [entry("qa")],
      categories: ["unstarted", "started", "done", "closed"],
      total: 1,
    });

    await useReorderIssueStatuses().mutateAsync({
      category: "started",
      ids: ["qa", "gate"],
    });

    expect(api.reorderIssueStatuses).toHaveBeenCalledWith(
      "started",
      ["qa", "gate"],
      true,
    );
  });

  // The response IS the whole catalog, archived rows included, so it is taken
  // as the new cache rather than re-derived from the requested id order.
  it("adopts the response catalog, archived rows included", async () => {
    state.qc.setQueryData<IssueStatusEntry[]>(catalogKey, [entry("stale")]);
    vi.mocked(api.reorderIssueStatuses).mockResolvedValue({
      statuses: [
        entry("gate", { position: 1 }),
        entry("retired", { archived_at: "2026-01-01T00:00:00Z" }),
      ],
      categories: ["unstarted", "started", "done", "closed"],
      total: 2,
    });

    await useReorderIssueStatuses().mutateAsync({
      category: "started" as IssueStatusCategory,
      ids: ["gate"],
    });

    expect(
      state.qc.getQueryData<IssueStatusEntry[]>(catalogKey)?.map((e) => e.id),
    ).toEqual(["gate", "retired"]);
  });
});

describe("issueStatusArchiveConflictCount", () => {
  // This decides whether the dialog quotes a number or falls back to the
  // generic copy, so a body that does not match exactly must not be read as a
  // count.
  it("reads the count out of an in-use refusal", () => {
    const error = new ApiError("conflict", 409, {
      code: "issue_status_in_use",
      issue_count: 3,
    });

    expect(issueStatusArchiveConflictCount(error)).toBe(3);
  });

  it.each([
    ["a different status", new ApiError("forbidden", 403, { code: "issue_status_in_use", issue_count: 3 })],
    ["another conflict code", new ApiError("conflict", 409, { code: "other", issue_count: 3 })],
    ["a zero count", new ApiError("conflict", 409, { code: "issue_status_in_use", issue_count: 0 })],
    ["a body-less conflict", new ApiError("conflict", 409)],
    ["a plain error", new Error("409")],
    ["no error at all", undefined],
  ])("stays null for %s", (_label, error) => {
    expect(issueStatusArchiveConflictCount(error)).toBeNull();
  });
});
