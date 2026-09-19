/**
 * Sub-issues block on the issue detail screen — the mobile counterpart of the
 * "Sub-issues — Linear-style" section in web's
 * `packages/views/issues/components/issue-detail.tsx`.
 *
 * Placement and appearance conditions match web: it renders below the
 * description and reactions and above the timeline, a childless issue shows a
 * single muted `+ Add sub-issues` entry, and an issue with children shows the
 * header (collapse toggle, title, done/total, add entry) plus the rows — grouped
 * by stage, with a per-group header only when the set is actually staged
 * (`lib/sub-issues.ts`).
 *
 * Deliberate divergences, each keeping the web behavior it replaces:
 *
 *   - the done/total count renders as text instead of a progress ring: mobile
 *     has no ring primitive and web renders this exact `done/total` string next
 *     to its ring, so the count semantics are identical;
 *   - the empty entry waits for the children query to settle rather than
 *     rendering from the defaulted empty array, so an issue that HAS children
 *     does not flash "Add sub-issues" before its list arrives.
 *
 * Freshness: the children query refetches on every mount
 * (`issueChildrenOptions`), pull-to-refresh on the detail screen invalidates it,
 * and creating a sub-issue from here invalidates it on success (new-issue.tsx).
 * Live WS updates for children are owned by the realtime layer, not this block.
 */
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import type { Issue } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { IconButton } from "@/components/ui/icon-button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { IssueRow } from "./issue-row";
import {
  childIssueProgressOptions,
  issueChildrenOptions,
} from "@/data/queries/issues";
import { useSubIssuesCollapseStore } from "@/data/stores/sub-issues-collapse-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import {
  childProgressOf,
  groupSubIssuesByStage,
  hasStagedChildren,
  subIssueProgressLabel,
  type SubIssueProgress,
} from "@/lib/sub-issues";

export function SubIssuesSection({ issue }: { issue: Issue }) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

  const { data: children, isSuccess } = useQuery(
    issueChildrenOptions(wsId, issue.id),
  );
  const list = children ?? [];
  // One workspace-wide request answers "does this row have children, and how
  // many are done" for every row at once; skipped entirely for a leaf issue,
  // mirroring web's `enabled: childIssues.length > 0`.
  const { data: progressByParent } = useQuery({
    ...childIssueProgressOptions(wsId),
    enabled: !!wsId && list.length > 0,
  });

  // Store-backed rather than component state so the collapsed state survives
  // leaving the issue and navigating back within the session.
  const collapsed = useSubIssuesCollapseStore((s) =>
    s.collapsedIssueIds.has(issue.id),
  );
  const setCollapsed = useSubIssuesCollapseStore((s) => s.setCollapsed);

  const openCreate = () => {
    if (!wsSlug) return;
    // The create form takes the parent as a query param and stamps it onto the
    // request — same "reuse the create modal, seed the parent" arrangement as
    // web's `openCreateSubIssue`.
    router.push(`/${wsSlug}/new-issue?parent=${issue.id}`);
  };
  const openChild = (childId: string) => {
    if (!wsSlug) return;
    router.push(`/${wsSlug}/issue/${childId}`);
  };

  if (list.length === 0) {
    // Children not known yet (or the request failed): show nothing rather than
    // the empty entry — see the file header's divergence note.
    if (!isSuccess) return null;
    return (
      <View className="px-4 pt-5">
        <Pressable
          onPress={openCreate}
          className="flex-row items-center gap-1.5 self-start active:opacity-60"
          accessibilityRole="button"
        >
          <Ionicons name="add" size={14} color={muted} />
          <Text className="text-sm text-muted-foreground">
            Add sub-issues
          </Text>
        </Pressable>
      </View>
    );
  }

  const groups = groupSubIssuesByStage(list);
  const staged = hasStagedChildren(list);
  const progress = childProgressOf(list);

  return (
    <View className="px-4 pt-6">
      <Collapsible
        open={!collapsed}
        onOpenChange={(open) => setCollapsed(issue.id, !open)}
      >
        <View className="flex-row items-center gap-2">
          <CollapsibleTrigger asChild>
            <Pressable
              className="flex-row items-center gap-1.5 py-1 active:opacity-60"
              accessibilityRole="button"
            >
              <Ionicons
                name={collapsed ? "chevron-forward" : "chevron-down"}
                size={14}
                color={muted}
              />
              <Text className="text-base font-medium text-foreground">
                Sub-issues
              </Text>
            </Pressable>
          </CollapsibleTrigger>
          <View className="rounded-full bg-muted px-2 py-0.5">
            <Text className="text-xs font-medium text-muted-foreground tabular-nums">
              {progress.done}/{progress.total}
            </Text>
          </View>
          <View className="flex-1" />
          <IconButton
            name="add"
            iconSize={18}
            onPress={openCreate}
            accessibilityLabel="Add sub-issue"
          />
        </View>
        <CollapsibleContent>
          <View className="mt-1 overflow-hidden rounded-lg border border-border bg-card/30">
            {groups.map((group) => (
              <View key={group.stage ?? "unstaged"}>
                {staged ? (
                  <View className="bg-muted/40 px-3 py-1">
                    <Text className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {group.stage == null ? "No stage" : `Stage ${group.stage}`}
                    </Text>
                  </View>
                ) : null}
                {group.items.map((child, index) => (
                  <View
                    key={child.id}
                    className={
                      index > 0 ? "border-t border-border/60" : undefined
                    }
                  >
                    <SubIssueRow
                      child={child}
                      progress={progressByParent?.get(child.id)}
                      onPress={() => openChild(child.id)}
                    />
                  </View>
                ))}
              </View>
            ))}
          </View>
        </CollapsibleContent>
      </Collapsible>
    </View>
  );
}

/**
 * One row of the list. Not a component of its own: the shared `IssueRow`
 * already renders the status glyph, priority, identifier, title, custom-status
 * chip and assignee this list needs, so the only sub-issue-specific part is the
 * trailing done/total badge read from the workspace progress map.
 */
function SubIssueRow({
  child,
  progress,
  onPress,
}: {
  child: Issue;
  progress: SubIssueProgress | undefined;
  onPress: () => void;
}) {
  const label = subIssueProgressLabel(progress);
  return (
    <IssueRow
      issue={child}
      showStatus
      onPress={onPress}
      trailing={
        label ? (
          <Text className="text-xs text-muted-foreground tabular-nums">
            {label}
          </Text>
        ) : undefined
      }
    />
  );
}
