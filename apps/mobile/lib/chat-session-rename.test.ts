import { describe, expect, it } from "vitest";
import {
  CHAT_SESSION_TITLE_MAX_LENGTH,
  resolveChatSessionRename,
} from "./chat-session-rename";

describe("resolveChatSessionRename", () => {
  it("commits the trimmed title when the user actually changed it", () => {
    expect(resolveChatSessionRename("  Deploy investigation  ", "New chat")).toBe(
      "Deploy investigation",
    );
  });

  // Committing an empty title would blank the row, and the server has no
  // "unnamed" state to fall back to — web's session rename drops it too.
  it("refuses an empty or whitespace-only title", () => {
    expect(resolveChatSessionRename("", "Deploy investigation")).toBeNull();
    expect(resolveChatSessionRename("   ", "Deploy investigation")).toBeNull();
  });

  // A no-op commit would still fire PATCH and bump updated_at, reordering the
  // session list under the user's finger.
  it("refuses a title identical to the current one", () => {
    expect(resolveChatSessionRename("Deploy investigation", "Deploy investigation")).toBeNull();
    expect(resolveChatSessionRename("  Deploy investigation  ", "Deploy investigation")).toBeNull();
  });

  // The input carries maxLength, but paste on Android can still land longer
  // text; the committed value must stay inside what the server accepts.
  it("clamps to the length the input allows", () => {
    const long = "x".repeat(CHAT_SESSION_TITLE_MAX_LENGTH + 50);
    expect(resolveChatSessionRename(long, "New chat")).toHaveLength(
      CHAT_SESSION_TITLE_MAX_LENGTH,
    );
  });

  it("clamps the trimmed value, not the raw one", () => {
    const raw = `${" ".repeat(10)}${"y".repeat(CHAT_SESSION_TITLE_MAX_LENGTH)}   `;
    expect(resolveChatSessionRename(raw, "New chat")).toBe(
      "y".repeat(CHAT_SESSION_TITLE_MAX_LENGTH),
    );
  });
});
