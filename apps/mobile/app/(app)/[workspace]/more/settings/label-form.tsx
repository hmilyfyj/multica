/**
 * Label editor formSheet — create a label or rename / recolour / re-describe
 * an existing one. Opens from `more/settings/labels`; the list passes the
 * active catalog as `resourceType` and the row's id as `labelId`.
 *
 * Reads the label out of the label LIST cache instead of a detail endpoint
 * (there isn't one): the route is pushed with the same `resourceType` the
 * list is showing, so the lookup is a cache hit and the form is seeded on the
 * first render. A cold hit (deep link) still resolves because the list query
 * fetches; an id that resolves to nothing leaves the sheet rather than
 * offering a Save that could not work.
 *
 * Colour: ten presets plus a hex field. The presets ARE the product palette
 * (`lib/label-color.ts` mirrors web's `COLOR_PICKER_PRESETS`), and the field
 * accepts what the server accepts — `#rrggbb` or bare `rrggbb`. A hex value
 * that does not parse marks the field invalid and leaves the selection on the
 * last colour that did, so Save always carries a colour the server takes.
 */
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { LabelResourceType } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { KeyboardAvoidingView } from "@/components/ui/keyboard-avoiding-view";
import { labelListOptions } from "@/data/queries/labels";
import {
  useCreateLabel,
  useDeleteLabel,
  useUpdateLabel,
} from "@/data/mutations/labels";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  DEFAULT_LABEL_COLOR,
  LABEL_COLOR_PRESETS,
  labelColorOf,
  normalizeLabelColor,
} from "@/lib/label-color";
import { cn } from "@/lib/utils";

/** The server rejects a name longer than this (runes, not bytes). */
const MAX_NAME_LENGTH = 32;

type LabelScope = Extract<LabelResourceType, "issue" | "skill">;

/** Anything but the skill catalog means issue — the server's own default. */
function scopeOf(raw: string | undefined): LabelScope {
  return raw === "skill" ? "skill" : "issue";
}

export default function LabelFormSheet() {
  const params = useLocalSearchParams<{
    resourceType: string;
    labelId: string;
  }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  const scope = scopeOf(params.resourceType);
  const labelId = params.labelId;
  const editing = Boolean(labelId);

  const { data: labels = [], isLoading } = useQuery(
    labelListOptions(wsId, scope),
  );
  const label = labelId ? labels.find((l) => l.id === labelId) : undefined;

  const createLabel = useCreateLabel();
  const updateLabel = useUpdateLabel();
  const deleteLabel = useDeleteLabel();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // `color` is the colour the form will save; `hex` is what the field shows.
  // They diverge only while the field holds something unparseable.
  const [color, setColor] = useState(DEFAULT_LABEL_COLOR);
  const [hex, setHex] = useState(DEFAULT_LABEL_COLOR);
  const [seeded, setSeeded] = useState(!labelId);
  // A create could otherwise fire twice before the disabled state re-renders.
  const submittingRef = useRef(false);

  // Seed once the label is in hand. A create has nothing to seed — its
  // defaults are already the right ones, hence `seeded` starts true there.
  useEffect(() => {
    if (seeded || !label) return;
    setName(label.name);
    setDescription(label.description ?? "");
    const initial = labelColorOf(label);
    setColor(initial);
    setHex(initial);
    setSeeded(true);
  }, [label, seeded]);

  // An id that resolves to nothing (deleted elsewhere, or a deep link into a
  // workspace that never had it) has no form to show — leave the sheet.
  useEffect(() => {
    if (!labelId || isLoading || label) return;
    router.back();
  }, [labelId, isLoading, label]);

  const saving = createLabel.isPending || updateLabel.isPending;
  const busy = saving || deleteLabel.isPending;
  const trimmedName = name.trim();
  const canSave = seeded && trimmedName.length > 0 && !busy;

  const onHexChange = (value: string) => {
    setHex(value);
    const parsed = normalizeLabelColor(value);
    if (parsed) setColor(parsed);
  };

  const onSave = async () => {
    if (!canSave || submittingRef.current) return;
    submittingRef.current = true;
    try {
      // Empty description clears it, which is what the server does with the
      // trimmed empty string web also sends.
      const body = {
        name: trimmedName,
        description: description.trim(),
        color,
      };
      if (label) await updateLabel.mutateAsync({ id: label.id, body });
      else await createLabel.mutateAsync({ resource_type: scope, ...body });
      router.back();
    } catch (err) {
      // A duplicate name is a 409 whose message names the clash — that is the
      // useful text. Anything else (offline, unparseable response) is not
      // worth surfacing raw.
      Alert.alert(
        "Couldn't save label",
        err instanceof Error ? err.message : "Couldn't save label",
      );
    } finally {
      submittingRef.current = false;
    }
  };

  const onDelete = () => {
    if (!label || busy) return;
    const target = label;
    Alert.alert(
      "Delete label?",
      `Delete "${target.name}"? It will be removed from ${
        target.usage_count ?? 0
      } resources. This can't be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete label",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                await deleteLabel.mutateAsync(target.id);
                router.back();
              } catch (err) {
                Alert.alert(
                  "Couldn't delete label",
                  err instanceof Error ? err.message : "Couldn't delete label",
                );
              }
            })();
          },
        },
      ],
    );
  };

  // Editing a label whose row has not arrived yet. The not-found effect above
  // is already heading back if it never does.
  if (editing && !seeded) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-sm text-muted-foreground">Loading labels...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView className="flex-1 bg-background">
      {/* Sheet bodies draw their own header: this route registers with
          SHEET_OPTIONS, whose `headerShown: false` leaves the native chrome
          to the grabber. */}
      <View className="px-4 pt-4 pb-3">
        <Text className="text-base font-semibold text-foreground">
          {label ? "Edit label" : "New label"}
        </Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pb-6 gap-4"
        keyboardShouldPersistTaps="handled"
      >
        <Field label="Name">
          <TextField
            value={name}
            onChangeText={setName}
            placeholder="e.g. Bug"
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={MAX_NAME_LENGTH}
            returnKeyType="next"
            editable={!busy}
          />
        </Field>

        <Field label="Description">
          <AutosizeTextArea
            value={description}
            onChangeText={setDescription}
            placeholder="Describe when this label should be used"
            className="bg-secondary/50 rounded-md px-3 py-2"
            minHeight={80}
            editable={!busy}
          />
        </Field>

        <Field label="Color">
          <View className="flex-row flex-wrap">
            {LABEL_COLOR_PRESETS.map((preset) => {
              const selected = preset === color;
              return (
                <View key={preset} className="w-1/5 items-center py-1">
                  <Pressable
                    onPress={() => {
                      setColor(preset);
                      setHex(preset);
                    }}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={preset}
                    accessibilityState={{ selected }}
                    className={cn(
                      "size-8 rounded-full items-center justify-center",
                      selected && "border-2 border-foreground",
                    )}
                    style={{ backgroundColor: preset }}
                  >
                    {selected ? (
                      <Ionicons name="checkmark" size={16} color="#ffffff" />
                    ) : null}
                  </Pressable>
                </View>
              );
            })}
          </View>
          <TextField
            value={hex}
            onChangeText={onHexChange}
            placeholder="#3b82f6"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={7}
            invalid={normalizeLabelColor(hex) === null}
            editable={!busy}
            className="mt-2"
          />
        </Field>

        <Button onPress={onSave} disabled={!canSave}>
          <Text>{saving ? "Saving..." : "Save label"}</Text>
        </Button>

        {label ? (
          <Button variant="destructive" onPress={onDelete} disabled={busy}>
            <Text>Delete label</Text>
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
