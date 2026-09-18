/**
 * Cross-platform action sheet — the one place in the app that knows how to
 * present a short action menu.
 *
 * iOS keeps the native `ActionSheetIOS` sheet, forwarded untouched: same
 * options, ordering, destructive colour and dismissal semantics as before.
 * Every other platform (Android, and web through react-native-web) gets the
 * JS panel below, because `ActionSheetIOS` has no native module there —
 * calling it throws `ActionSheetManager doesn't exist` (FEATURE-542 probe,
 * apps/mobile/docs/android-probe.md §3 B1).
 *
 * The JS panel reproduces what iOS gives for free:
 *   - `title` above the actions,
 *   - `destructiveButtonIndex` in the destructive colour,
 *   - `cancelButtonIndex` broken out into its own card at the bottom,
 *   - dismissing without picking — backdrop tap or Android back — reports
 *     `cancelButtonIndex`, exactly like tapping Cancel on iOS.
 *
 * Call sites only ever use `showActionSheet`; only this file may name
 * `ActionSheetIOS`. See .trellis/spec/mobile/frontend/android-platform.md
 * §平台差异原则.
 */
import { ActionSheetIOS, Modal, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import { continuousCorners } from "@/lib/radius";
import { cn } from "@/lib/utils";

export interface ActionSheetOptions {
  /** Button titles in display order. Same contract as `ActionSheetIOSOptions`. */
  options: string[];
  /** Index into `options` pulled out as the separated cancel action. */
  cancelButtonIndex?: number;
  /** Index into `options` painted in the destructive colour. */
  destructiveButtonIndex?: number;
  /** Small caption above the actions. */
  title?: string;
}

type ActionSheetRequest = {
  id: number;
  options: ActionSheetOptions;
  onSelect: (index: number) => void;
};

interface ActionSheetState {
  current: ActionSheetRequest | null;
  open: (request: Omit<ActionSheetRequest, "id">) => void;
  close: () => void;
}

let lastRequestId = 0;

/**
 * Only ever written on non-iOS platforms. A request *replaces* whatever is
 * on screen rather than queueing behind it: the comment "React…" sheet is
 * fired from inside the previous sheet's callback, and replacing the state
 * lets both updates land in one commit so the Modal swaps its content
 * instead of stacking a second dialog (Android drops the second one while
 * the first is still dismissing).
 */
const useActionSheetStore = create<ActionSheetState>((set) => ({
  current: null,
  open: ({ options, onSelect }) =>
    set({ current: { id: (lastRequestId += 1), options, onSelect } }),
  close: () => set({ current: null }),
}));

/**
 * Present an action menu. Mirrors
 * `ActionSheetIOS.showActionSheetWithOptions(options, callback)` — the
 * callback receives the zero-based index of the row the user picked, or
 * `cancelButtonIndex` when the sheet was dismissed without a pick.
 */
export function showActionSheet(
  options: ActionSheetOptions,
  onSelect: (index: number) => void,
): void {
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(options, onSelect);
    return;
  }
  useActionSheetStore.getState().open({ options, onSelect });
}

/** Backdrop tap / Android back — iOS reports the cancel button here too. */
function dismissActionSheet(): void {
  const { current, close } = useActionSheetStore.getState();
  close();
  const cancelButtonIndex = current?.options.cancelButtonIndex;
  if (current && cancelButtonIndex !== undefined) current.onSelect(cancelButtonIndex);
}

function selectAction(index: number): void {
  const { current, close } = useActionSheetStore.getState();
  close();
  current?.onSelect(index);
}

/**
 * Renders the JS action sheet. Mount once, near the root — call sites are
 * plain calls to `showActionSheet`, so they need no provider of their own.
 */
export function ActionSheetHost() {
  const current = useActionSheetStore((s) => s.current);

  return (
    <Modal
      visible={current !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismissActionSheet}
    >
      {current ? <ActionSheetPanel key={current.id} request={current} /> : null}
    </Modal>
  );
}

function ActionSheetPanel({ request }: { request: ActionSheetRequest }) {
  const insets = useSafeAreaInsets();
  const { options, cancelButtonIndex, destructiveButtonIndex, title } =
    request.options;
  // Indices stay the caller's — rows are never renumbered, so the callback
  // index keeps meaning the same slot in `options`.
  const actions = options
    .map((label, index) => ({ label, index }))
    .filter((action) => action.index !== cancelButtonIndex);
  const cancelIndex =
    cancelButtonIndex !== undefined &&
    cancelButtonIndex >= 0 &&
    cancelButtonIndex < options.length
      ? cancelButtonIndex
      : undefined;

  return (
    <Pressable
      className="flex-1 justify-end bg-black/40"
      onPress={dismissActionSheet}
    >
      {/* Taps that land on the panel itself — padding, title row, the gap
          between the two cards — must not dismiss; only the backdrop does. */}
      <Pressable
        onPress={() => {}}
        className="gap-2 px-2"
        style={{ paddingBottom: Math.max(insets.bottom, 12) }}
      >
        <View
          className="bg-popover border-border overflow-hidden rounded-xl border"
          style={continuousCorners}
        >
          {title ? (
            <View className="border-border border-b px-4 py-3">
              <Text className="text-muted-foreground text-center text-xs font-medium">
                {title}
              </Text>
            </View>
          ) : null}
          {actions.map(({ label, index }, position) => (
            <View key={`${index}-${label}`}>
              {position > 0 ? <Separator /> : null}
              <Pressable
                accessibilityRole="button"
                onPress={() => selectAction(index)}
                className="active:bg-secondary px-4 py-4"
              >
                <Text
                  className={cn(
                    "text-center text-base",
                    index === destructiveButtonIndex
                      ? "text-destructive"
                      : "text-foreground",
                  )}
                >
                  {label}
                </Text>
              </Pressable>
            </View>
          ))}
        </View>

        {cancelIndex !== undefined ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => selectAction(cancelIndex)}
            className="bg-popover border-border active:bg-secondary overflow-hidden rounded-xl border"
            style={continuousCorners}
          >
            <Text className="text-brand py-4 text-center text-base font-semibold">
              {options[cancelIndex]}
            </Text>
          </Pressable>
        ) : null}
      </Pressable>
    </Pressable>
  );
}
