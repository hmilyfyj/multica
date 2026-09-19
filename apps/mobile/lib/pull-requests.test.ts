// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { GitHubPullRequest } from "@multica/core/types";
import {
  PULL_REQUEST_FOLD_THRESHOLD,
  pullRequestAuthorLabel,
  pullRequestFoldToggleLabel,
  pullRequestRef,
  pullRequestStateLabel,
  pullRequestSubtitle,
  pullRequestTone,
  splitPullRequests,
} from "./pull-requests";

function pr(number: number, overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    id: `pr-${number}`,
    provider: "github",
    workspace_id: "ws-1",
    repo_owner: "acme",
    repo_name: "widget",
    number,
    title: `PR-${number}`,
    state: "open",
    html_url: `https://example.test/pr/${number}`,
    branch: "feat/x",
    author_login: "octocat",
    author_avatar_url: null,
    merged_at: null,
    closed_at: null,
    pr_created_at: "2026-01-01T00:00:00Z",
    pr_updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("pullRequestStateLabel", () => {
  it("maps the four states web renders to the same words", () => {
    expect(pullRequestStateLabel("open")).toBe("Open");
    expect(pullRequestStateLabel("draft")).toBe("Draft");
    expect(pullRequestStateLabel("merged")).toBe("Merged");
    expect(pullRequestStateLabel("closed")).toBe("Closed");
  });

  it("falls through to the raw server string for a state it does not know", () => {
    // A backend that adds a state must not render as a confident wrong word.
    expect(pullRequestStateLabel("queued_for_merge")).toBe("queued_for_merge");
  });
});

describe("pullRequestTone", () => {
  it("keeps the four known states in their own colour group", () => {
    expect(pullRequestTone("open")).toBe("open");
    expect(pullRequestTone("draft")).toBe("draft");
    expect(pullRequestTone("merged")).toBe("merged");
    expect(pullRequestTone("closed")).toBe("closed");
  });

  it("puts an unknown state on the neutral tone instead of a state colour", () => {
    expect(pullRequestTone("queued_for_merge")).toBe("unknown");
  });
});

describe("pullRequestRef / pullRequestAuthorLabel", () => {
  it("assembles owner/repo#number", () => {
    expect(pullRequestRef(pr(42))).toBe("acme/widget#42");
  });

  it("prefixes the author handle with @", () => {
    expect(pullRequestAuthorLabel(pr(1, { author_login: "octocat" }))).toBe("@octocat");
  });

  it("returns null when the PR has no author on record", () => {
    expect(pullRequestAuthorLabel(pr(1, { author_login: null }))).toBeNull();
  });
});

describe("pullRequestSubtitle", () => {
  it("joins identity, state and author in web's order", () => {
    expect(pullRequestSubtitle(pr(7, { state: "merged" }))).toBe(
      "acme/widget#7 · Merged · @octocat",
    );
  });

  it("drops the author segment entirely when there is no author", () => {
    expect(pullRequestSubtitle(pr(7, { author_login: null }))).toBe(
      "acme/widget#7 · Open",
    );
  });
});

describe("splitPullRequests", () => {
  const prs = [pr(1), pr(2), pr(3), pr(4), pr(5)];

  it("keeps every row visible and never offers a toggle below the threshold", () => {
    const fold = splitPullRequests(prs.slice(0, PULL_REQUEST_FOLD_THRESHOLD - 1), false);
    expect(fold.visible).toHaveLength(3);
    expect(fold.useFold).toBe(false);
    expect(fold.folded).toEqual([]);
    expect(pullRequestFoldToggleLabel(fold, false)).toBeNull();
  });

  it("folds at exactly the threshold, hiding all but the first three rows", () => {
    const fold = splitPullRequests(prs.slice(0, PULL_REQUEST_FOLD_THRESHOLD), false);
    expect(fold.useFold).toBe(true);
    expect(fold.visible.map((p) => p.number)).toEqual([1, 2, 3]);
    expect(fold.foldedCount).toBe(1);
    expect(pullRequestFoldToggleLabel(fold, false)).toBe("Show 1 more");
  });

  it("counts the hidden tail from the list length", () => {
    const fold = splitPullRequests(prs, false);
    expect(fold.visible.map((p) => p.number)).toEqual([1, 2, 3]);
    expect(fold.folded.map((p) => p.number)).toEqual([4, 5]);
    expect(pullRequestFoldToggleLabel(fold, false)).toBe("Show 2 more");
  });

  it("shows the whole list once expanded", () => {
    const fold = splitPullRequests(prs, true);
    expect(fold.visible.map((p) => p.number)).toEqual([1, 2, 3, 4, 5]);
    // The tail stays known so the toggle can flip back.
    expect(fold.foldedCount).toBe(2);
    expect(pullRequestFoldToggleLabel(fold, true)).toBe("Show less");
  });
});
