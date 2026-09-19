/**
 * Floating thread stepper for the issue timeline — the phone-shaped answer to
 * web's quick-jump rail (packages/views/issues/components/thread-minimap.tsx).
 * Web's rail is deliberately hidden on mobile ("no hover, and the gutter is
 * too tight" — issue-detail.tsx), so the two things the rail actually does
 * land here instead:
 *
 *   - up / down halves move to the previous / next thread, relative to the
 *     thread the viewport is currently inside;
 *   - the round button opens the full thread outline
 *     (`thread-nav-sheet.tsx`), which is what makes a long issue navigable.
 *
 * The whole control is absent below `MIN_THREADS` — with one thread (or none)
 * there is nothing to step between, and web hides its rail by the same rule.
 *
 * It reads the current thread from the store rather than taking it as a prop:
 * the timeline writes that id on every viewability change while the user
 * scrolls, and a prop would re-render the list (and its cells) each time. Only
 * this component re-renders.
 */
import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { useTheme } from "@react-navigation/native";
import { Button } from "@/components/ui/button";
import { useThreadNavStore } from "@/data/stores/thread-nav-store";
import type { ThreadNavItem } from "@/lib/thread-nav";

interface Props {
  /** Every thread in render order (lib/thread-nav.ts). */
  threads: ThreadNavItem[];
  /** Park the named thread's root row at the top of the timeline. */
  onJump: (rootId: string) => void;
  /** Open the full thread outline sheet. */
  onOpen: () => void;
}

/** Same floating chrome as the "↓ N new" chip: a system shadow, so the
 *  control stays readable over light and dark timeline content alike. */
const FLOAT_SHADOW = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.18,
  shadowRadius: 6,
  elevation: 4,
} as const;

export function ThreadNavFab({ threads, onJump, onOpen }: Props) {
  const { colors } = useTheme();
  const currentThreadId = useThreadNavStore((s) => s.currentThreadId);

  // -1 = the viewport is above the first thread (the reader is in the header
  // or description) → "next" means the first thread, "previous" has nowhere
  // to go. Mirrors threadIndexAtRow's contract.
  const current = currentThreadId
    ? threads.findIndex((thread) => thread.rootId === currentThreadId)
    : -1;
  const prev = threads[current - 1];
  const next = threads[current + 1];
  const position = current >= 0 ? `${current + 1}/${threads.length}` : "";

  return (
    <View className="absolute bottom-3 right-4 items-end gap-2">
      <View
        className="flex-row items-center overflow-hidden rounded-full border border-border bg-popover"
        style={FLOAT_SHADOW}
      >
        <Button
          variant="ghost"
          className="h-9 w-11 rounded-none"
          disabled={!prev}
          onPress={() => prev && onJump(prev.rootId)}
          accessibilityLabel="Previous thread"
        >
          <Ionicons name="chevron-up" size={18} color={colors.text} />
        </Button>
        <View className="h-5 w-px bg-border" />
        <Button
          variant="ghost"
          className="h-9 w-11 rounded-none"
          disabled={!next}
          onPress={() => next && onJump(next.rootId)}
          accessibilityLabel="Next thread"
        >
          <Ionicons name="chevron-down" size={18} color={colors.text} />
        </Button>
      </View>
      <Button
        variant="default"
        size="icon"
        className="h-11 w-11 rounded-full"
        style={FLOAT_SHADOW}
        onPress={onOpen}
        accessibilityLabel={
          position
            ? `Thread list, ${threads.length} threads, on ${position}`
            : `Thread list, ${threads.length} threads`
        }
      >
        <Ionicons name="list" size={20} color={colors.background} />
      </Button>
    </View>
  );
}
