/**
 * Inbox tab — the active notification list plus the archived sub-view, with the
 * filter selection applied to both.
 *
 * Structure mirrors packages/views/inbox/components/inbox-page.tsx:
 *   - `view` ("inbox" | "archived") picks the DATA SOURCE, it is not a filter
 *     over one list — the server decides which list an issue belongs to, so the
 *     two are mutually exclusive per issue.
 *   - The main list keeps its batch menu; the archived one hides it, because
 *     every batch entry archives FROM the main inbox and offering them next to
 *     the archive reads as "archive these" while doing the opposite.
 *   - The archived list is cursor paginated (50/page) with the filters sent
 *     server-side; the main list is the full `GET /api/inbox` result filtered
 *     client-side, exactly as web does it.
 *   - The entry into the archive sits below the last row; the way back sits
 *     above the first one. Both are list rows, not header chrome — the page is
 *     still "Inbox" (web keeps its title too and reads the archive as a
 *     sub-view).
 *
 * Row actions: swipe reveals archive/unarchive (reveal-only, tap to fire); long
 * press opens the action sheet with the same actions web's right-click menu
 * offers — mark read/unread (main view only, matching web: archived rows render
 * as read and the unread count excludes them, so a toggle there would report
 * success and change nothing visible) plus archive/unarchive.
 */
import { useCallback, useEffect, useMemo } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, View } from "react-native";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { InboxItem } from "@multica/core/types";
import { showActionSheet } from "@/components/ui/action-sheet";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Header } from "@/components/ui/header";
import { IconButton } from "@/components/ui/icon-button";
import { HeaderActions } from "@/components/ui/app-header-actions";
import { SwipeableInboxRow } from "@/components/inbox/swipeable-inbox-row";
import { InboxFilterChips } from "@/components/inbox/inbox-filter-chips";
import {
  archivedInboxPagesOptions,
  inboxListOptions,
} from "@/data/queries/inbox";
import {
  useArchiveAllInbox,
  useArchiveAllReadInbox,
  useArchiveCompletedInbox,
  useArchiveInbox,
  useMarkAllInboxRead,
  useMarkInboxRead,
  useMarkInboxUnread,
  useUnarchiveInbox,
} from "@/data/mutations/inbox";
import {
  useInboxFilters,
  useInboxViewStore,
} from "@/data/stores/inbox-view-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useClearFiltersOnWorkspaceChange } from "@/lib/use-clear-filters-on-workspace-change";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { maybePromptForNotificationPermission } from "@/lib/inbox-notification-prompt";
import {
  deduplicateArchivedInboxItems,
  deduplicateInboxItems,
  getInboxDisplayTitle,
  getInboxNavigationTarget,
} from "@/lib/inbox-display";
import {
  filterInboxItems,
  inboxFilterCount,
  inboxFiltersForPrioritySupport,
  inboxPriorityFilterSupport,
} from "@/lib/inbox-filters";

