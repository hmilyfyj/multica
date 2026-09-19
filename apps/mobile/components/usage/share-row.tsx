import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * One ranked row with a share bar — the shape both Usage rankings (tokens /
 * run time / runs by agent) and both Errors lists (failure classes, offenders)
 * need: a name, its number, and how it compares to the biggest row.
 *
 * `share` is a fraction of the heaviest row, not of the total, so the top row
 * always fills the bar and the rest read as proportions of it. A share bar
 * beats a second right-aligned column on a phone: it compares rows without
 * asking the reader to do arithmetic on numbers that may be four digits long.
 *
 * A row that opens something (an agent, say) makes the WHOLE row the target and
 * shows a chevron; the glyph is decorative rather than a nested button, so the
 * row stays one focusable element with one label.
 */
export function ShareRow({
  label,
  value,
  hint,
  share,
  onPress,
  barClassName,
}: {
  label: string;
  /** The row's headline number, already formatted. */
  value: string;
  /** Secondary line — the denominator or breakdown behind `value`. */
  hint?: string;
  /** 0–1, relative to the heaviest row. */
  share: number;
  /** Set when the row opens something; omitted rows are inert. */
  onPress?: () => void;
  /** Bar fill — offenders use the destructive token. */
  barClassName?: string;
}) {
  const { colorScheme } = useColorScheme();
  const t = THEME[colorScheme];

  const content = (
    <View className={cn("flex-1 gap-1.5 py-2", onPress && "pr-1")}>
      <View className="flex-row items-baseline gap-3">
        <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
          {label}
        </Text>
        <Text className="text-sm font-medium text-foreground tabular-nums">
          {value}
        </Text>
      </View>
      <View className="h-1.5 overflow-hidden rounded-full bg-muted">
        <View
          className={cn("h-1.5 rounded-full bg-primary", barClassName)}
          style={{ width: `${sharePercent(share)}%` }}
        />
      </View>
      {hint ? (
        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      className="flex-row items-center rounded-md active:bg-secondary"
    >
      {content}
      <Ionicons
        name="chevron-forward"
        size={14}
        color={t.mutedForeground}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    </Pressable>
  );
}

function sharePercent(share: number): number {
  if (!Number.isFinite(share)) return 0;
  return Math.min(100, Math.max(0, share * 100));
}
