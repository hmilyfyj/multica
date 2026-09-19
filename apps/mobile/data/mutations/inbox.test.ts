import { QueryClient } from "@tanstack/react-query";
import type * as ReactQuery from "@tanstack/react-query";
import type { ArchivedInboxPage, InboxItem } from "@multica/core/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/data/api";
import { inboxKeys } from "@/data/queries/inbox";
import { deduplicateArchivedInboxItems } from "@/lib/inbox-display";
import { useMarkInboxUnread, useUnarchiveInbox } from "./inbox";

// The real client refuses to load without a base URL; set it before the import
// runs so the mocked module can still spread the real exports.
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
    // mutate → onError → onSettled lifecycle as the app.
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
      markInboxUnread: vi.fn(),
      unarchiveInbox: vi.fn(),
    },
  };
});

vi.mock("@/data/workspace-store", () => ({
  useWorkspaceStore: (
    selector: (s: { currentWorkspaceId: string }) => unknown,
  ) => selector({ currentWorkspaceId: "workspace-1" }),
}));

const wsId = "workspace-1";
const listKey = inboxKeys.list(wsId);
// The pages key carries the normalized filters as its last segment; both
// patchers match on the `archived` prefix, so any segment works here.
const pagesKey = [...inboxKeys.pages(wsId), "filters"];

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: "inbox-1",
    workspace_id: wsId,
    recipient_type: "member",
    recipient_id: "member-1",
    actor_type: "agent",
    actor_id: "agent-1",
    type: "new_comment",
    severity: "info",
    issue_id: "issue-1",
    title: "Issue title",
    body: null,
    issue_status: "in_progress",
    read: true,
    archived: false,
    created_at: "2026-09-19T08:00:00Z",
    details: null,
    ...overrides,
  };
}

function page(
  items: InboxItem[],
  nextCursor: string | null = null,
): ArchivedInboxPage {
  return { items, nextCursor, hasMore: nextCursor !== null };
}

function seedArchived(pages: ArchivedInboxPage[]): void {
  state.qc.setQueryData(pagesKey, {
    pages,
    pageParams: pages.map(() => null),
  });
}

function cachedArchivedItems(): InboxItem[] {
  const data = state.qc.getQueryData<{ pages: ArchivedInboxPage[] }>(pagesKey);
  return (data?.pages ?? []).flatMap((p) => p.items);
}

/**
 * What the archived list actually renders: the cached pages put through the
 * same dedup helper the screen uses. Rows the patch flipped to
 * `archived: false` stay in the cache but leave this list — which is the
 * observable the user cares about.
 */
function visibleArchivedIds(): string[] {
  return deduplicateArchivedInboxItems(cachedArchivedItems()).map((i) => i.id);
}

function mainRead(id: string): boolean | undefined {
  return state.qc
    .getQueryData<InboxItem[]>(listKey)
    ?.find((i) => i.id === id)?.read;
}

beforeEach(() => {
  state.qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.clearAllMocks();
});

