/**
 * Status editor sheet — create a custom status, or rename / re-describe /
 * recolour / re-shape one that exists.
 *
 * Ported from web's `StatusEditorDialog`
 * (packages/views/settings/components/issue-statuses-tab.tsx). Registered as a
 * formSheet route, so `headerShown` is false and the body draws its own header
 * and owns its data lookup, mutation and dismissal.
 *
 * Two rules the server enforces and this form mirrors rather than discovering
 * through a failed request:
 *
 *   - **`key` and `category` are immutable.** The category row is rendered
 *     read-only when editing (with the reason stated), and the key is never
 *     sent — for a new status the server derives it and the create confirmation
 *     quotes it back, which is the only place a user can learn it.
 *   - **Archive is terminal** and refused while any issue still carries the
 *     status; the 409 carries the in-use count, so the retry prompt can name it.
 */
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type {
  IssueStatusCategory,
  IssueStatusIcon,
} from "@multica/core/types";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { KeyboardAvoidingView } from "@/components/ui/keyboard-avoiding-view";
import { StatusIcon } from "@/components/ui/status-icon";
import { issueStatusListOptions } from "@/data/queries/issue-statuses";
import {
  issueStatusArchiveConflictCount,
  useArchiveIssueStatus,
  useCreateIssueStatus,
  useUpdateIssueStatus,
} from "@/data/mutations/issue-statuses";
import { useWorkspaceStore } from "@/data/workspace-store";
import { CATEGORY_LABEL, STATUS_CATEGORIES, normalizeIssueStatusCategory } from "@/lib/issue-status";
import {
  DEFAULT_LABEL_COLOR,
  LABEL_COLOR_PRESETS,
  normalizeLabelColor,
} from "@/lib/label-color";
import { cn } from "@/lib/utils";

/**
 * The shapes the server accepts, in the order the picker shows them. Mirrors
 * `ISSUE_STATUS_ICONS` in packages/core/types/issue-status.ts, which the mobile
 * barrel re-exports only as a type — the annotation is what keeps a core rename
 * a compile error here instead of a silent mismatch.
 */
const ICON_SHAPES: readonly IssueStatusIcon[] = [
  "dotted",
  "circle",
  "half",
  "three_quarters",
  "check",
  "slash",
  "cross",
];

/** `""` is the server's "use my category's glyph" — the picker's Default. */
const ICON_CHOICES: readonly (IssueStatusIcon | "")[] = ["", ...ICON_SHAPES];

/** `issue_statuses.editor.icon_shapes` — spoken labels for the shape previews. */
const ICON_SHAPE_LABEL: Record<string, string> = {
  default: "Default",
  dotted: "Dotted circle",
  circle: "Circle",
  half: "Half-filled circle",
  three_quarters: "Three-quarter circle",
  check: "Checkmark",
  slash: "Slash",
  cross: "Cross",
};

