/**
 * What a session-title edit should send, and when it should send nothing.
 *
 * Mirrors web's chat session rename (`packages/views/chat/components/
 * session-rename-input.tsx` + `chat-session-header.tsx#commitRename`): the
 * value is trimmed, an empty result is dropped (the server has no
 * "unnamed" state to fall back to, so committing it would blank the row),
 * and an unchanged title is dropped too — a no-op PATCH would still bump
 * `updated_at` and reorder the session list under the user's finger.
 *
 * The length cap matches the input's `maxLength` (web uses 200). Paste on
 * Android can still deliver more than the attribute allows, so the committed
 * value is clamped rather than trusted.
 */
export const CHAT_SESSION_TITLE_MAX_LENGTH = 200;

/** The title to PATCH, or `null` when the edit changes nothing. */
export function resolveChatSessionRename(
  raw: string,
  currentTitle: string,
): string | null {
  const trimmed = raw.trim().slice(0, CHAT_SESSION_TITLE_MAX_LENGTH);
  if (!trimmed) return null;
  if (trimmed === currentTitle) return null;
  return trimmed;
}
