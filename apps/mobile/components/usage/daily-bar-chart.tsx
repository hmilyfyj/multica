import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { formatDateLabel, type DailySeriesPoint } from "@/lib/usage-stats";

/** Bar drawing area. Tall enough to compare a 7-day window, short enough that
 *  two cards plus the KPI row still fit above the fold. */
const BAR_AREA_HEIGHT = 96;

/** A day with no activity keeps a stub so the axis reads as continuous time
 *  rather than as missing days. */
const MIN_BAR_HEIGHT = 2;

/**
 * Daily bars for the Usage trend card.
 *
 * Hand-drawn rather than charted: mobile ships no chart library, and the whole
 * question this card answers is "was this day heavier than the last one" — a
 * single series of proportional bars does that without pulling a new native
 * dependency into the app (see the dependency rule in apps/mobile/AGENTS.md).
 *
 * Bars are proportional to the window's peak, not to the sum, so the shape of
 * the window survives; the peak's number is printed instead of a y-axis.
 */
export function DailyBarChart({
  points,
  formatValue,
  barClassName,
  label,
}: {
  points: DailySeriesPoint[];
  /** Renders the peak value (and the row values the caller passes in). */
  formatValue: (value: number) => string;
  /** Bar fill — the Errors tab uses the destructive token. */
  barClassName?: string;
  /** Screen-reader summary; the bars themselves carry no text. */
  label: string;
}) {
  const peak = points.reduce((max, point) => Math.max(max, point.value), 0);
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <View className="gap-1.5">
      <View
        className="flex-row items-end gap-[2px]"
        style={{ height: BAR_AREA_HEIGHT }}
        accessible
        accessibilityRole="image"
        accessibilityLabel={label}
      >
        {points.map((point) => (
          <View
            key={point.date}
            className="flex-1 justify-end"
            style={{ minWidth: 1 }}
          >
            <View
              className={cn("w-full rounded-sm bg-primary", barClassName)}
              style={{ height: barHeight(point.value, peak) }}
            />
          </View>
        ))}
      </View>

      {first && last ? (
        <View className="flex-row items-center justify-between">
          <Text className="text-xs text-muted-foreground">
            {formatDateLabel(first.date)}
          </Text>
          <Text className="text-xs text-muted-foreground">
            Peak {formatValue(peak)}
          </Text>
          <Text className="text-xs text-muted-foreground">
            {formatDateLabel(last.date)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function barHeight(value: number, peak: number): number {
  if (peak <= 0 || value <= 0) return MIN_BAR_HEIGHT;
  return Math.max(MIN_BAR_HEIGHT, Math.round((value / peak) * BAR_AREA_HEIGHT));
}
