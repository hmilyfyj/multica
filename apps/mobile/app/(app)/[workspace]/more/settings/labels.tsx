/**
 * Labels settings — the workspace's two label catalogs (`issue` / `skill`).
 *
 * Mirrors `packages/views/settings/components/labels-tab.tsx`: one scope
 * switch, a client-side filter over name + description, and a row per label
 * that opens the editor sheet. The row's `{{count}} used` figure comes from
 * the list endpoint's `usage_count` — the single-row write endpoints answer
 * with 0, so the count is only ever rendered from a list payload (the
 * mutations keep that value in place, see data/mutations/labels.ts).
 *
 * The two catalogs are independent server-side, so the resource type is part
 * of the query key: switching scopes fetches the other list rather than
 * re-filtering the first. The filter is reset on a scope change because a
 * query typed for one catalog rarely means anything in the other.
 */
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import SegmentedControl from "@react-native-segmented-control/segmented-control";
import type { Label, LabelResourceType } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { SearchField } from "@/components/ui/search-field";
import { Separator } from "@/components/ui/separator";
import { labelListOptions } from "@/data/queries/labels";
import { useWorkspaceStore } from "@/data/workspace-store";
import { labelColorOf } from "@/lib/label-color";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

/**
 * Label scopes this screen manages. Narrower than `LabelResourceType`: the
 * server still models agent labels, but the product no longer exposes any way
 * to create, apply or view them. Same narrowing as web's `LabelScope`.
 */
type LabelScope = Extract<LabelResourceType, "issue" | "skill">;

const SCOPES: { value: LabelScope; label: string }[] = [
  { value: "issue", label: "Issues" },
  { value: "skill", label: "Skills" },
];

export default function LabelsSettingsScreen() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const currentSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { colorScheme } = useColorScheme();

  const [scopeIndex, setScopeIndex] = useState(0);
  const [query, setQuery] = useState("");
  const scope = SCOPES[scopeIndex].value;
  const scopeLabel = SCOPES[scopeIndex].label;

  const { data: labels = [], isLoading, error } = useQuery(
    labelListOptions(wsId, scope),
  );

  // Client-side filter, same fields web filters on. The server already
  // returns the catalog ordered by name, so the rows are never re-sorted.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return labels;
    return labels.filter(
      (label) =>
        label.name.toLowerCase().includes(q) ||
        (label.description ?? "").toLowerCase().includes(q),
    );
  }, [labels, query]);

  const openForm = (labelId?: string) => {
    const idParam = labelId ? `&labelId=${encodeURIComponent(labelId)}` : "";
    router.push(
      `/${currentSlug}/more/settings/label-form?resourceType=${scope}${idParam}`,
    );
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-4 py-4 gap-6"
    >
      <View className="gap-3">
        <Text className="text-sm text-muted-foreground px-1">
          Issue labels and skill labels are separate.
        </Text>
        <SegmentedControl
          values={SCOPES.map((s) => s.label)}
          selectedIndex={scopeIndex}
          onValueChange={(value) => {
            const next = SCOPES.findIndex((s) => s.label === value);
            if (next < 0 || next === scopeIndex) return;
            setScopeIndex(next);
            setQuery("");
          }}
          // iOS renders a real UISegmentedControl, which follows the OS
          // appearance and rejects this prop; the Android implementation is
          // the JS one and needs to be told the app's scheme.
          appearance={Platform.OS === "android" ? colorScheme : undefined}
        />
      </View>

      <Section title={scopeLabel}>
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder="Filter by name or description..."
        />

        <Pressable
          onPress={() => openForm()}
          className="flex-row items-center gap-3 px-4 py-3.5 active:bg-secondary"
        >
          <Ionicons name="add" size={20} color={THEME[colorScheme].brand} />
          <Text className="flex-1 text-base font-medium text-foreground">
            New label
          </Text>
        </Pressable>

        <Separator />

        {/* Loading / error / empty stay inside the card so the scope switch
            and filter above keep their state while the other catalog loads —
            swapping the whole screen would unmount the control the user just
            touched. */}
        {isLoading ? (
          <View className="px-4 py-8 items-center gap-3">
            <ActivityIndicator />
            <Text className="text-sm text-muted-foreground">
              Loading labels...
            </Text>
          </View>
        ) : error ? (
          <View className="px-4 py-8">
            <Text className="text-sm text-destructive text-center">
              Failed to load labels.
            </Text>
          </View>
        ) : filtered.length === 0 ? (
          <View className="px-4 py-8">
            <Text className="text-sm text-muted-foreground text-center">
              {query.trim()
                ? "No matching labels"
                : `No ${scopeLabel} labels yet`}
            </Text>
          </View>
        ) : (
          filtered.map((label, idx) => (
            <View key={label.id}>
              <LabelRow label={label} onPress={() => openForm(label.id)} />
              {idx < filtered.length - 1 ? <Separator /> : null}
            </View>
          ))
        )}
      </Section>
    </ScrollView>
  );
}

function LabelRow({
  label,
  onPress,
}: {
  label: Label;
  onPress: () => void;
}) {
  const usage = label.usage_count ?? 0;

  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3 px-4 py-3.5 active:bg-secondary"
    >
      {/* The label's own colour, straight from the server — the one place
          semantic tokens can't apply. */}
      <View
        className="size-3 rounded-full"
        style={{ backgroundColor: labelColorOf(label) }}
      />
      <View className="flex-1">
        <Text className="text-base text-foreground" numberOfLines={1}>
          {label.name}
        </Text>
        {label.description ? (
          <Text
            className="text-sm text-muted-foreground mt-0.5"
            numberOfLines={1}
          >
            {label.description}
          </Text>
        ) : null}
      </View>
      {usage > 0 ? (
        <Text className="text-xs text-muted-foreground">{`${usage} used`}</Text>
      ) : null}
    </Pressable>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-2">
      <Text className="text-xs uppercase tracking-wider text-muted-foreground px-1">
        {title}
      </Text>
      <View className="rounded-md border border-border bg-card overflow-hidden">
        {children}
      </View>
    </View>
  );
}
