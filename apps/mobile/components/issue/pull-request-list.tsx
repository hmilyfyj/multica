/**
 * Linked pull requests on the issue detail screen — the mobile counterpart of
 * web's "Pull requests" sidebar section
 * (`packages/views/issues/components/pull-request-list.tsx`).
 *
 * Read-only by design: the issue ↔ PR association is written by the GitHub
 * webhook, so nothing here mutates. Tapping a row hands the PR URL to the
 * system browser (`Linking.openURL`) — mobile has no in-app browser, and the
 * PR page is a full web surface.
 *
 * Placement and visibility follow web's rules, adapted to a phone:
 *
 *   - the section sits with the other related-entity blocks (below
 *     `SubIssuesSection`, above the Activity divider). Web puts it in the
 *     detail sidebar; mobile has no sidebar, and grouping it with the
 *     sub-issues block preserves web's "related entities under the
 *     description" reading order;
 *   - it is gated on the workspace's PR-sidebar flag
 *     (`deriveGitHubSettings(workspace).prSidebar`), so a workspace that has
 *     turned the PR surface off sees nothing here either;
 *   - collapse state is component-local and defaults to open, matching web's
 *     `pullRequestsOpen` (`useState(true)`);
 *   - the fold rule (`lib/pull-requests.ts`) is web's, copied not
 *     reinterpreted: at 4+ PRs the first 3 rows show and the tail sits behind
 *     `Show N more` / `Show less`.
 *
 * Deliberate divergences, each keeping the web behaviour it replaces:
 *
 *   - an issue with no linked PRs renders nothing. Web renders
 *     "No linked pull requests." because its sidebar has a fixed slot per
 *     issue; this block carries nothing but PRs, so an empty one is zero
 *     information on every issue's screen. Nothing is rendered until the query
 *     settles, so a PR-bearing issue never flashes the empty state;
 *   - state is carried by glyph family plus tone instead of web's four distinct
 *     PR glyphs — Ionicons (the only icon set mobile ships) has no
 *     draft / closed PR variant. open / draft / closed share
 *     `git-pull-request-outline` and differ by tone, merged keeps web's
 *     `git-merge-outline`, and the state WORD next to it is web's, letter for
 *     letter. See `.trellis/spec/mobile/frontend/android-platform.md`;
 *   - the row's secondary snapshot line (CI rollup, mergeability, diff stats)
 *     is not rendered — it is outside this block's field scope;
 *   - tones ride mobile theme tokens (`success` / `brand` / `destructive` /
 *     `mutedForeground`) rather than web's raw emerald / violet / rose, so
 *     light and dark both come from `global.css`.
 *
 * Freshness: the query refetches on pull-to-refresh (issue/[id].tsx) — that is
 * the only surface that can change the list, and the realtime layer owns WS
 * events, not this block.
 */
import { useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import type { GitHubPullRequest } from "@multica/core/types";
import { deriveGitHubSettings } from "@multica/core/github/settings";
import { Text } from "@/components/ui/text";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { issuePullRequestsOptions } from "@/data/queries/issues";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import {
  pullRequestFoldToggleLabel,
  pullRequestStateLabel,
  pullRequestSubtitle,
  pullRequestTone,
  splitPullRequests,
  type PullRequestTone,
} from "@/lib/pull-requests";

/** Ionicons has one PR glyph and one merge glyph — no draft / closed variant. */
const TONE_ICON: Record<PullRequestTone, keyof typeof Ionicons.glyphMap> = {
  open: "git-pull-request-outline",
  draft: "git-pull-request-outline",
  merged: "git-merge-outline",
  closed: "git-pull-request-outline",
  unknown: "git-pull-request-outline",
};

/** Tone → mobile theme token, mirroring web's emerald / muted / violet / rose. */
const TONE_COLOR: Record<
  PullRequestTone,
  "success" | "brand" | "destructive" | "mutedForeground"
> = {
  open: "success",
  draft: "mutedForeground",
  merged: "brand",
  closed: "destructive",
  unknown: "mutedForeground",
};

export function PullRequestList({ issueId }: { issueId: string }) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { colorScheme } = useColorScheme();
  const { data: prs, isSuccess } = useQuery(issuePullRequestsOptions(wsId, issueId));
  const { data: workspaces } = useQuery(workspaceListOptions());
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const workspace = workspaces?.find((w) => w.id === wsId) ?? null;
  // Same gate as web's `githubSettings.prSidebar`. While the workspace list is
  // unresolved the derivation's own default (on) applies, so the block cannot
  // be hidden by a missing cache — and `[workspace]/_layout.tsx` already holds
  // that query open for the whole session, so it is normally resolved here.
  if (!deriveGitHubSettings(workspace).prSidebar) return null;
  if (!isSuccess || !prs || prs.length === 0) return null;

  const fold = splitPullRequests(prs, expanded);
  const toggleLabel = pullRequestFoldToggleLabel(fold, expanded);

  return (
    <View className="px-4 pt-6">
      <Collapsible open={open} onOpenChange={setOpen}>
        <View className="flex-row items-center gap-2">
          <CollapsibleTrigger asChild>
            <Pressable
              className="flex-row items-center gap-1.5 py-1 active:opacity-60"
              accessibilityRole="button"
            >
              <Ionicons
                name={open ? "chevron-down" : "chevron-forward"}
                size={14}
                color={THEME[colorScheme].mutedForeground}
              />
              <Text className="text-base font-medium text-foreground">
                Pull requests
              </Text>
            </Pressable>
          </CollapsibleTrigger>
          <View className="rounded-full bg-muted px-2 py-0.5">
            <Text className="text-xs font-medium text-muted-foreground tabular-nums">
              {prs.length}
            </Text>
          </View>
        </View>
        <CollapsibleContent>
          <View className="mt-1 overflow-hidden rounded-lg border border-border bg-card/30">
            {fold.visible.map((pr, index) => (
              <View
                key={pr.id}
                className={index > 0 ? "border-t border-border/60" : undefined}
              >
                <PullRequestRow pr={pr} colorScheme={colorScheme} />
              </View>
            ))}
            {toggleLabel ? (
              <Pressable
                onPress={() => setExpanded((v) => !v)}
                className="border-t border-border/60 py-2 active:opacity-60"
                accessibilityRole="button"
              >
                <Text className="text-xs text-muted-foreground">
                  {toggleLabel}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </CollapsibleContent>
      </Collapsible>
    </View>
  );
}

/**
 * One PR. Not a component of its own — the whole row is the link, so the row
 * IS the interaction, and there is nothing to reuse elsewhere yet.
 */
function PullRequestRow({
  pr,
  colorScheme,
}: {
  pr: GitHubPullRequest;
  colorScheme: "light" | "dark";
}) {
  const tone = pullRequestTone(pr.state);

  const openPr = async () => {
    const canOpen = await Linking.canOpenURL(pr.html_url);
    if (canOpen) await Linking.openURL(pr.html_url);
  };

  return (
    <Pressable
      onPress={() => void openPr()}
      accessibilityRole="link"
      accessibilityLabel={`${pr.title} — ${pullRequestStateLabel(pr.state)}`}
      // Web dims draft rows; the state is real, it just is not mergeable yet.
      className={
        tone === "draft"
          ? "flex-row items-start gap-2 px-3 py-2 active:opacity-60 opacity-80"
          : "flex-row items-start gap-2 px-3 py-2 active:opacity-60"
      }
    >
      <Ionicons
        name={TONE_ICON[tone]}
        size={14}
        color={THEME[colorScheme][TONE_COLOR[tone]]}
        style={{ marginTop: 2 }}
      />
      <View className="min-w-0 flex-1">
        <Text
          className="text-sm font-medium text-foreground"
          numberOfLines={1}
        >
          {pr.title}
        </Text>
        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
          {pullRequestSubtitle(pr)}
        </Text>
      </View>
      <Ionicons
        name="open-outline"
        size={14}
        color={THEME[colorScheme].mutedForeground}
        style={{ marginTop: 2 }}
      />
    </Pressable>
  );
}
