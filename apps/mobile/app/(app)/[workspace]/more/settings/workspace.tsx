/**
 * Workspace general settings — the mobile-feasible slice of web's
 * `workspace-tab.tsx` General section.
 *
 * Ported: logo, name, description, context, slug (read-only) and issue
 * prefix. Not ported, with the source behavior they preserve:
 *
 *   - Danger zone (leave workspace / delete workspace). Both are
 *     irreversible and read better on a desktop session than in a phone
 *     settings list; leaving them off keeps a mistap from costing a
 *     membership. Web keeps them in `workspace-tab.tsx`.
 *   - Debounced auto-save. Web saves on blur through `useAutoSave`; mobile
 *     uses the explicit Save button `profile.tsx` already established, which
 *     is what makes a failed PATCH visible instead of silent.
 *
 * Writes are owner/admin only — `PATCH /api/workspaces/{id}` sits in that
 * group server-side, so a plain member gets a read-only form and the same
 * one-line hint web shows.
 */
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useQuery } from "@tanstack/react-query";
import { showActionSheet } from "@/components/ui/action-sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { api, type FileAsset, type UpdateWorkspaceRequest } from "@/data/api";
import { useAuthStore } from "@/data/auth-store";
import { useUpdateWorkspace } from "@/data/mutations/workspaces";
import { memberListOptions } from "@/data/queries/members";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { useWorkspaceStore } from "@/data/workspace-store";

/** Same ceiling `profile.tsx` applies — a workspace logo is uploaded through
 *  the identical endpoint and has no reason to allow more. */
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

function initialsOf(name: string | undefined): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * Letters and digits only, uppercase, capped at 10 — the same guardrail web
 * applies in `workspace-tab.tsx`. The server uppercases and trims too; this
 * only keeps the field showing what will actually be persisted, so the user
 * never confirms a prefix change that is not the one they typed.
 */
function normalizePrefix(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
}

