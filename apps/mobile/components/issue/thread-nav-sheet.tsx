/**
 * Thread outline — the body of the `issue/[id]/threads` formSheet route, and
 * the mobile counterpart of the list web's ThreadMinimap opens on hover.
 *
 * One row per thread: author, first-line preview, reply count, and whether the
 * thread carries a resolution. Folded resolved threads are listed too (web
 * lists them, and their bar is exactly where a jump should land). The row the
 * reader is currently inside is tinted, so the outline answers "where am I"
 * as well as "take me there".
 *
 * Tapping a row requests the jump on the timeline behind and dismisses the
 * sheet — the same "sheet picks a value, screen behind applies it" flow as the
 * chat session picker. See data/stores/thread-nav-store.ts.
 *
 * Virtualised (FlashList) because a busy issue can hold a few hundred threads;
 * web's outline is a stationary scrollable list, so this one does not
 * auto-scroll to the current row either — it opens at the top with the current
 * row marked.
 */
import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useTheme } from "@react-navigation/native";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { threadPreview, type ThreadNavItem } from "@/lib/thread-nav";

interface Props {
  /** Every thread in render order. */
  threads: ThreadNavItem[];
  /** Thread the timeline's viewport is currently inside, if any. */
  currentThreadId: string | null;
  /** Pick a thread — the route requests the jump and dismisses. */
  onJump: (rootId: string) => void;
}

function replyLabel(count: number): string {
  if (count === 0) return "No replies";
  return count === 1 ? "1 reply" : `${count} replies`;
}

export function ThreadNavSheet({ threads, currentThreadId, onJump }: Props) {
  return (
    <View className="flex-1">
      <View className="px-4 pt-4 pb-3 gap-0.5">
        <Text className="text-base font-semibold text-foreground">Threads</Text>
        <Text className="text-xs text-muted-foreground">
          {threads.length === 1 ? "1 thread" : `${threads.length} threads`}
        </Text>
      </View>
      {threads.length === 0 ? (
        <Text className="px-4 text-sm text-muted-foreground">
          No comment threads yet.
        </Text>
      ) : (
        <FlashList
          data={threads}
          keyExtractor={(thread) => thread.rootId}
          ItemSeparatorComponent={Separator}
          renderItem={({ item }) => (
            <ThreadRow
              thread={item}
              isCurrent={item.rootId === currentThreadId}
              onPress={() => onJump(item.rootId)}
            />
          )}
        />
      )}
    </View>
  );
}

function ThreadRow({
  thread,
  isCurrent,
  onPress,
}: {
  thread: ThreadNavItem;
  isCurrent: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const preview = threadPreview(thread.entry);
  return (
    <Pressable
      onPress={onPress}
      className={cn(
        "flex-row items-center gap-3 px-4 py-3",
        isCurrent ? "bg-secondary" : "active:bg-secondary/60",
      )}
      accessibilityRole="button"
      accessibilityLabel={`Thread by ${thread.entry.actor_name ?? "unknown"}, ${replyLabel(thread.replyCount)}${thread.resolved ? ", resolved" : ""}. Tap to jump.`}
    >
      <ActorAvatar
        type={thread.entry.actor_type as "member" | "agent"}
        id={thread.entry.actor_id}
        name={thread.entry.actor_name}
        avatarUrl={thread.entry.actor_avatar_url}
        size={24}
      />
      <View className="flex-1 gap-0.5">
        <Text className="text-sm text-foreground" numberOfLines={1}>
          {preview}
        </Text>
        <Text className="text-xs text-muted-foreground">
          {replyLabel(thread.replyCount)}
        </Text>
      </View>
      {thread.resolved ? (
        <Ionicons name="checkmark-circle" size={16} color={colors.text} />
      ) : null}
    </Pressable>
  );
}