/** A server icon the client does not know renders as the category glyph. */
function toIconShape(raw: string | null | undefined): IssueStatusIcon | "" {
  return ICON_SHAPES.includes(raw as IssueStatusIcon)
    ? (raw as IssueStatusIcon)
    : "";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export default function StatusFormSheet() {
  const params = useLocalSearchParams<{ statusId?: string; category?: string }>();
  const statusId =
    typeof params.statusId === "string" && params.statusId ? params.statusId : null;
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: entries = [], isLoading } = useQuery(
    issueStatusListOptions(wsId),
  );
  const create = useCreateIssueStatus();
  const update = useUpdateIssueStatus();
  const archive = useArchiveIssueStatus();

  const entry = statusId ? entries.find((e) => e.id === statusId) : undefined;
  const isEdit = statusId !== null;
  // An edit never changes the category, so it always renders the entry's own.
  // A create takes the section the sheet was opened from, validated because the
  // route param is a string that may carry a legacy or unknown spelling.
  const [draftCategory, setDraftCategory] = useState<IssueStatusCategory>(
    () =>
      normalizeIssueStatusCategory(
        typeof params.category === "string" ? params.category : "",
      ) ?? "unstarted",
  );
  const category = isEdit
    ? (entry ? (normalizeIssueStatusCategory(entry.category) ?? "unstarted") : "unstarted")
    : draftCategory;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(DEFAULT_LABEL_COLOR);
  const [colorText, setColorText] = useState(DEFAULT_LABEL_COLOR);
  const [icon, setIcon] = useState<IssueStatusIcon | "">("");
  const [seeded, setSeeded] = useState(false);
  const [archiving, setArchiving] = useState(false);

  // Seed once the entry lands. The `seeded` guard keeps a catalog refetch (a
  // rename from another session, the settle-time invalidation after a save)
  // from wiping what the user is typing.
  useEffect(() => {
    if (!entry || seeded) return;
    const next = normalizeLabelColor(entry.color) ?? DEFAULT_LABEL_COLOR;
    setName(entry.name);
    setDescription(entry.description ?? "");
    setColor(next);
    setColorText(next);
    setIcon(toIconShape(entry.icon));
    setSeeded(true);
  }, [entry, seeded]);

  // The typed hex is the authority: a half-typed `#3b8` must not overwrite the
  // last valid colour, and must not be submittable either.
  const typedColor = normalizeLabelColor(colorText);
  const saving = create.isPending || update.isPending;
  const canSave =
    name.trim().length > 0 &&
    typedColor !== null &&
    (isEdit ? seeded : true) &&
    !saving;

  const onSave = async () => {
    if (!canSave || !typedColor) return;
    const body = {
      name: name.trim(),
      description: description.trim(),
      color: typedColor,
      icon,
    };
    try {
      if (isEdit && statusId) {
        await update.mutateAsync({ id: statusId, body });
        router.back();
        return;
      }
      const created = await create.mutateAsync({ ...body, category });
      // A malformed 2xx parses to the empty entry; quoting its empty key would
      // read as a bug, and the status does exist, so just dismiss.
      if (!created.key) {
        router.back();
        return;
      }
      Alert.alert(
        "Status created",
        `The API and the CLI refer to it as ${created.key}.`,
        [{ text: "OK", onPress: () => router.back() }],
      );
    } catch (err) {
      Alert.alert("Could not save the status.", messageOf(err));
    }
  };

  const runArchive = async (id: string) => {
    setArchiving(true);
    try {
      await archive.mutateAsync(id);
      router.back();
    } catch (err) {
      const inUse = issueStatusArchiveConflictCount(err);
      if (inUse !== null) {
        Alert.alert(
          "Move issues before archiving",
          `Issues still using this status: ${inUse}. Move them to another status, including completed and canceled issues, then try again.`,
          [
            { text: "Cancel", style: "cancel" },
            { text: "Retry archive", onPress: () => void runArchive(id) },
          ],
        );
        return;
      }
      Alert.alert("Could not archive the status.", messageOf(err));
    } finally {
      setArchiving(false);
    }
  };

  const confirmArchive = () => {
    if (!entry) return;
    Alert.alert(
      "Archive this status?",
      `Move all issues out of "${entry.name}" before archiving it. Once empty, it will be removed from boards and status pickers.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Archive",
          style: "destructive",
          onPress: () => void runArchive(entry.id),
        },
      ],
    );
  };

  // A built-in is only reachable here by a deep link — the list intercepts the
  // tap. It has nothing this form could write, so it explains itself instead of
  // offering controls the server would refuse.
  if (isEdit && entry?.is_system) {
    return (
      <View className="flex-1 items-center justify-center gap-2 bg-background px-6">
        <Text className="text-base font-semibold text-foreground text-center">
          Built-in status cannot be changed
        </Text>
        <Text className="text-sm text-muted-foreground text-center">
          Built-in statuses are used by Multica and cannot be edited or archived.
          You can still change their order within the category.
        </Text>
      </View>
    );
  }

  if (isEdit && isLoading && !entry) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (isEdit && !entry) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <Text className="text-sm text-muted-foreground text-center">
          This status is no longer in the workspace.
        </Text>
      </View>
    );
  }

  const canArchive = isEdit && entry !== undefined && !entry.archived_at;

  return (
    <KeyboardAvoidingView className="flex-1 bg-background">
      <View className="px-4 pt-4 pb-3">
        <Text className="text-base font-semibold text-foreground">
          {isEdit ? "Edit status" : "New status"}
        </Text>
      </View>
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pb-8 gap-6"
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-4">
          <Field label="Name">
            <TextField
              value={name}
              onChangeText={setName}
              placeholder="e.g. Code Review"
              maxLength={64}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="done"
            />
            {entry ? (
              <Text className="text-xs text-muted-foreground mt-1.5">
                {`Referred to as ${entry.key} by the API and the CLI.`}
              </Text>
            ) : null}
          </Field>

          <Field label="Category">
            <View className="flex-row flex-wrap gap-2">
              {STATUS_CATEGORIES.map((option) => {
                const selected = category === option;
                return (
                  <Pressable
                    key={option}
                    disabled={isEdit}
                    onPress={() => setDraftCategory(option)}
                    className={cn(
                      "rounded-md border px-3 py-2",
                      selected
                        ? "border-ring bg-secondary"
                        : "border-border bg-card",
                      isEdit && "opacity-60",
                    )}
                  >
                    <Text
                      className={cn(
                        "text-sm",
                        selected
                          ? "font-medium text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {CATEGORY_LABEL[option]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {isEdit ? (
              <Text className="text-xs text-muted-foreground mt-1.5">
                Category cannot be changed after a status is created.
              </Text>
            ) : null}
          </Field>

          <Field label="Description">
            <AutosizeTextArea
              value={description}
              onChangeText={setDescription}
              placeholder="What this status means for your team"
              maxLength={256}
              maxHeight={120}
              className="rounded-md bg-secondary/50 px-3 py-2"
            />
          </Field>

          <Field label="Color">
            <View className="gap-3">
              <View className="flex-row flex-wrap gap-2">
                {LABEL_COLOR_PRESETS.map((preset) => {
                  const selected = color === preset;
                  return (
                    <Pressable
                      key={preset}
                      onPress={() => {
                        setColor(preset);
                        setColorText(preset);
                      }}
                      accessibilityLabel={preset}
                      className={cn(
                        "size-8 items-center justify-center rounded-full border-2",
                        selected ? "border-foreground" : "border-transparent",
                      )}
                      style={{ backgroundColor: preset }}
                    >
                      {selected ? (
                        <Ionicons name="checkmark" size={16} color="#ffffff" />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
              <TextField
                value={colorText}
                onChangeText={(text) => {
                  setColorText(text);
                  const next = normalizeLabelColor(text);
                  if (next) setColor(next);
                }}
                placeholder={DEFAULT_LABEL_COLOR}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                maxLength={7}
                invalid={typedColor === null}
              />
              {typedColor === null ? (
                <Text className="text-xs text-destructive">
                  Enter a six-digit hex color, e.g. #3b82f6.
                </Text>
              ) : null}
            </View>
          </Field>

          <Field label="Icon shape">
            <View className="flex-row flex-wrap gap-2">
              {ICON_CHOICES.map((shape) => {
                const selected = icon === shape;
                return (
                  <Pressable
                    key={shape || "default"}
                    onPress={() => setIcon(shape)}
                    accessibilityLabel={ICON_SHAPE_LABEL[shape || "default"]}
                    className={cn(
                      "h-10 w-10 items-center justify-center rounded-md border",
                      selected
                        ? "border-ring bg-secondary"
                        : "border-border bg-card",
                    )}
                  >
                    <StatusIcon
                      status=""
                      category={category}
                      color={color}
                      icon={shape}
                      size={18}
                    />
                  </Pressable>
                );
              })}
            </View>
          </Field>
        </View>

        <Button onPress={onSave} disabled={!canSave}>
          <Text>{saving ? "Saving…" : "Save"}</Text>
        </Button>

        {canArchive ? (
          <Button
            variant="destructive"
            onPress={confirmArchive}
            disabled={archiving}
          >
            <Text>{archiving ? "Archiving..." : "Archive"}</Text>
          </Button>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-1.5">
      <Text className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </Text>
      {children}
    </View>
  );
}
