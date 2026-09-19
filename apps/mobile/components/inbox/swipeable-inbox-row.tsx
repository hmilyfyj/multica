/**
 * Left-swipe-to-reveal action wrapper for inbox rows.
 *
 * iOS pattern reference: Mail.app / Linear iOS / Things — a row action
 * revealed by a leftward drag. **Reveal-only, no auto-fire**: the previous
 * version archived on full swipe past threshold, which felt aggressive (no
 * peek, easy to trigger by accident on a fast vertical scroll). Mail.app /
 * Linear require an explicit tap on the revealed action; we now match that. A
 * medium haptic fires once when the row crosses the action width during the
 * drag so the gesture still feels confirmed.
 *
 * The revealed action is the same reversal-of-the-current-view web's row button
 * and menu perform: archive in the main list, unarchive in the archived one
 * (`onAction` in packages/views/inbox/components/inbox-item-actions.tsx). The
 * caller says which list is showing; this component only renders what it is
 * told.
 *
 * Why ReanimatedSwipeable (not the legacy Swipeable): RNGH 2.20+ ships the
 * Reanimated-driven implementation that integrates cleanly with the
 * existing reanimated@4 install and runs the swipe on the UI thread (the
 * legacy version uses Animated, which janks on heavy lists). The
 * gesture-handler root is already mounted in apps/mobile/app/_layout.tsx.
 *
 * Behaviour notes:
 *   - `friction=2` slightly slows the drag so the action doesn't open by
 *     accident on a fast vertical scroll that catches some horizontal motion.
 *   - `rightThreshold=80` is the open-detent — releasing past it keeps the
 *     action button revealed; releasing short of it snaps closed. No
 *     auto-fire on cross.
 *   - We `swipeable.close()` before invoking the action so the row's exit
 *     from the FlatList (driven by the optimistic mutation flipping
 *     `archived`, which the parent's dedup helper filters on) doesn't race the
 *     spring close.
 *   - Long-press on the row body opens the action sheet instead, so every
 *     action is reachable without discovering the swipe (a touch pointer has
 *     no hover to reveal anything). The two gestures do not conflict: the
 *     swipeable owns the horizontal pan, the row's Pressable owns press-and-
 *     hold, and moving past the pan threshold cancels the long press.
 */
import { useRef } from "react";
import type { ComponentProps } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  type SharedValue,
  useAnimatedReaction,
  runOnJS,
} from "react-native-reanimated";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import type { InboxItem } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { InboxRow } from "./inbox-row";

const ACTION_WIDTH = 80;

/** Which list this row is in, and therefore what the revealed action does. */
export type InboxRowAction = "archive" | "unarchive";

/**
 * Per-action presentation. Archive is destructive — it removes the row.
 * Unarchive restores it, so it carries the brand colour instead of the
 * destructive treatment (web drops the destructive framing for it too).
 */
const ACTION_PRESENTATION: Record<
  InboxRowAction,
  {
    label: string;
    icon: ComponentProps<typeof Ionicons>["name"];
    className: string;
  }
> = {
  archive: {
    label: "Archive",
    icon: "archive-outline",
    className: "bg-destructive",
  },
  unarchive: {
    label: "Unarchive",
    icon: "arrow-undo-outline",
    className: "bg-brand",
  },
};

interface Props {
  item: InboxItem;
  onPress: () => void;
  /** Opens the row's action sheet — see InboxRow. */
  onLongPress?: () => void;
  action: InboxRowAction;
  onAction: () => void;
  archived?: boolean;
}

export function SwipeableInboxRow({
  item,
  onPress,
  onLongPress,
  action,
  onAction,
  archived,
}: Props) {
  const ref = useRef<SwipeableMethods>(null);

  const fireAction = () => {
    // Close first so the swipe spring doesn't fight the row's removal from
    // FlatList on the next render tick.
    ref.current?.close();
    onAction();
  };

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={2}
      rightThreshold={ACTION_WIDTH}
      renderRightActions={(_progress, drag) => (
        <RevealedAction action={action} onPress={fireAction} drag={drag} />
      )}
    >
      <InboxRow
        item={item}
        onPress={onPress}
        onLongPress={onLongPress}
        archived={archived}
      />
    </ReanimatedSwipeable>
  );
}

function RevealedAction({
  action,
  onPress,
  drag,
}: {
  action: InboxRowAction;
  onPress: () => void;
  drag: SharedValue<number>;
}) {
  const presentation = ACTION_PRESENTATION[action];

  // One-shot haptic when the drag crosses the action width threshold.
  // useAnimatedReaction runs on the UI thread; runOnJS bridges to the
  // Haptics.impactAsync call which has to live on JS.
  useAnimatedReaction(
    () => drag.value <= -ACTION_WIDTH,
    (crossed, prev) => {
      if (crossed && !prev) {
        runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Medium);
      }
    },
    [],
  );

  return (
    <Animated.View style={{ width: ACTION_WIDTH }}>
      <Pressable
        onPress={onPress}
        accessibilityLabel={presentation.label}
        className={cn(
          "flex-1 items-center justify-center",
          presentation.className,
        )}
      >
        <View className="items-center gap-0.5">
          <Ionicons name={presentation.icon} size={20} color="white" />
          <Text className="text-xs text-white">{presentation.label}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}
