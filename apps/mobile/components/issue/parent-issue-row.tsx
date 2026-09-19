/**
 * The parent issue row on the issue detail screen — mobile's take on web's
 * "Parent issue" sidebar section (`packages/views/issues/components/
 * issue-detail.tsx`, `section_parent_issue`).
 *
 * Content and render condition match web: a status glyph, the identifier, the
 * title, and a tap that opens the parent — rendered only when the issue
 * actually has one (setting a parent stays reachable from the issue actions
 * menu, not from here).
 *
 * Two deliberate divergences, both recorded in the task prd:
 *
 *   - web lets this section collapse; it holds a single row, so a toggle would
 *     be chrome without a payoff;
 *   - web places it in the detail sidebar below the property block. Mobile's
 *     property block is the header card, so this renders directly under it,
 *     keeping web's "properties, then parent" order.
 */
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { StatusIcon } from "@/components/ui/status-icon";
import { issueDetailOptions } from "@/data/queries/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { issueColumnCategory } from "@/lib/issue-status";
import { useIssueStatuses } from "@/lib/use-issue-statuses";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

export function ParentIssueRow({ parentIssueId }: { parentIssueId: string }) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { colorScheme } = useColorScheme();
  // One catalog read for both the glyph's colour and its shape — the same
  // resolution IssueRow uses (see custom-status-chip.tsx's divergence note).
  const catalog = useIssueStatuses();

  // Already cached when the user arrived from the parent itself; otherwise this
  // is the one request the row costs.
  const { data: parent } = useQuery(issueDetailOptions(wsId, parentIssueId));

  // No row until the parent resolves: a parent deleted in another session, or
  // a request still in flight, would otherwise render an empty link.
  if (!parent) return null;

  return (
    <View className="px-4 pb-2">
      <Pressable
        onPress={() => {
          if (!wsSlug) return;
          router.push(`/${wsSlug}/issue/${parent.id}`);
        }}
        className="flex-row items-center gap-2 py-1 active:opacity-60"
        accessibilityRole="link"
        accessibilityLabel={`Parent issue ${parent.identifier}`}
      >
        <Text className="text-xs text-muted-foreground">Parent</Text>
        <StatusIcon
          status={parent.status}
          category={issueColumnCategory(parent)}
          icon={catalog.iconOf(parent.status)}
          color={catalog.colorOf(parent.status)}
          size={14}
        />
        <Text className="text-xs text-muted-foreground shrink-0">
          {parent.identifier}
        </Text>
        <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
          {parent.title}
        </Text>
        <Ionicons
          name="chevron-forward"
          size={14}
          color={THEME[colorScheme].mutedForeground}
        />
      </Pressable>
    </View>
  );
}