describe("useMarkInboxUnread", () => {
  it("flips the row back to unread in the main list and in the archived pages", async () => {
    state.qc.setQueryData<InboxItem[]>(listKey, [
      item({ id: "shared-1", read: true }),
    ]);
    // `read` and `archived` are orthogonal fields, so a row can sit in the
    // archived cache too; the toggle has to reach both or a later restore would
    // bring back a stale read state.
    seedArchived([
      page([item({ id: "shared-1", archived: true, read: true })]),
    ]);
    vi.mocked(api.markInboxUnread).mockResolvedValue(item({ id: "shared-1" }));

    await useMarkInboxUnread().mutateAsync("shared-1");

    expect(mainRead("shared-1")).toBe(false);
    expect(cachedArchivedItems()[0]?.read).toBe(false);
  });

  it("leaves the other rows alone", async () => {
    state.qc.setQueryData<InboxItem[]>(listKey, [
      item({ id: "main-1", read: true }),
      item({ id: "main-2", read: true }),
    ]);
    vi.mocked(api.markInboxUnread).mockResolvedValue(item({ id: "main-1" }));

    await useMarkInboxUnread().mutateAsync("main-1");

    expect(mainRead("main-1")).toBe(false);
    expect(mainRead("main-2")).toBe(true);
  });

  it("restores both lists when the server refuses", async () => {
    state.qc.setQueryData<InboxItem[]>(listKey, [
      item({ id: "shared-1", read: true }),
    ]);
    seedArchived([
      page([item({ id: "shared-1", archived: true, read: true })]),
    ]);
    let rejectWrite!: (err: Error) => void;
    vi.mocked(api.markInboxUnread).mockReturnValue(
      new Promise<InboxItem>((_resolve, reject) => {
        rejectWrite = reject;
      }),
    );

    const pending = useMarkInboxUnread()
      .mutateAsync("shared-1")
      .catch((err: unknown) => err);
    await vi.waitFor(() => {
      expect(mainRead("shared-1")).toBe(false);
    });
    rejectWrite(new Error("boom"));
    await expect(pending).resolves.toBeInstanceOf(Error);

    expect(mainRead("shared-1")).toBe(true);
    expect(cachedArchivedItems()[0]?.read).toBe(true);
  });
});

describe("useUnarchiveInbox", () => {
  it("drops the row and its issue's siblings from the archived list", async () => {
    seedArchived([
      page([
        item({ id: "a-1", issue_id: "issue-a", archived: true }),
        item({ id: "b-1", issue_id: "issue-b", archived: true }),
      ]),
      // The sibling lives on the NEXT page — the group has to be resolved
      // across every loaded page, not just the first, or restoring one row
      // would leave half its issue behind in the archive.
      page([item({ id: "a-2", issue_id: "issue-a", archived: true })]),
    ]);
    vi.mocked(api.unarchiveInbox).mockResolvedValue(item({ id: "a-1" }));

    await useUnarchiveInbox().mutateAsync("a-1");

    expect(visibleArchivedIds()).toEqual(["b-1"]);
    // The rows stay in the pages (the server decides and the next fetch
    // replaces the pages wholesale); what makes them disappear from the list
    // is `archived` flipping.
    expect(cachedArchivedItems().find((i) => i.id === "a-2")?.archived).toBe(
      false,
    );
  });

  it("puts the rows back when the server refuses", async () => {
    seedArchived([
      page([
        item({ id: "a-1", issue_id: "issue-a", archived: true }),
        item({ id: "a-2", issue_id: "issue-a", archived: true }),
      ]),
    ]);
    let rejectWrite!: (err: Error) => void;
    vi.mocked(api.unarchiveInbox).mockReturnValue(
      new Promise<InboxItem>((_resolve, reject) => {
        rejectWrite = reject;
      }),
    );

    const pending = useUnarchiveInbox()
      .mutateAsync("a-1")
      .catch((err: unknown) => err);
    // Optimistic first: the rows leave the list while the request is in
    // flight (patched after the mutation's own `cancelQueries` await, so this
    // waits for the microtask rather than reading synchronously), then the
    // rejection has to put them back.
    await vi.waitFor(() => {
      expect(visibleArchivedIds()).toEqual([]);
    });
    rejectWrite(new Error("boom"));
    await expect(pending).resolves.toBeInstanceOf(Error);

    // Asserted on the rows, not on the list: both rows share an issue, so the
    // list collapses them to one entry either way and could not tell a
    // restored sibling from a lost one.
    expect(
      cachedArchivedItems().map((i) => `${i.id}/${i.archived}`),
    ).toEqual(["a-1/true", "a-2/true"]);
  });

  it("leaves the main list alone — the server decides where the issue belongs", async () => {
    state.qc.setQueryData<InboxItem[]>(listKey, []);
    seedArchived([page([item({ id: "a-1", archived: true })])]);
    vi.mocked(api.unarchiveInbox).mockResolvedValue(item({ id: "a-1" }));

    await useUnarchiveInbox().mutateAsync("a-1");

    expect(state.qc.getQueryData<InboxItem[]>(listKey)).toEqual([]);
  });
});
