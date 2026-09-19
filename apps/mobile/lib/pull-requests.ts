/**
 * Linked-pull-request helpers for the issue-detail PR block — the mobile
 * counterpart of web's `packages/views/issues/components/pull-request-list.tsx`.
 *
 * Pure by design: no react-native, no link library, so the Node lane in
 * `vitest.config.ts` locks the state wording, the label assembly and the fold
 * boundary the panel depends on.
 *
 * Product semantics mirrored from web rather than re-derived:
 *
 *   - state wording: open/draft/merged/closed map to the four words web renders
 *     next to the row, and an unrecognised state falls through to the RAW
 *     server string instead of being dropped or guessed at — web's
 *     `getStateLabel` does exactly that, so a new backend state shows up as
 *     itself rather than as a wrong label.
 *   - the fold: web keeps the sidebar's density by showing the first
 *     `PR_LIMIT_BEFORE_COLLAPSE - 1` rows and hiding the rest behind a toggle
 *     once the list reaches `PR_LIMIT_BEFORE_COLLAPSE`. Below the threshold
 *     every row is visible and there is no toggle. The threshold and the
 *     "first N-1" split are both copied, not reinterpreted.
 */
import type { GitHubPullRequest } from "@multica/core/types";

/** Rows shown before the tail folds behind a toggle — web's
 * `PR_LIMIT_BEFORE_COLLAPSE`. A list that reaches this length keeps only
 * `THRESHOLD - 1` rows visible. */
export const PULL_REQUEST_FOLD_THRESHOLD = 4;

/**
 * Colour group a state belongs to. Deliberately coarser than the state itself:
 * the caller maps it onto mobile theme tokens (`success` / `muted` /
 * `brand` / `destructive`), the same four groups web paints with
 * emerald / muted / violet / rose. `unknown` is its own member so a state this
 * client has never heard of lands on the neutral tone instead of inheriting a
 * colour that would assert something about it.
 */
export type PullRequestTone = "open" | "draft" | "merged" | "closed" | "unknown";

/**
 * Panel copy for one PR state. Unknown states return the raw string — web's
 * fallback, kept so an unfamiliar server value is still readable.
 */
export function pullRequestStateLabel(state: string): string {
  switch (state) {
    case "open":
      return "Open";
    case "draft":
      return "Draft";
    case "merged":
      return "Merged";
    case "closed":
      return "Closed";
    default:
      return state;
  }
}

/** Colour group for one PR state; unknown states are neutral. */
export function pullRequestTone(state: string): PullRequestTone {
  switch (state) {
    case "open":
    case "draft":
    case "merged":
    case "closed":
      return state;
    default:
      return "unknown";
  }
}

/** `owner/repo#123` — the row's leading identity, same string web renders. */
export function pullRequestRef(
  pr: Pick<GitHubPullRequest, "repo_owner" | "repo_name" | "number">,
): string {
  return `${pr.repo_owner}/${pr.repo_name}#${pr.number}`;
}

/**
 * `@login`, or null when the PR has no author on record — web omits the whole
 * `· @author` segment rather than printing an empty handle.
 */
export function pullRequestAuthorLabel(
  pr: Pick<GitHubPullRequest, "author_login">,
): string | null {
  return pr.author_login ? `@${pr.author_login}` : null;
}

/** The sub-line's parts in web's order: identity · state · author. */
export function pullRequestSubtitle(pr: GitHubPullRequest): string {
  const author = pullRequestAuthorLabel(pr);
  const parts = [pullRequestRef(pr), pullRequestStateLabel(pr.state)];
  if (author) parts.push(author);
  return parts.join(" · ");
}

export interface PullRequestFold {
  /** Rows to render right now. */
  visible: GitHubPullRequest[];
  /** Rows the toggle reveals — empty when the list is below the threshold. */
  folded: GitHubPullRequest[];
  /** True when the list is long enough for a toggle to exist at all. */
  useFold: boolean;
  /** How many rows the toggle hides while collapsed. */
  foldedCount: number;
}

/**
 * Applies web's fold rule: below `PULL_REQUEST_FOLD_THRESHOLD` every row is
 * visible and no toggle exists; at or above it the first `THRESHOLD - 1` rows
 * stay visible and the tail is returned as `folded`, revealed only when
 * `expanded`.
 */
export function splitPullRequests(
  prs: GitHubPullRequest[],
  expanded: boolean,
): PullRequestFold {
  const useFold = prs.length >= PULL_REQUEST_FOLD_THRESHOLD;
  if (!useFold) {
    return { visible: prs, folded: [], useFold: false, foldedCount: 0 };
  }
  const visible = prs.slice(0, PULL_REQUEST_FOLD_THRESHOLD - 1);
  const folded = prs.slice(PULL_REQUEST_FOLD_THRESHOLD - 1);
  return {
    visible: expanded ? prs : visible,
    folded,
    useFold: true,
    foldedCount: folded.length,
  };
}

/** Copy for the fold toggle, or null when there is nothing to toggle. */
export function pullRequestFoldToggleLabel(
  fold: PullRequestFold,
  expanded: boolean,
): string | null {
  if (!fold.useFold || fold.foldedCount === 0) return null;
  return expanded
    ? "Show less"
    : `Show ${fold.foldedCount} more`;
}
