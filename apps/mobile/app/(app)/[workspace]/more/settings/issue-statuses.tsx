/**
 * Issue statuses settings — the mobile port of web's
 * `packages/views/settings/components/issue-statuses-tab.tsx`.
 *
 * Four category sections, each holding its category's statuses (and, behind the
 * "Show archived" toggle, the retired ones). Every write is owner/admin only
 * server-side, so the controls are gated on the same role the server re-checks;
 * a plain member gets a read-only list instead of discovering the rule through a
 * failed request.
 *
 * Divergences from web, and the source behavior each preserves:
 *
 *   - **Reorder is a pair of move buttons, not drag-and-drop.** RN has no free
 *     drag handle, and the endpoint rewrites a whole category anyway, so
 *     `moveStatusInCategory` produces the same id array a drop would have.
 *   - **Archive lives in the editor sheet.** Web's per-row menu (edit / archive
 *     / view issues) has no phone equivalent; tapping a row opens the editor,
 *     which owns the single destructive action.
 *   - **No "view issues" pivot.** Web's in-use inspection is a desktop-scale
 *     table, so it is left off rather than opened at a size it cannot fill.
 *     Archiving still refuses with the in-use count.
 */
import { Children, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type {
  BuiltInIssueStatus,
  IssueStatusCategory,
  IssueStatusEntry,
} from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { IconButton } from "@/components/ui/icon-button";
import { StatusIcon } from "@/components/ui/status-icon";
import { issueStatusListOptions } from "@/data/queries/issue-statuses";
import { memberListOptions } from "@/data/queries/members";
import { useReorderIssueStatuses } from "@/data/mutations/issue-statuses";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  CATEGORY_LABEL,
  groupIssueStatuses,
  isBuiltInIssueStatus,
  issueStatusColor,
  issueStatusLabel,
  moveStatusInCategory,
} from "@/lib/issue-status";
import { cn } from "@/lib/utils";

/**
 * What each category means, shown under its section title.
 *
 * Mobile is English-only, so the copy from
 * `issue_statuses.categories` in packages/views/locales/en/settings.json is
 * inlined rather than reached through an i18n layer this app does not have.
 */
const CATEGORY_DESCRIPTION: Record<IssueStatusCategory, string> = {
  unstarted: "Work that has not started, whether planned or in the backlog.",
  started: "Work that is active, under review, or blocked.",
  done: "Work that has been finished.",
  closed: "Work that will not be completed.",
};

/** `issue_statuses.built_in_descriptions` — what each built-in status means. */
const BUILT_IN_DESCRIPTION: Record<BuiltInIssueStatus, string> = {
  backlog: "Parked. Assigning an issue here never starts an agent run.",
  todo: "Queued. Moving an issue here starts the assigned agent.",
  in_progress: "Actively being worked on.",
  in_review: "Delivered, waiting on human review. Finalizes the autopilot run.",
  blocked: "Stalled on an external dependency.",
  done: "Completed.",
  cancelled: "Decided not to do.",
};

export default function IssueStatusesSettingsScreen() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const currentSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const user = useAuthStore((s) => s.user);
  const { data: entries = [], isLoading, error } = useQuery(
    issueStatusListOptions(wsId),
  );
  const { data: members } = useQuery(memberListOptions(wsId));
  const reorder = useReorderIssueStatuses();
  const [showArchived, setShowArchived] = useState(false);

  // `me` stays null until the member list settles, which keeps `canManage`
  // false and the write controls out of the first paint — the alternative is an
  // "Add status" button that appears and then vanishes for a plain member.
  const me = members?.find((m) => m.user_id === user?.id);
  const canManage = me?.role === "owner" || me?.role === "admin";

  const groups = useMemo(() => groupIssueStatuses(entries), [entries]);
  const archivedCount = entries.filter((entry) => !!entry.archived_at).length;
  // The category of the one in-flight reorder, so only that section locks. A
  // single mutation instance can only ever serve one category at a time; this
  // stops a double-tap from queueing two overlapping rewrites of the same list.
  const reorderingCategory = reorder.isPending
    ? (reorder.variables?.category ?? null)
    : null;

  const openStatus = (entry: IssueStatusEntry) => {
    if (entry.is_system || isBuiltInIssueStatus(entry.key)) {
      Alert.alert(
        "Built-in status cannot be changed",
        "Built-in statuses are used by Multica and cannot be edited or archived. You can still change their order within the category.",
        [{ text: "Got it" }],
      );
      return;
    }
    router.push(`/${currentSlug}/more/settings/status-form?statusId=${entry.id}`);
  };

  const move = (
    entry: IssueStatusEntry,
    category: IssueStatusCategory,
    delta: -1 | 1,
  ) => {
    const ids = moveStatusInCategory(entries, category, entry.id, delta);
    if (!ids) return;
    reorder.mutate(
      { category, ids },
      { onError: () => Alert.alert("Could not save the new order.") },
    );
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <Text className="text-sm text-destructive text-center">
          Failed to load statuses.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-4 py-4 gap-6"
    >
      {/* Offered only once the workspace has something archived: a control that
          can never do anything is worse than an absent one. */}
      {archivedCount > 0 ? (
        <View className="rounded-md border border-border bg-card overflow-hidden">
          <View className="flex-row items-center gap-3 px-4 py-3">
            <Text className="flex-1 text-base font-medium text-foreground">
              {`Show archived (${archivedCount})`}
            </Text>
            <Switch checked={showArchived} onCheckedChange={setShowArchived} />
          </View>
        </View>
      ) : null}

      {groups.map((group) => {
        const rows = showArchived
          ? [...group.active, ...group.archived]
          : group.active;
        return (
          <Section
            key={group.category}
            title={CATEGORY_LABEL[group.category]}
            description={CATEGORY_DESCRIPTION[group.category]}
            action={
              canManage ? (
                <IconButton
                  name="add"
                  iconSize={18}
                  className="h-8 w-8"
                  accessibilityLabel="Add status"
                  onPress={() =>
                    router.push(
                      `/${currentSlug}/more/settings/status-form?category=${group.category}`,
                    )
                  }
                />
              ) : null
            }
          >
            {rows.map((entry, index) => (
              <View key={entry.id}>
                <StatusRow
                  entry={entry}
                  category={group.category}
                  entries={entries}
                  label={issueStatusLabel(entry)}
                  description={describeStatus(entry, group.category)}
                  canManage={canManage}
                  reordering={reorderingCategory === group.category}
                  onOpen={() => openStatus(entry)}
                  onMove={(delta) => move(entry, group.category, delta)}
                />
                {index < rows.length - 1 ? <Separator /> : null}
              </View>
            ))}
          </Section>
        );
      })}
    </ScrollView>
  );
}

