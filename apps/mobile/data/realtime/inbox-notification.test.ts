// @vitest-environment node
import { QueryClient } from "@tanstack/react-query";
import type { InboxItem } from "@multica/core/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const scheduleNotificationAsync = vi.fn();
const getPermissionsAsync = vi.fn();

// The library loads RN native modules, which this Node lane cannot. Everything
// below the mock — payload building, gating, the request shape — is the real
// code path.
vi.mock("expo-notifications", () => ({
  getPermissionsAsync: () => getPermissionsAsync(),
  scheduleNotificationAsync: (request: unknown) =>
    scheduleNotificationAsync(request),
}));

// The preference query factory imports the native fetch client. These cases
// either seed the cache or let the query fail on purpose, so it is never used.
vi.mock("@/data/api", () => ({ api: {} }));

import { notificationPreferenceKeys } from "@/data/queries/notification-preferences";
import { INBOX_NOTIFICATION_CHANNEL_ID } from "@/lib/local-notifications";
import { notifyNewInboxItem } from "./inbox-notification";

const wsId = "workspace-1";

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: "n1",
    workspace_id: wsId,
    recipient_type: "member",
    recipient_id: "member-1",
    actor_type: "agent",
    actor_id: "agent-1",
    type: "new_comment",
    severity: "info",
    issue_id: "issue-a",
    title: "Someone mentioned you",
    body: "in a comment",
    issue_status: null,
    read: false,
    archived: false,
    created_at: "2026-09-01T08:00:00Z",
    details: null,
    ...overrides,
  };
}

/** `retry: false` so a deliberately failing query does not back off for seconds. */
function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function seedPreferences(qc: QueryClient, value: "all" | "muted") {
  qc.setQueryData(notificationPreferenceKeys.all(wsId), {
    workspace_id: wsId,
    preferences: { system_notifications: value },
  });
}

describe("notifyNewInboxItem", () => {
  beforeEach(() => {
    scheduleNotificationAsync.mockReset().mockResolvedValue("notification-id");
    getPermissionsAsync
      .mockReset()
      .mockResolvedValue({ status: "granted", granted: true, canAskAgain: true });
  });

  it("raises a banner for a new inbox item", async () => {
    const qc = client();
    seedPreferences(qc, "all");

    await notifyNewInboxItem(qc, item(), wsId, "acme");

    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(scheduleNotificationAsync.mock.calls[0][0]).toMatchObject({
      // The inbox row id doubles as the Android notification tag, so a repeat
      // for the same item replaces its banner instead of stacking one more.
      identifier: "n1",
      trigger: { channelId: INBOX_NOTIFICATION_CHANNEL_ID },
      content: {
        title: "Someone mentioned you",
        body: "in a comment",
        data: { slug: "acme", itemId: "n1", issueId: "issue-a" },
      },
    });
  });

  it("stays silent when the workspace muted system notifications", async () => {
    const qc = client();
    seedPreferences(qc, "muted");

    await notifyNewInboxItem(qc, item(), wsId, "acme");

    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it("stays silent while the OS permission is missing", async () => {
    const qc = client();
    seedPreferences(qc, "all");
    getPermissionsAsync.mockResolvedValue({
      status: "denied",
      granted: false,
      canAskAgain: true,
    });

    await notifyNewInboxItem(qc, item(), wsId, "acme");

    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it("notifies when the preference cannot be read", async () => {
    // A failed read must not silence notifications the user never muted; the
    // empty api mock makes the preference query reject.
    const qc = client();

    await notifyNewInboxItem(qc, item(), wsId, "acme");

    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });
});