export default function Inbox() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);

  // Ask for Android's notification permission the first time the user lands
  // here — at most once per install, and never when it is already granted. The
  // settings row alone left it too easy to install the app and never learn that
  // banners need a grant. See lib/inbox-notification-prompt.ts.
  useEffect(() => {
    void maybePromptForNotificationPermission();
  }, []);

  const view = useInboxViewStore((s) => s.view);
  const setView = useInboxViewStore((s) => s.setView);
  const clearPriorityFilters = useInboxViewStore((s) => s.clearPriorityFilters);
  const clearFilters = useInboxViewStore((s) => s.clearFilters);
  const filters = useInboxFilters();
  const isArchivedView = view === "archived";
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

  // Filters are not per-workspace buckets (see data/stores/inbox-view-store.ts)
  // — a status selection made in one workspace must not survive into another
  // workspace's list.
  useClearFiltersOnWorkspaceChange(
    useInboxViewStore.getState().clearFilters,
    wsId,
  );

  const listQuery = useQuery({
    ...inboxListOptions(wsId),
    enabled: !!wsId && !isArchivedView,
  });
  const archivedQuery = useInfiniteQuery({
    ...archivedInboxPagesOptions(wsId, filters),
    enabled: !!wsId && isArchivedView,
  });

  const rawItems = useMemo(() => listQuery.data ?? [], [listQuery.data]);

  // Priority filtering exists only if the rows carry `issue_priority` (an older
  // backend omits it). The archived endpoints always do. A selection made
  // before a downgrade stays dormant while the capability is unknown, and is
  // dropped once incompatibility is confirmed — same rule as web's filter menu.
  const prioritySupport = isArchivedView
    ? "supported"
    : inboxPriorityFilterSupport(rawItems);
  const effectiveFilters = useMemo(
    () => inboxFiltersForPrioritySupport(filters, prioritySupport),
    [filters, prioritySupport],
  );
  const activeFilterCount = inboxFilterCount(effectiveFilters);

  const unsupportedPriorityCount = filters.priorities.length;
  useEffect(() => {
    if (prioritySupport === "unsupported" && unsupportedPriorityCount > 0) {
      clearPriorityFilters();
    }
  }, [clearPriorityFilters, prioritySupport, unsupportedPriorityCount]);

  // Dedup + drop the rows the current view must not show, matching web/desktop.
  // See CLAUDE.md "Behavioral parity" → inbox dedup incident.
  const viewItems = useMemo(
    () =>
      isArchivedView
        ? deduplicateArchivedInboxItems(
            archivedQuery.data?.pages.flatMap((page) => page.items) ?? [],
          )
        : deduplicateInboxItems(rawItems),
    [isArchivedView, archivedQuery.data, rawItems],
  );
  const data = useMemo(
    () => filterInboxItems(viewItems, effectiveFilters),
    [viewItems, effectiveFilters],
  );

  const markRead = useMarkInboxRead();
  const markUnread = useMarkInboxUnread();
  const archive = useArchiveInbox();
  const unarchive = useUnarchiveInbox();
  const markAllRead = useMarkAllInboxRead();
  const archiveAll = useArchiveAllInbox();
  const archiveAllRead = useArchiveAllReadInbox();
  const archiveCompleted = useArchiveCompletedInbox();

  const onPressItem = (item: InboxItem) => {
    if (!item.read) {
      // Optimistic read flip lives in useMarkInboxRead.onMutate — fires
      // setQueryData synchronously before the cancelQueries await, so the
      // row is already styled "read" by the time iOS captures the source
      // snapshot for the native stack push transition.
      markRead.mutate(item.id);
    }
    const target = getInboxNavigationTarget(item, wsSlug, String(Date.now()));
    if (target) router.push(target);
  };

  /** The same action set web's right-click menu offers, as an action sheet. */
  const onLongPressItem = (item: InboxItem) => {
    const options = isArchivedView
      ? ["Cancel", "Unarchive"]
      : [
          "Cancel",
          item.read ? "Mark as unread" : "Mark as read",
          "Archive",
        ];
    showActionSheet(
      {
        options,
        cancelButtonIndex: 0,
        destructiveButtonIndex: isArchivedView ? undefined : 2,
        title: getInboxDisplayTitle(item),
      },
      (i) => {
        if (i === 0) return;
        if (isArchivedView) {
          unarchive.mutate(item.id);
          return;
        }
        if (i === 1) {
          if (item.read) markUnread.mutate(item.id);
          else markRead.mutate(item.id);
          return;
        }
        archive.mutate(item.id);
      },
    );
  };

  const openFilter = () => {
    if (!wsSlug) return;
    router.push({ pathname: "/[workspace]/inbox-filter", params: { workspace: wsSlug } });
  };

  // Trailing batch menu — mirrors web's dropdown
  // (packages/views/inbox/components/inbox-page.tsx). "Mark all read" is
  // first (most common batch op); "Archive all" is destructive so it gets
  // the destructive treatment + Alert confirm. Main view only: every entry
  // archives FROM the main inbox, so showing them over the archived list would
  // read as "archive these" and do the opposite.
  const onPressMenu = () => {
    const options = [
      "Cancel",
      "Mark all read",
      "Archive all read",
      "Archive completed",
      "Archive all",
    ];
    showActionSheet(
      {
        options,
        cancelButtonIndex: 0,
        destructiveButtonIndex: 4,
        title: "Inbox",
      },
      (i) => {
        if (i === 1) markAllRead.mutate();
        else if (i === 2) archiveAllRead.mutate();
        else if (i === 3) archiveCompleted.mutate();
        else if (i === 4) {
          Alert.alert(
            "Archive all?",
            "This archives every inbox item, read or unread. You can still find them via the issue pages.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Archive all",
                style: "destructive",
                onPress: () => archiveAll.mutate(),
              },
            ],
          );
        }
      },
    );
  };

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = archivedQuery;
  const loadMoreArchived = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const isLoading = isArchivedView
    ? archivedQuery.isLoading
    : listQuery.isLoading;
  // An archived failure only takes over the screen when there is nothing to
  // show; a failed "load more" is reported by the footer instead, so the pages
  // already loaded stay put.
  const viewError = isArchivedView ? archivedQuery.error : listQuery.error;
  const failed = isArchivedView
    ? archivedQuery.isError && !archivedQuery.data
    : !!listQuery.error;
  const errorMessage =
    viewError instanceof Error ? viewError.message : "unknown error";
  const isRefreshing = isArchivedView
    ? archivedQuery.isFetching && !archivedQuery.isFetchingNextPage
    : listQuery.isRefetching;
  const retry = isArchivedView
    ? () => void archivedQuery.refetch()
    : listQuery.refetch;

  return (
    <View className="flex-1 bg-background">
      <Header
        title="Inbox"
        right={
          <>
            <FilterButton onPress={openFilter} activeCount={activeFilterCount} />
            {!isArchivedView ? (
              <IconButton
                name="ellipsis-horizontal"
                onPress={onPressMenu}
                accessibilityLabel="Inbox actions"
              />
            ) : null}
            <HeaderActions />
          </>
        }
      />
      {activeFilterCount > 0 ? (
        <InboxFilterChips filters={effectiveFilters} />
      ) : null}
      {isArchivedView ? (
        <ArchivedBackRow onPress={() => setView("inbox")} iconColor={muted} />
      ) : null}
      {isLoading ? (
        <InboxLoading />
      ) : failed ? (
        <View className="px-4 gap-3 pt-4">
          <Text className="text-sm text-destructive">
            {isArchivedView ? "Failed to load archived notifications: " : "Failed to load inbox: "}
            {errorMessage}
          </Text>
          <Button variant="outline" onPress={() => retry()}>
            <Text>Retry</Text>
          </Button>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={() => (
            <View className="h-px bg-border ml-16" />
          )}
          contentContainerClassName="pb-6"
          renderItem={({ item }) => (
            <SwipeableInboxRow
              item={item}
              onPress={() => onPressItem(item)}
              onLongPress={() => onLongPressItem(item)}
              action={isArchivedView ? "unarchive" : "archive"}
              onAction={() =>
                isArchivedView
                  ? unarchive.mutate(item.id)
                  : archive.mutate(item.id)
              }
              archived={isArchivedView}
            />
          )}
          ListEmptyComponent={
            <InboxEmpty
              iconColor={muted}
              archived={isArchivedView}
              filtered={activeFilterCount > 0}
              onClearFilters={clearFilters}
            />
          }
          ListFooterComponent={
            isArchivedView ? (
              <ArchivedListFooter
                loadingMore={archivedQuery.isFetchingNextPage}
                loadMoreError={archivedQuery.isFetchNextPageError}
                onRetry={loadMoreArchived}
              />
            ) : (
              // Still offered when the main list is empty — that is the one
              // state where the user actually needs the archive.
              <ArchivedEntryRow
                iconColor={muted}
                onPress={() => setView("archived")}
              />
            )
          }
          refreshing={isRefreshing}
          onRefresh={() => retry()}
          onEndReached={isArchivedView ? loadMoreArchived : undefined}
          onEndReachedThreshold={0.5}
        />
      )}
    </View>
  );
}

