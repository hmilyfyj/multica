/**
 * Chat session-switch sheet — presented as a formSheet by the parent Stack.
 * Reads the session list from the chat cache and writes the user's pick
 * through a shared "active session" store so the chat tab picks it up on
 * dismiss.
 *
 * Rename lives here too, on the row's own title: long-press a row for
 * `Rename` / `Delete` (the mobile equivalent of web's ⋯ menu on the session
 * header, which offers rename + archive/delete), and `Rename` turns the row
 * into an inline input — web's rename is inline as well
 * (`session-rename-input.tsx`), and a text prompt has no cross-platform
 * native primitive (`Alert.prompt` is iOS-only). The input is compact and
 * commits on submit or blur; `lib/chat-session-rename.ts` decides what a
 * commit is worth sending.
 *
 * Why a tiny dedicated store: the chat tab's `activeSessionId` used to live
 * as a `useState` inside `chat.tsx`, but now that session picking happens
 * on a separate route screen, we need a cross-screen channel. Same minimum
 * pattern as `useNewIssueDraftStore` for the new-issue form.
 */
import { useRef, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { ChatSession } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { KeyboardAvoidingView } from "@/components/ui/keyboard-avoiding-view";
import { showActionSheet } from "@/components/ui/action-sheet";
import { chatSessionsOptions } from "@/data/queries/chat";
import {
  useDeleteChatSession,
  useRenameChatSession,
} from "@/data/mutations/chat";
import { useChatSessionPickerStore } from "@/data/stores/chat-session-picker-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  CHAT_SESSION_TITLE_MAX_LENGTH,
  resolveChatSessionRename,
} from "@/lib/chat-session-rename";
import { cn } from "@/lib/utils";
import { chatSessionDisplayTitle } from "@/lib/chat-session-title";

/** Row actions, in sheet order. The indices below are the contract with
 *  `showActionSheet` — the callback hands back a position, not a label. */
const RENAME_ACTION = 0;
const DELETE_ACTION = 1;
const CANCEL_ACTION = 2;

export default function ChatSessionsRoute() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: sessions = [] } = useQuery(chatSessionsOptions(wsId));
  const activeSessionId = useChatSessionPickerStore((s) => s.activeSessionId);
  const requestSelect = useChatSessionPickerStore((s) => s.requestSelect);
  const deleteSession = useDeleteChatSession();
  const renameSession = useRenameChatSession();

  const scrollRef = useRef<ScrollView>(null);
  // Row offsets inside the list content, so entering rename can bring the row
  // being edited to the top of the visible area — the sheet is at most 60% of
  // the screen and the keyboard takes another chunk of it, and Android (edge
  // to edge, targetSdk 36) no longer scrolls a focused field into view on its
  // own. See .trellis/spec/mobile/frontend/android-platform.md.
  const rowOffsets = useRef(new Map<string, number>());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  // One commit per editing session: submit and blur both fire on a single
  // Enter, and the unmount that follows the first commit must not send a
  // second PATCH.
  const settledRef = useRef(false);

  const confirmDelete = (session: ChatSession) => {
    Alert.alert(
      "Delete this chat?",
      chatSessionDisplayTitle(session.title),
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deleteSession.mutate(session.id);
            // If we just deleted the active one, the chat tab clears its
            // local activeSessionId via the picker-store request.
            if (session.id === activeSessionId) {
              requestSelect(null);
            }
          },
        },
      ],
      { cancelable: true },
    );
  };

  const startRename = (session: ChatSession) => {
    settledRef.current = false;
    setDraftTitle(session.title ?? "");
    setRenamingId(session.id);
    const y = rowOffsets.current.get(session.id);
    if (y !== undefined) {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
    }
  };

  const commitRename = (session: ChatSession) => {
    if (settledRef.current) return;
    settledRef.current = true;
    setRenamingId(null);
    const title = resolveChatSessionRename(draftTitle, session.title ?? "");
    if (!title) return;
    renameSession.mutate({ sessionId: session.id, title });
  };

  const showRowActions = (session: ChatSession) => {
    Haptics.selectionAsync().catch(() => {});
    showActionSheet(
      {
        options: ["Rename", "Delete", "Cancel"],
        cancelButtonIndex: CANCEL_ACTION,
        destructiveButtonIndex: DELETE_ACTION,
        title: chatSessionDisplayTitle(session.title),
      },
      (index) => {
        if (index === RENAME_ACTION) startRename(session);
        else if (index === DELETE_ACTION) confirmDelete(session);
      },
    );
  };

  return (
    <KeyboardAvoidingView className="flex-1">
      <View className="px-4 pt-4 pb-3">
        <Text className="text-base font-semibold text-foreground">Chats</Text>
      </View>
      <ScrollView
        ref={scrollRef}
        className="flex-1"
        showsVerticalScrollIndicator={false}
        // A tap on another row while the rename input is focused has to reach
        // that row (committing the edit on the way) instead of being eaten by
        // the keyboard dismissal.
        keyboardShouldPersistTaps="handled"
      >
        {sessions.length === 0 ? (
          <View className="px-4 py-8">
            <Text className="text-sm text-muted-foreground text-center">
              No chats yet.
            </Text>
          </View>
        ) : (
          sessions.map((session) => {
            const selected = session.id === activeSessionId;
            const archived = session.status === "archived";
            const editing = renamingId === session.id;
            return (
              <Pressable
                key={session.id}
                onPress={() => {
                  if (editing) return;
                  requestSelect(session.id);
                  router.back();
                }}
                onLongPress={() => {
                  if (editing) return;
                  showRowActions(session);
                }}
                onLayout={(e) => {
                  rowOffsets.current.set(
                    session.id,
                    e.nativeEvent.layout.y,
                  );
                }}
                className={cn(
                  "flex-row items-center gap-3 px-4 py-3 active:bg-secondary",
                  selected && "bg-secondary/60",
                )}
              >
                <View
                  className={cn(
                    "h-2 w-2 rounded-full",
                    session.has_unread ? "bg-primary" : "bg-transparent",
                  )}
                />
                <ActorAvatar
                  type="agent"
                  id={session.agent_id}
                  size={32}
                  showPresence
                />
                {editing ? (
                  <TextField
                    value={draftTitle}
                    onChangeText={setDraftTitle}
                    autoFocus
                    selectTextOnFocus
                    maxLength={CHAT_SESSION_TITLE_MAX_LENGTH}
                    returnKeyType="done"
                    accessibilityLabel="Chat title"
                    onSubmitEditing={() => commitRename(session)}
                    onBlur={() => commitRename(session)}
                    className="flex-1 h-9 px-2"
                  />
                ) : (
                  <View className="flex-1">
                    <Text
                      className={cn(
                        "text-sm text-foreground",
                        session.has_unread && "font-semibold",
                      )}
                      numberOfLines={1}
                    >
                      {chatSessionDisplayTitle(session.title)}
                    </Text>
                    {archived ? (
                      <Text className="text-xs text-muted-foreground mt-0.5">
                        archived
                      </Text>
                    ) : null}
                  </View>
                )}
                {selected && !editing ? (
                  <Text className="text-sm text-primary font-semibold">✓</Text>
                ) : null}
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
