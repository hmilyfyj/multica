/**
 * Label colour helpers — mobile's copy of the palette web renders first
 * (`COLOR_PICKER_PRESETS` in packages/views/common/color-picker.tsx) plus the
 * hex normalisation the label editor needs.
 *
 * Mobile ships the palette and a hex field rather than web's SV/hue picker:
 * an area picker needs continuous gesture handling RN does not give for free,
 * and the ten presets are the colours the product actually uses. What must
 * NOT diverge is the palette itself — the same list in the same order is what
 * makes label colours look consistent across clients.
 */
import type { Label } from "@multica/core/types";

/** Same values, same order as web's `COLOR_PICKER_PRESETS`. */
export const LABEL_COLOR_PRESETS = [
  "#6b7280",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
] as const;

/** The colour a brand-new label starts on — web's `EMPTY_DRAFT.color`. */
export const DEFAULT_LABEL_COLOR = "#3b82f6";

/**
 * Canonicalise a user-typed colour into the `#rrggbb` the server stores, or
 * null while it is not a colour yet.
 *
 * A bare `3b82f6` is accepted and everything is lowercased, because the
 * server does both. Anything that is not exactly six hex digits is rejected:
 * the server's regex is strict on purpose — a label chip renders the value
 * straight into `backgroundColor`, so arbitrary CSS here would be an
 * injection surface.
 */
export function normalizeLabelColor(raw: string): string | null {
  const value = raw.trim().replace(/^#/, "").toLowerCase();
  return /^[0-9a-f]{6}$/.test(value) ? `#${value}` : null;
}

/**
 * The colour a row paints: the label's own `#rrggbb`, falling back to the
 * palette's neutral when the catalogue row predates the field or carries
 * something the client cannot render. Keeps a chip visible instead of
 * transparent.
 */
export function labelColorOf(label: Pick<Label, "color">): string {
  return normalizeLabelColor(label.color) ?? LABEL_COLOR_PRESETS[0];
}