/**
 * Filter trigger, with the live selection count on it.
 *
 * Mirrors web's `InboxFilterMenu` trigger: the same outline icon button
 * My Issues uses, except that with selections made it turns brand-coloured and
 * carries the count (web swaps to `variant=default` + the count for exactly
 * this). The count is the number of selections across all four dimensions, not
 * the number of rows — it answers "how am I narrowing this list?".
 */
function FilterButton({
  onPress,
  activeCount,
}: {
  onPress: () => void;
  activeCount: number;
}) {
  const { colorScheme } = useColorScheme();
  const isActive = activeCount > 0;
  return (
    <Button
      variant={isActive ? "default" : "outline"}
      size="sm"
      onPress={onPress}
      accessibilityLabel={
        isActive ? `Filter, ${activeCount} active` : "Filter"
      }
      className={isActive ? "gap-1 px-2 bg-brand" : "w-9 px-0"}
    >
      <Ionicons
        name="options-outline"
        size={16}
        color={isActive ? "white" : THEME[colorScheme].mutedForeground}
      />
      {isActive ? (
        <Text className="text-xs font-medium text-white">{activeCount}</Text>
      ) : null}
    </Button>
  );
}

/** Way back out of the archive; sits above the first row, like web's. */
function ArchivedBackRow({
  onPress,
  iconColor,
}: {
  onPress: () => void;
  iconColor: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-1.5 border-b border-border px-4 py-2 active:bg-secondary"
    >
      <Ionicons name="chevron-back" size={16} color={iconColor} />
      <Text className="text-xs font-medium text-muted-foreground">Archived</Text>
    </Pressable>
  );
}

