import { QueryClient } from "@tanstack/react-query";
import type { Issue, Label } from "@multica/core/types";
import type * as ReactQuery from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/data/api";
import { issueKeys } from "@/data/queries/issue-keys";
import { labelKeys } from "@/data/queries/labels";
import { useCreateLabel, useDeleteLabel, useUpdateLabel } from "./labels";

const state = vi.hoisted(() => ({
  qc: undefined as unknown as QueryClient,
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactQuery>();
  return {
    ...actual,
    // Drive the hook through a real MutationObserver so the test runs the
    // same mutate → onMutate → onSettled lifecycle as the app.
    useQueryClient: () => state.qc,
    useMutation: (
      options: ConstructorParameters<typeof actual.MutationObserver>[1],
    ) => {
      const observer = new actual.MutationObserver(state.qc, options);
      return { mutateAsync: (variables: unknown) => observer.mutate(variables) };
    },
  };
});

vi.mock("@/data/api", () => ({
  api: {
    createLabel: vi.fn(),
    updateLabel: vi.fn(),
    deleteLabel: vi.fn(async () => undefined),
  },
}));

vi.mock("@/data/workspace-store", () => ({
  useWorkspaceStore: (
    selector: (s: { currentWorkspaceId: string }) => unknown,
  ) => selector({ currentWorkspaceId: "workspace-1" }),
}));

const wsId = "workspace-1";
const issueCatalog = labelKeys.list(wsId, "issue");
const skillCatalog = labelKeys.list(wsId, "skill");

function label(id: string, overrides: Partial<Label> = {}): Label {
  return {
    id,
    workspace_id: wsId,
    resource_type: "issue",
    name: "Bug",
    color: "#ef4444",
    created_at: "2026-09-19T00:00:00Z",
    updated_at: "2026-09-19T00:00:00Z",
    ...overrides,
  };
}

// A fresh cache per test, and mock implementations back at their defaults:
// `mockRejectedValue` sticks to the fn, so a rejection set in one case would
// otherwise make the next one fail for the wrong reason.
beforeEach(() => {
  state.qc = new QueryClient();
  vi.resetAllMocks();
  vi.mocked(api.deleteLabel).mockResolvedValue(undefined);
});

describe("useCreateLabel", () => {
  // The create body may omit `resource_type` and let the server default it, so
  // the cache patch has to follow the RESPONSE. Patching the requested catalog
  // instead would drop a skill label into the issue list.
  it("appends to the catalog the server filed the label under", async () => {
    state.qc.setQueryData<Label[]>(issueCatalog, [label("issue-1")]);
    state.qc.setQueryData<Label[]>(skillCatalog, []);
    vi.mocked(api.createLabel).mockResolvedValue(
      label("skill-1", { resource_type: "skill", name: "Deploy" }),
    );

    await useCreateLabel().mutateAsync({ name: "Deploy", color: "#3b82f6" });

    expect(state.qc.getQueryData<Label[]>(skillCatalog)?.map((l) => l.id)).toEqual([
      "skill-1",
    ]);
    expect(state.qc.getQueryData<Label[]>(issueCatalog)?.map((l) => l.id)).toEqual([
      "issue-1",
    ]);
  });

  // Seeding an unfetched catalog would show a one-row list until its first
  // fetch resolved, which reads as "every other label disappeared".
  it("does not invent a catalog that was never fetched", async () => {
    state.qc.setQueryData<Label[]>(issueCatalog, []);
    vi.mocked(api.createLabel).mockResolvedValue(
      label("skill-1", { resource_type: "skill" }),
    );

    await useCreateLabel().mutateAsync({ name: "Deploy", color: "#3b82f6" });

    expect(state.qc.getQueryData(skillCatalog)).toBeUndefined();
  });

  it("refetches the catalogs once the write settles", async () => {
    state.qc.setQueryData<Label[]>(issueCatalog, []);
    vi.mocked(api.createLabel).mockResolvedValue(label("issue-1"));

    await useCreateLabel().mutateAsync({ name: "Bug", color: "#ef4444" });

    expect(state.qc.getQueryState(issueCatalog)?.isInvalidated).toBe(true);
  });
});

describe("useUpdateLabel", () => {
  // The single-label serializer answers `usage_count: 0` — writing the PUT
  // response into the cache would blank the "used by N" figure until the
  // settle-time refetch landed, so the optimistic patch must stand.
  it("keeps the usage count the PUT response cannot report", async () => {
    state.qc.setQueryData<Label[]>(issueCatalog, [
      label("l1", { usage_count: 7 }),
    ]);
    vi.mocked(api.updateLabel).mockResolvedValue(
      label("l1", { name: "Defect", usage_count: 0 }),
    );

    await useUpdateLabel().mutateAsync({ id: "l1", body: { name: "Defect" } });

    expect(state.qc.getQueryData<Label[]>(issueCatalog)?.[0]).toMatchObject({
      name: "Defect",
      usage_count: 7,
    });
  });

  it("rolls the rename back when the server refuses it", async () => {
    state.qc.setQueryData<Label[]>(issueCatalog, [label("l1")]);
    vi.mocked(api.updateLabel).mockRejectedValue(new Error("name already taken"));

    await expect(
      useUpdateLabel().mutateAsync({ id: "l1", body: { name: "Taken" } }),
    ).rejects.toThrow("name already taken");

    expect(state.qc.getQueryData<Label[]>(issueCatalog)?.[0]?.name).toBe("Bug");
  });

  // Issue rows carry a snapshot of their labels, so a rename that only touched
  // the catalog would leave every open issue showing the old name.
  it("refreshes the issue rows that embed the label", async () => {
    const detailKey = issueKeys.detail(wsId, "issue-1");
    state.qc.setQueryData<Label[]>(issueCatalog, [label("l1")]);
    state.qc.setQueryData<Issue>(detailKey, { id: "issue-1" } as Issue);
    vi.mocked(api.updateLabel).mockResolvedValue(label("l1", { name: "Defect" }));

    await useUpdateLabel().mutateAsync({ id: "l1", body: { name: "Defect" } });

    expect(state.qc.getQueryState(detailKey)?.isInvalidated).toBe(true);
  });
});

describe("useDeleteLabel", () => {
  it("drops the row from every cached catalog", async () => {
    state.qc.setQueryData<Label[]>(issueCatalog, [label("l1"), label("l2")]);
    state.qc.setQueryData<Label[]>(skillCatalog, [label("l1")]);

    await useDeleteLabel().mutateAsync("l1");

    expect(state.qc.getQueryData<Label[]>(issueCatalog)?.map((l) => l.id)).toEqual([
      "l2",
    ]);
    expect(state.qc.getQueryData<Label[]>(skillCatalog)).toEqual([]);
  });

  it("puts the rows back when the delete fails", async () => {
    state.qc.setQueryData<Label[]>(issueCatalog, [label("l1"), label("l2")]);
    vi.mocked(api.deleteLabel).mockRejectedValue(new Error("label in use"));

    await expect(useDeleteLabel().mutateAsync("l1")).rejects.toThrow(
      "label in use",
    );

    expect(state.qc.getQueryData<Label[]>(issueCatalog)?.map((l) => l.id)).toEqual([
      "l1",
      "l2",
    ]);
  });

  // The server clears the issue links in the same transaction; the cached
  // issue rows still name the label until they are refetched.
  it("refreshes the issue rows that embedded the label", async () => {
    const detailKey = issueKeys.detail(wsId, "issue-1");
    state.qc.setQueryData<Label[]>(issueCatalog, [label("l1")]);
    state.qc.setQueryData<Issue>(detailKey, { id: "issue-1" } as Issue);

    await useDeleteLabel().mutateAsync("l1");

    expect(state.qc.getQueryState(detailKey)?.isInvalidated).toBe(true);
  });
});
