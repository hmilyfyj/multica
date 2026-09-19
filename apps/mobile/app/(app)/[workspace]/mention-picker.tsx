/**
 * Workspace-level mention picker route — formSheet, opened from any
 * composer that has an `@` button (currently the issue-comment composer
 * and the chat composer).
 *
 * `?mode=` controls which sections render:
 *   - "comment" (default) — @all + People + Agents + Squads + Issues.
 *     The comment composer offers the full surface; mentions notify the
 *     mentioned actor.
 *   - "chat" — Issues only. Chat is user ↔ single agent, so member /
 *     agent / squad / @all mentions are noise (and would generate
 *     unintended notifications). Issues remain useful as "reference this
 *     ticket for the agent's context".
 *
 * Lives at workspace level (not nested under issue/[id]) because the chat
 * tab has no per-session route to nest under; making it workspace-level
 * keeps a single route file serving both contexts.
 *
 * The search bar is wired by `usePickerSearchBar` (iOS: the native header's
 * UISearchController registered in ./_layout.tsx; other platforms: the
 * shared `SearchField` above the list).
 */
import { useLocalSearchParams } from "expo-router";
import { MentionPickerBody } from "@/components/issue/pickers/mention-picker-body";
import { usePickerSearchBar } from "@/lib/use-picker-search-bar";

type Mode = "comment" | "chat";

export default function MentionPickerRoute() {
  const { mode: rawMode } = useLocalSearchParams<{ mode?: string }>();
  const mode: Mode = rawMode === "chat" ? "chat" : "comment";
  const placeholder =
    mode === "chat" ? "Reference an issue" : "Search people or issues";
  const { query, searchBar } = usePickerSearchBar(placeholder, {
    autoFocus: true,
  });
  return (
    <>
      {searchBar}
      <MentionPickerBody mode={mode} query={query} />
    </>
  );
}