/** Entry into the archive; sits below the last row, like web's. */
function ArchivedEntryRow({
  onPress,
  iconColor,
}: {
  onPress: () => void;
  iconColor: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-2 border-t border-border px-4 py-3 active:bg-secondary"
    >
      <Ionicons name="archive-outline" size={16} color={iconColor} />
      <Text className="flex-1 text-sm text-muted-foreground">Archived</Text>
      <Ionicons name="chevron-forward" size={16} color={iconColor} />
    </Pressable>
  );
}

/**
 * Pagination footer for the archived list: a spinner while the next page is in
 * flight, and a retry on its own line when that page failed (the pages already
 * loaded stay on screen — a failed "load more" must not blank the list).
 */
function ArchivedListFooter({
  loadingMore,
  loadMoreError,
  onRetry,
}: {
  loadingMore: boolean;
  loadMoreError: boolean;
  onRetry: () => void;
}) {
  if (loadingMore) {
    return (
      <View className="py-4 items-center">
        <ActivityIndicator />
      </View>
    );
  }
  if (loadMoreError) {
    return (
      <View className="py-4 items-center gap-2">
        <Text className="text-xs text-destructive">
          Failed to load archived notifications
        </Text>
        <Button variant="outline" size="sm" onPress={onRetry}>
          <Text>Retry</Text>
        </Button>
      </View>
    );
  }
  return null;
}

// Loading state — 6 row-shaped Skeletons matching InboxRow's layout
// (avatar circle + two text lines). Perceived perf wins over a centered
// spinner because the eye immediately sees the list-like structure.
function InboxLoading() {
  return (
    <View className="px-4 pt-4 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <View key={i} className="flex-row gap-3">
          <Skeleton className="size-9 rounded-full" />
          <View className="flex-1 gap-2 pt-1">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * Three distinct empties, because they call for different next steps:
 * a filtered list with no match offers to clear the filters, the archive says
 * there is nothing archived, and an empty inbox says what will show up here.
 */
function InboxEmpty({
  iconColor,
  archived,
  filtered,
  onClearFilters,
}: {
  iconColor: string;
  archived: boolean;
  filtered: boolean;
  onClearFilters: () => void;
}) {
  if (filtered) {
    return (
      <View className="items-center justify-center px-8 pt-16 gap-3">
        <Ionicons name="funnel-outline" size={42} color={iconColor} />
        <Text className="text-base font-medium text-foreground text-center">
          No notifications match your filters
        </Text>
        <Button variant="outline" onPress={onClearFilters}>
          <Text>Clear filters</Text>
        </Button>
      </View>
    );
  }
  if (archived) {
    return (
      <View className="items-center justify-center px-8 pt-16 gap-3">
        <Ionicons name="archive-outline" size={42} color={iconColor} />
        <Text className="text-base font-medium text-foreground text-center">
          No archived notifications
        </Text>
      </View>
    );
  }
  return (
    <View className="items-center justify-center px-8 pt-16 gap-3">
      <Ionicons name="mail-open-outline" size={42} color={iconColor} />
      <Text className="text-base font-medium text-foreground text-center">
        Inbox zero
      </Text>
      <Text className="text-sm text-muted-foreground text-center">
        Mentions, assignments, and agent updates appear here.
      </Text>
    </View>
  );
}
