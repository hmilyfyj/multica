/**
 * Active-filter chips for the inbox — one chip per live selection, tapping one
 * clears just that selection.
 *
 * Mirrors the shape mobile already uses on My Issues / Issues
 * (`ActiveFilterChips` in app/(app)/[workspace]/(tabs)/my-issues.tsx): a chip
 * row under the header, same visuals, same "tap to remove" behavior. The inbox
 * needs one extra dimension (source / actor) and the unread toggle, both of
 * which web shows in its filter menu with a count — here they are chips, so the
 * selection is visible without opening the sheet.
 *
 * Rendered only when something is selected; the caller decides.
 */
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "@/components/ui/text";
import { useInboxViewStore } from "@/data/stores/inbox-view-store";
import { useActorLookup } from "@/data/use-actor-name";
import { inboxActorKeyParts, type InboxFilters } from "@/lib/inbox-filters";
import { PRIORITY_LABEL } from "@/lib/issue-status";
import { useIssueStatuses } from "@/lib/use-issue-statuses";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

export function InboxFilterChips({ filters }: { filters: InboxFilters }) {
  const catalog = useIssueStatuses();
  const { getName } = useActorLookup();
  const toggleStatus = useInboxViewStore((s) => s.toggleStatusFilter);
  const togglePriority = useInboxViewStore((s) => s.togglePriorityFilter);
  const toggleActor = useInboxViewStore((s) => s.toggleActorFilter);
  const toggleUnreadOnly = useInboxViewStore((s) => s.toggleUnreadOnly);

  return (
    <View className="flex-row flex-wrap gap-1.5 px-4 pb-2">
      {filters.unreadOnly ? (
        <Chip label="Unread only" onClear={toggleUnreadOnly} />
      ) : null}
      {filters.statuses.map((status) => (
        <Chip
          key={`s-${status}`}
          label={catalog.labelOf(status)}
          onClear={() => toggleStatus(status)}
        />
      ))}
      {filters.priorities.map((priority) => (
        <Chip
          key={`p-${priority}`}
          label={PRIORITY_LABEL[priority]}
          onClear={() => togglePriority(priority)}
        />
      ))}
      {filters.actors.map((actor) => {
        const { type, id } = inboxActorKeyParts(actor);
        return (
          <Chip
            key={`a-${actor}`}
            label={getName(type as "member" | "agent" | "squad", id)}
            onClear={() => toggleActor(actor)}
          />
        );
      })}
    </View>
  );
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  const { colorScheme } = useColorScheme();
  return (
    <Pressable
      onPress={onClear}
      accessibilityLabel={`Remove filter ${label}`}
      className="flex-row items-center gap-1 pl-2.5 pr-2 py-1 rounded-full border border-border bg-secondary/40 active:bg-secondary"
    >
      <Text className="text-xs text-foreground">{label}</Text>
      <Ionicons
        name="close"
        size={12}
        color={THEME[colorScheme].mutedForeground}
      />
    </Pressable>
  );
}
