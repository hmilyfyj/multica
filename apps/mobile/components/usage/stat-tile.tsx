import { View } from "react-native";
import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/text";

/**
 * One KPI cell on the Usage screen. Three of these sit in a row, so both the
 * label and the value have to survive a narrow phone: they clip rather than
 * wrap, because a wrapped tile would push its two neighbours out of alignment.
 */
export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  /** Secondary line under the value — the denominator the KPI is measured against. */
  hint?: string;
}) {
  return (
    <Card className="flex-1 gap-0.5 p-3">
      <Text className="text-xs text-muted-foreground" numberOfLines={1}>
        {label}
      </Text>
      <Text
        className="text-lg font-semibold text-foreground"
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      {hint ? (
        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </Card>
  );
}

/** Horizontal strip of KPI cells. */
export function StatTileRow({ children }: { children: React.ReactNode }) {
  return <View className="flex-row gap-2">{children}</View>;
}