export default function WorkspaceSettingsScreen() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const user = useAuthStore((s) => s.user);
  const { data: workspaces } = useQuery(workspaceListOptions());
  const workspace = workspaces?.find((ws) => ws.id === wsId) ?? null;
  const { data: members } = useQuery(memberListOptions(wsId));
  const updateWorkspace = useUpdateWorkspace();

  const me = members?.find((m) => m.user_id === user?.id) ?? null;
  // `isFetched` gated, not just role-checked: until the member list lands
  // `me` is null and the form would flash read-only for an admin.
  const canManage = me?.role === "owner" || me?.role === "admin";

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [context, setContext] = useState("");
  const [issuePrefix, setIssuePrefix] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Resync only when the user switches workspace. Keying on the id (not the
  // object) keeps an avatar upload — which replaces the cached Workspace —
  // from wiping unsaved edits in the other fields.
  useEffect(() => {
    setName(workspace?.name ?? "");
    setDescription(workspace?.description ?? "");
    setContext(workspace?.context ?? "");
    setIssuePrefix(workspace?.issue_prefix ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed on id only, see above
  }, [workspace?.id]);

  const savedName = workspace?.name ?? "";
  const savedDescription = workspace?.description ?? "";
  const savedContext = workspace?.context ?? "";
  const savedPrefix = workspace?.issue_prefix ?? "";

  const normalizedPrefix = normalizePrefix(issuePrefix);
  const prefixInvalid = normalizedPrefix.length === 0;
  const trimmedName = name.trim();

  const dirty =
    !!workspace &&
    (trimmedName !== savedName ||
      description !== savedDescription ||
      context !== savedContext ||
      normalizedPrefix !== savedPrefix);

  const canSave = canManage && dirty && !saving && !!trimmedName && !prefixInvalid;

  const applySave = async (prefix: string) => {
    if (!workspace) return;
    // Sparse body: only what actually changed. That is also what keeps the
    // mutation from invalidating every cached issue on an ordinary rename —
    // it only does that when `issue_prefix` is present.
    const body: UpdateWorkspaceRequest = {};
    if (trimmedName !== savedName) body.name = trimmedName;
    if (description !== savedDescription) body.description = description;
    if (context !== savedContext) body.context = context;
    if (prefix !== savedPrefix) body.issue_prefix = prefix;
    if (Object.keys(body).length === 0) return;

    setSaving(true);
    try {
      await updateWorkspace.mutateAsync({ id: workspace.id, body });
    } catch (err) {
      Alert.alert(
        "Save failed",
        err instanceof Error ? err.message : "Failed to save workspace settings",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => {
    if (!canSave || !workspace) return;
    if (normalizedPrefix !== savedPrefix) {
      Alert.alert(
        "Change issue prefix?",
        `All issues will be renumbered from ${savedPrefix}-N to ${normalizedPrefix}-N. External references — pull request titles, branch names, links in docs and chat — that use ${savedPrefix}-N will stop resolving.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Change",
            style: "destructive",
            onPress: () => void applySave(normalizedPrefix),
          },
        ],
      );
      return;
    }
    void applySave(normalizedPrefix);
  };

  const uploadLogo = async (asset: ImagePicker.ImagePickerAsset) => {
    if (!workspace) return;
    if (asset.fileSize && asset.fileSize > MAX_LOGO_BYTES) {
      Alert.alert("Image too large", "Pick an image under 5 MB.");
      return;
    }
    const fileAsset: FileAsset = {
      uri: asset.uri,
      // expo-image-picker omits fileName for camera captures; fabricate one so
      // the multipart upload has a stable name.
      name: asset.fileName ?? `workspace-logo-${Date.now()}.jpg`,
      type: asset.mimeType ?? "image/jpeg",
    };

    setUploading(true);
    try {
      const attachment = await api.uploadFile(fileAsset);
      await updateWorkspace.mutateAsync({
        id: workspace.id,
        body: { avatar_url: attachment.url },
      });
    } catch (err) {
      Alert.alert(
        "Upload failed",
        err instanceof Error ? err.message : "Failed to upload workspace logo",
      );
    } finally {
      setUploading(false);
    }
  };

  const removeLogo = async () => {
    if (!workspace) return;
    setUploading(true);
    try {
      await updateWorkspace.mutateAsync({
        id: workspace.id,
        body: { avatar_url: "" },
      });
    } catch (err) {
      Alert.alert(
        "Remove failed",
        err instanceof Error ? err.message : "Failed to remove workspace logo",
      );
    } finally {
      setUploading(false);
    }
  };

  const handleLogoPick = () => {
    if (!workspace || !canManage) return;
    const hasLogo = !!workspace.avatar_url;
    const options = ["Take Photo", "Choose from Library", "Remove Logo", "Cancel"];
    const removeIndex = hasLogo ? 2 : -1;
    const cancelIndex = hasLogo ? 3 : 2;
    const visibleOptions = hasLogo ? options : options.filter((_, i) => i !== 2);

    showActionSheet(
      {
        options: visibleOptions,
        cancelButtonIndex: cancelIndex,
        destructiveButtonIndex: removeIndex >= 0 ? removeIndex : undefined,
      },
      async (index) => {
        if (index === cancelIndex) return;
        if (index === 0) await pickFromCamera();
        else if (index === 1) await pickFromLibrary();
        else if (index === removeIndex) await removeLogo();
      },
    );
  };

  const pickFromCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Permission needed",
        "Camera access is required to take a photo.",
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) await uploadLogo(result.assets[0]);
  };

  const pickFromLibrary = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) await uploadLogo(result.assets[0]);
  };

  if (!workspace) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-4 py-6 gap-6"
      keyboardShouldPersistTaps="handled"
    >
      <View className="items-center gap-3">
        <Pressable onPress={handleLogoPick} disabled={uploading || !canManage}>
          <Avatar alt={`${workspace.name} logo`} className="size-24">
            {workspace.avatar_url ? (
              <AvatarImage source={{ uri: workspace.avatar_url }} />
            ) : null}
            <AvatarFallback>
              <Text className="text-2xl font-semibold text-muted-foreground">
                {initialsOf(workspace.name)}
              </Text>
            </AvatarFallback>
          </Avatar>
        </Pressable>
        {uploading ? (
          <ActivityIndicator />
        ) : (
          <Text className="text-xs text-muted-foreground">
            {canManage ? "Tap to change logo" : "Workspace logo"}
          </Text>
        )}
      </View>

      <Separator />

      <View className="gap-4">
        <View>
          <Text className="text-xs text-muted-foreground mb-1.5">Name</Text>
          <TextField
            value={name}
            onChangeText={setName}
            placeholder="Workspace name"
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            editable={canManage}
          />
        </View>

        <View>
          <Text className="text-xs text-muted-foreground mb-1.5">
            Description
          </Text>
          <AutosizeTextArea
            value={description}
            onChangeText={setDescription}
            placeholder="What does this workspace focus on?"
            maxHeight={120}
            editable={canManage}
          />
        </View>

        <View>
          <Text className="text-xs text-muted-foreground mb-1.5">Context</Text>
          <AutosizeTextArea
            value={context}
            onChangeText={setContext}
            placeholder="Background information and context for AI agents working in this workspace"
            maxHeight={180}
            editable={canManage}
          />
        </View>

        <View>
          <Text className="text-xs text-muted-foreground mb-1.5">Slug</Text>
          <View className="rounded-md border border-border bg-muted px-3 py-2.5">
            <Text className="font-mono text-base text-muted-foreground">
              {`/${workspace.slug}`}
            </Text>
          </View>
          <Text className="text-xs text-muted-foreground mt-1.5">
            The slug identifies this workspace in URLs and can&apos;t be
            changed here.
          </Text>
        </View>

        <View>
          <Text className="text-xs text-muted-foreground mb-1.5">
            Issue prefix
          </Text>
          <TextField
            invalid={prefixInvalid}
            value={issuePrefix}
            onChangeText={(text) => setIssuePrefix(normalizePrefix(text))}
            placeholder={savedPrefix}
            autoCapitalize="characters"
            autoCorrect={false}
            spellCheck={false}
            maxLength={10}
            editable={canManage}
          />
          <Text className="text-xs text-muted-foreground mt-1.5">
            Used in issue numbers like{" "}
            {`${normalizedPrefix || savedPrefix}-123`}. Letters and digits
            only.
          </Text>
        </View>
      </View>

      {canManage ? null : (
        <Text className="text-xs text-muted-foreground">
          Only admins and owners can update workspace settings.
        </Text>
      )}

      {canManage ? (
        <Button onPress={handleSave} disabled={!canSave}>
          <Text>{saving ? "Saving…" : "Save"}</Text>
        </Button>
      ) : null}
    </ScrollView>
  );
}
