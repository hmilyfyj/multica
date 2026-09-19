// @vitest-environment node
import type { InboxItem } from "@multica/core/types";
import { describe, expect, it, vi } from "vitest";

// The library loads RN native modules, which the Node lane cannot; the payload
// helpers under test here never call into it.
vi.mock("expo-notifications", () => ({}));

import {
  buildInboxNotificationPayload,
  getInboxNotificationTarget,
  readInboxNotificationPayload,
  toNotificationData,
} from "./local-notifications";

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

describe("buildInboxNotificationPayload", () => {
  it("carries the inbox ids and copy the banner needs", () => {
    expect(buildInboxNotificationPayload(item(), "acme")).toEqual({
      slug: "acme",
      itemId: "n1",
      issueId: "issue-a",
      title: "Someone mentioned you",
      body: "in a comment",
    });
  });

  it("uses the inbox display title, not the raw one", () => {
    // System notices are the case that matters: the backend title can carry raw
    // counts, and `getInboxDisplayTitle` is what the row and the sheet show, so
    // the banner must agree with the row it points at.
    const payload = buildInboxNotificationPayload(
      item({ type: "autopilot_quota_exceeded", title: "3 runs used" }),
      "acme",
    );
    expect(payload.title).toBe("Autopilot run limit reached");
  });

  it("reports no issue for a standalone item", () => {
    expect(buildInboxNotificationPayload(item({ issue_id: null }), "acme").issueId).toBeNull();
  });

  it("normalises a missing body to an empty string", () => {
    expect(buildInboxNotificationPayload(item({ body: null }), "acme").body).toBe("");
  });
});

describe("notification data round trip", () => {
  it("survives the trip through content.data", () => {
    const payload = buildInboxNotificationPayload(item(), "acme");
    expect(readInboxNotificationPayload(toNotificationData(payload))).toEqual(payload);
  });

  it("omits a null issue id instead of storing null", () => {
    // Android delivers data through a Bundle, which does not round-trip null
    // values, so the key is dropped and read back as null.
    const payload = buildInboxNotificationPayload(item({ issue_id: null }), "acme");
    const data = toNotificationData(payload);
    expect("issueId" in data).toBe(false);
    expect(readInboxNotificationPayload(data)?.issueId).toBeNull();
  });

  it("ignores data that is not one of ours", () => {
    expect(readInboxNotificationPayload(undefined)).toBeNull();
    expect(readInboxNotificationPayload("n1")).toBeNull();
    expect(readInboxNotificationPayload({ itemId: "n1" })).toBeNull();
    expect(
      readInboxNotificationPayload({
        slug: "acme",
        itemId: "n1",
        title: "t",
        body: "b",
        issueId: 7,
      }),
    ).toBeNull();
  });
});

describe("getInboxNotificationTarget", () => {
  const payload = buildInboxNotificationPayload(item(), "acme");

  it("opens the issue a banner is about", () => {
    expect(getInboxNotificationTarget(payload, "h1")).toEqual({
      pathname: "/[workspace]/issue/[id]",
      params: { workspace: "acme", id: "issue-a", h: "h1" },
    });
  });

  it("falls back to the inbox sheet for items without an issue", () => {
    expect(
      getInboxNotificationTarget(
        { ...payload, issueId: null },
        "h1",
      ),
    ).toEqual({
      pathname: "/[workspace]/inbox/[id]",
      params: { workspace: "acme", id: "n1" },
    });
  });

  it("has nowhere to go without a workspace", () => {
    expect(getInboxNotificationTarget({ ...payload, slug: "" }, "h1")).toBeNull();
  });
});
