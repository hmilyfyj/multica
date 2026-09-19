/**
 * Inbox filter sheet — status / priority / source / unread-only, presented as a
 * formSheet by the parent Stack (SHEET_OPTIONS in
 * app/(app)/[workspace]/_layout.tsx), the same container the Issues filter uses.
 *
 * Why a sheet and not a dropdown: the web filter menu is a multi-level
 * popover with counts, which a phone cannot show (no hover, and four
 * dimensions with counts overflow). apps/mobile/AGENTS.md routes "long list,
 * search, form" to a formSheet, and `issues-filter.tsx` already established the
 * layout — title + Reset, section label, checkbox rows.
 *
 * Parity with packages/views/inbox/components/inbox-filter-menu.tsx:
 *   - Counts are FACETED: each number counts rows under the OTHER active
 *     dimensions, ignoring its own, so it says how many rows selecting that
 *     value can reveal.
 *   - Main view counts the list it already has (fully loaded, client-side).
 *     The archived view cannot — it is paginated — so it reads the server's
 *     facets endpoint, which applies the same rule in SQL.
 *   - The priority section only exists when the response proves the backend
 *     serializes `issue_priority` (inboxPriorityFilterSupport); the archived
 *     endpoint always does.
 *   - Self-contained like issues-filter.tsx: it reads and writes the view store
 *     directly, no callback plumbing.
 */
import { useMemo } from "react";
import type { ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { IssuePriority } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { StatusIcon } from "@/components/ui/status-icon";
import { PriorityIcon } from "@/components/ui/priority-icon";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import {
  archivedInboxFacetsOptions,
  archivedInboxPagesOptions,
  inboxListOptions,
} from "@/data/queries/inbox";
import {
  useInboxFilters,
  useInboxViewStore,
} from "@/data/stores/inbox-view-store";
import { useActorLookup } from "@/data/use-actor-name";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  deduplicateArchivedInboxItems,
  deduplicateInboxItems,
} from "@/lib/inbox-display";
import {
  inboxActorCounts,
  inboxActorKey,
  inboxActorKeyParts,
  inboxFacetItems,
  inboxFiltersForPrioritySupport,
  inboxPriorityCounts,
  inboxPriorityFilterSupport,
  inboxStatusCounts,
  inboxUnreadCountOf,
} from "@/lib/inbox-filters";
import { PRIORITY_LABEL, statusOptions } from "@/lib/issue-status";
import { useIssueStatuses } from "@/lib/use-issue-statuses";
import { cn } from "@/lib/utils";

// Display order for the priority section. Mirrors PRIORITY_DISPLAY_ORDER in
// packages/core/issues/config/priority.ts — a constant list, so it is mirrored
// rather than pulled in through core's config barrel (same call as
// issues-filter.tsx).
const PRIORITY_ORDER: IssuePriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
];