/**
 * The line under a status name: built-ins render mobile's own one-liner, a
 * custom status its own description, and a custom status whose author left the
 * description blank falls back to the meaning of its category.
 */
function describeStatus(
  entry: IssueStatusEntry,
  category: IssueStatusCategory,
): string {
  return isBuiltInIssueStatus(entry.key)
    ? BUILT_IN_DESCRIPTION[entry.key]
    : entry.description?.trim() || CATEGORY_DESCRIPTION[category];
}

function StatusRow({
  entry,
  category,
  entries,
  label,
  description,
  canManage,
  reordering,
  onOpen,
  onMove,
}: {
  entry: IssueStatusEntry;
  category: IssueStatusCategory;
  /** The whole catalog — `moveStatusInCategory` resolves the category's order. */
  entries: IssueStatusEntry[];
  label: string;
  description: string;
  canManage: boolean;
  reordering: boolean;
  onOpen: () => void;
  onMove: (delta: -1 | 1) => void;
}) {
  const archived = Boolean(entry.archived_at);
  // Null means "already at that end of the category" — exactly the condition
  // that disables the button. The endpoint answers a move past the edge with a
  // 4xx, so the control refuses before the request exists. Both ends being null
  // is also how a one-row category ends up with no reorder controls at all.
  const upIds = moveStatusInCategory(entries, category, entry.id, -1);
  const downIds = moveStatusInCategory(entries, category, entry.id, 1);
  const reorderable = canManage && !archived && (upIds !== null || downIds !== null);
  // An archived row is history: it has no editor, no order and no press state.
  const interactive = canManage && !archived;

  return (
    <Pressable
      onPress={onOpen}
      disabled={!interactive}
      className={cn(
        "flex-row items-center gap-3 px-4 py-3.5",
        interactive && "active:bg-secondary",
      )}
    >
      <StatusIcon
        status={entry.key}
        category={category}
        color={issueStatusColor(entry)}
        icon={entry.icon}
        size={16}
      />
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text
            numberOfLines={1}
            className="shrink text-base font-medium text-foreground"
          >
            {label}
          </Text>
          {archived ? (
            <View className="rounded-full bg-muted px-1.5 py-0.5">
              <Text className="text-xs text-muted-foreground">Archived</Text>
            </View>
          ) : null}
        </View>
        <Text numberOfLines={2} className="mt-0.5 text-xs text-muted-foreground">
          {description}
        </Text>
        {archived ? (
          <Text className="mt-1 text-xs text-muted-foreground">
            Retired from new assignments. Issues already on it keep it.
          </Text>
        ) : null}
      </View>
      {reorderable ? (
        <View className="items-center">
          <IconButton
            name="chevron-up"
            iconSize={16}
            className="h-7 w-7"
            disabled={upIds === null || reordering}
            onPress={() => onMove(-1)}
            accessibilityLabel={`Move ${label} up`}
          />
          <IconButton
            name="chevron-down"
            iconSize={16}
            className="h-7 w-7"
            disabled={downIds === null || reordering}
            onPress={() => onMove(1)}
            accessibilityLabel={`Move ${label} down`}
          />
        </View>
      ) : null}
    </Pressable>
  );
}

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  // A category nobody has statuses in keeps its header — that is where its
  // "Add status" entry point lives — but skips the card, which would otherwise
  // render as an empty bordered box.
  const isEmpty = Children.count(children) === 0;
  return (
    <View className="gap-2">
      <View className="flex-row items-start gap-2 px-1">
        <View className="flex-1">
          <Text className="text-xs uppercase tracking-wider text-muted-foreground">
            {title}
          </Text>
          {description ? (
            <Text className="text-xs text-muted-foreground mt-1">
              {description}
            </Text>
          ) : null}
        </View>
        {action}
      </View>
      {isEmpty ? null : (
        <View className="rounded-md border border-border bg-card overflow-hidden">
          {children}
        </View>
      )}
    </View>
  );
}