export default function InboxFilterRoute() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const view = useInboxViewStore((s) => s.view);
  const filters = useInboxFilters();
  const isArchivedView = view === "archived";

  const toggleUnreadOnly = useInboxViewStore((s) => s.toggleUnreadOnly);
  const toggleStatus = useInboxViewStore((s) => s.toggleStatusFilter);
  const togglePriority = useInboxViewStore((s) => s.togglePriorityFilter);
  const toggleActor = useInboxViewStore((s) => s.toggleActorFilter);
  // No capability effect here: the screen hosting this sheet owns it (it stays
  // mounted while the sheet is transient), and this sheet only needs the
  // derived filters below to render the right checked state.
  const clearFilters = useInboxViewStore((s) => s.clearFilters);

  const catalog = useIssueStatuses();
  const { getName } = useActorLookup();
  const statusChoices = statusOptions(catalog);

  // Both sources are the same caches the list itself reads, so opening the
  // sheet costs no request in the main view (and reuses the archived pages
  // already on screen there).
  const listQuery = useQuery({
    ...inboxListOptions(wsId),
    enabled: !!wsId && !isArchivedView,
  });
  const archivedQuery = useInfiniteQuery({
    ...archivedInboxPagesOptions(wsId, filters),
    enabled: !!wsId && isArchivedView,
  });
  const facetsQuery = useQuery({
    ...archivedInboxFacetsOptions(wsId, filters),
    enabled: !!wsId && isArchivedView,
  });
  const facets = facetsQuery.data;

  // Same rows the list renders, dedup'd the same way — counting a different
  // set than the user sees is how a filter ends up offering a value that
  // reveals nothing.
  const items = useMemo(
    () =>
      isArchivedView
        ? deduplicateArchivedInboxItems(
            archivedQuery.data?.pages.flatMap((page) => page.items) ?? [],
          )
        : deduplicateInboxItems(listQuery.data ?? []),
    [isArchivedView, archivedQuery.data, listQuery.data],
  );

  const priorityFilterSupport = isArchivedView
    ? "supported"
    : inboxPriorityFilterSupport(listQuery.data ?? []);
  const effectiveFilters = useMemo(
    () => inboxFiltersForPrioritySupport(filters, priorityFilterSupport),
    [filters, priorityFilterSupport],
  );


  const localUnreadCount = useMemo(
    () => inboxUnreadCountOf(inboxFacetItems(items, effectiveFilters, "unreadOnly")),
    [items, effectiveFilters],
  );
  const statuses = useMemo(
    () =>
      isArchivedView
        ? new Map(Object.entries(facets?.statuses ?? {}))
        : inboxStatusCounts(
            inboxFacetItems(items, effectiveFilters, "statuses"),
          ),
    [isArchivedView, facets, items, effectiveFilters],
  );
  const priorities = useMemo(
    () =>
      isArchivedView
        ? new Map(Object.entries(facets?.priorities ?? {}))
        : inboxPriorityCounts(
            inboxFacetItems(items, effectiveFilters, "priorities"),
          ),
    [isArchivedView, facets, items, effectiveFilters],
  );
  const actors = useMemo(
    () =>
      isArchivedView
        ? new Map(Object.entries(facets?.actors ?? {}))
        : inboxActorCounts(inboxFacetItems(items, effectiveFilters, "actors")),
    [isArchivedView, facets, items, effectiveFilters],
  );
  // The universe of actors comes from the whole view, not the faceted subset:
  // picking one actor must not remove the others from the menu that offers
  // them. Sorted by name so the list does not reshuffle as counts change.
  const actorOptions = useMemo(() => {
    const keys = new Set<string>(
      isArchivedView
        ? [...Object.keys(facets?.actors ?? {}), ...filters.actors]
        : [],
    );
    if (!isArchivedView) {
      for (const item of items) {
        const key = inboxActorKey(item);
        if (key != null) keys.add(key);
      }
    }
    return [...keys]
      .map((key) => {
        const { type, id } = inboxActorKeyParts(key);
        return { key, type, id, name: getName(type as "member" | "agent" | "squad", id) };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [isArchivedView, items, facets, filters.actors, getName]);

  const unreadCount = isArchivedView
    ? (facets?.unreadCount ?? 0)
    : localUnreadCount;
  const hasActive = effectiveFilters.statuses.length > 0 ||
    effectiveFilters.priorities.length > 0 ||
    effectiveFilters.actors.length > 0 ||
    effectiveFilters.unreadOnly;

  return (
    <View className="flex-1">
      <View className="flex-row items-center justify-between px-4 pt-4 pb-3">
        <Text className="text-base font-semibold text-foreground">Filter</Text>
        {hasActive ? (
          <Pressable
            onPress={clearFilters}
            hitSlop={8}
            className="px-2 py-1 active:opacity-60"
          >
            <Text className="text-sm text-primary font-medium">Reset</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {isArchivedView && facetsQuery.isLoading ? (
          <Text className="px-4 pb-2 text-xs text-muted-foreground">
            Loading…
          </Text>
        ) : null}
        {isArchivedView && facetsQuery.isError ? (
          <View className="px-4 pb-2 gap-2">
            <Text className="text-xs text-destructive">
              Could not load filters
            </Text>
            <Button
              variant="outline"
              size="sm"
              onPress={() => void facetsQuery.refetch()}
            >
              <Text>Retry</Text>
            </Button>
          </View>
        ) : null}

        <OptionRow
          label="Unread only"
          count={unreadCount}
          checked={effectiveFilters.unreadOnly}
          onPress={toggleUnreadOnly}
        />

        {actorOptions.length > 0 ? (
          <>
            <SectionLabel>From</SectionLabel>
            {actorOptions.map((option) => (
              <OptionRow
                key={option.key}
                label={option.name}
                count={actors.get(option.key) ?? 0}
                checked={effectiveFilters.actors.includes(option.key)}
                onPress={() => toggleActor(option.key)}
                icon={
                  <ActorAvatar
                    type={
                      option.type as "member" | "agent" | "system" | "squad"
                    }
                    id={option.id}
                    size={16}
                  />
                }
              />
            ))}
          </>
        ) : null}

        <SectionLabel>Status</SectionLabel>
        {statusChoices.map((option) => (
          <OptionRow
            key={option.key}
            label={option.label}
            count={statuses.get(option.key) ?? 0}
            checked={effectiveFilters.statuses.includes(option.key)}
            onPress={() => toggleStatus(option.key)}
            icon={
              <StatusIcon
                status={option.key}
                category={option.category}
                icon={option.icon}
                color={option.color}
                size={16}
              />
            }
          />
        ))}

        {priorityFilterSupport === "supported" ? (
          <>
            <SectionLabel>Priority</SectionLabel>
            {PRIORITY_ORDER.map((priority) => (
              <OptionRow
                key={priority}
                label={PRIORITY_LABEL[priority]}
                count={priorities.get(priority) ?? 0}
                checked={effectiveFilters.priorities.includes(priority)}
                onPress={() => togglePriority(priority)}
                icon={<PriorityIcon priority={priority} />}
              />
            ))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <View className="px-4 pt-3 pb-1.5">
      <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
        {children}
      </Text>
    </View>
  );
}

/**
 * One checkbox row. `count` is the faceted number of rows this selection would
 * reveal; a zero means selecting it shows nothing, so the number is hidden
 * rather than printed as "0" (web hides it too).
 */
function OptionRow({
  label,
  count,
  checked,
  onPress,
  icon,
}: {
  label: string;
  count: number;
  checked: boolean;
  onPress: () => void;
  icon?: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      className={cn(
        "flex-row items-center gap-3 px-4 py-2.5 active:bg-secondary",
        checked && "bg-secondary/60",
      )}
    >
      {icon}
      <Text className="flex-1 text-sm text-foreground">{label}</Text>
      {count > 0 ? (
        <Text className="text-xs text-muted-foreground">{count}</Text>
      ) : null}
      {checked ? (
        <Text className="text-sm text-primary font-semibold">✓</Text>
      ) : null}
    </Pressable>
  );
}
