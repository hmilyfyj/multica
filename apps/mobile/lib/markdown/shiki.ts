/**
 * Shiki syntax highlighter for code blocks. Web↔mobile color parity is the
 * goal — same engine (Shiki), same themes (`github-light` / `github-dark`),
 * different surface (mobile renders into RN `<Text>` runs instead of HTML).
 *
 * Architecture:
 *   - One singleton `HighlighterCore` per app process (Shiki's docs are
 *     emphatic: never instantiate per component). Lazy-initialized; the
 *     first highlight() call triggers init, subsequent calls reuse the
 *     same Promise.
 *   - Native engine via `react-native-shiki-engine` (JSI + Oniguruma C++).
 *     Requires the New Architecture, which Multica mobile already runs on.
 *   - Top 12 languages are pre-registered at init for an AI/dev-tooling
 *     surface (TS/JS/TSX/JSX/Python/Go/Rust/Bash/JSON/YAML/SQL/Markdown).
 *     Unknown languages return `null` from highlight() so the caller
 *     degrades to plain monospace text — never crashes.
 *
 * Boot path:
 *   `prewarmHighlighter()` from app/_layout.tsx fires the init promise
 *   during app start, so by the time the user opens an issue with a code
 *   block, the highlighter is usually ready and there's no first-paint
 *   "plain → highlighted" flash.
 *
 * Lifecycle (Android):
 *   The invariant is "foreground ⟹ ready, background ⟹ released". Going to the
 *   background releases synchronously (a delay is not an option — see
 *   `attachMemoryPressureHandler`); returning to the foreground re-arms. iOS
 *   keeps the instance resident — nothing here runs there.
 */
import {
  createHighlighterCore,
  type HighlighterCore,
  type ThemedToken,
} from "@shikijs/core";
import { AppState, Platform, type AppStateStatus } from "react-native";
import {
  createNativeEngine,
  isNativeEngineAvailable,
} from "react-native-shiki-engine";

// Themes — same JSON as web's packages/ui/markdown/CodeBlock.tsx so the
// resulting palette is byte-identical.
import githubLight from "@shikijs/themes/github-light";
import githubDark from "@shikijs/themes/github-dark";

// Languages — pre-load top 12. Bundle cost ~150-200 KB JSON, parsed once
// at init. Adding a language: import here, append to LANGS, add to
// KNOWN_LANGS.
import bash from "@shikijs/langs/bash";
import go from "@shikijs/langs/go";
import javascript from "@shikijs/langs/javascript";
import json from "@shikijs/langs/json";
import jsx from "@shikijs/langs/jsx";
import markdown from "@shikijs/langs/markdown";
import python from "@shikijs/langs/python";
import rust from "@shikijs/langs/rust";
import sql from "@shikijs/langs/sql";
import tsx from "@shikijs/langs/tsx";
import typescript from "@shikijs/langs/typescript";
import yaml from "@shikijs/langs/yaml";

const LANGS = [
  bash, go, javascript, json, jsx, markdown,
  python, rust, sql, tsx, typescript, yaml,
];

// Common aliases users type in fence info strings — `ts` → `typescript`,
// `sh` / `zsh` → `bash`, etc. Mirrors the alias map web uses
// (packages/ui/markdown/CodeBlock.tsx).
const LANG_ALIASES: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  py: "python",
  rs: "rust",
  sh: "bash",
  zsh: "bash",
  shell: "bash",
  yml: "yaml",
  md: "markdown",
};

const KNOWN_LANGS: ReadonlySet<string> = new Set([
  "bash", "go", "javascript", "json", "jsx", "markdown",
  "python", "rust", "sql", "tsx", "typescript", "yaml",
]);

export const SHIKI_THEME_LIGHT = "github-light";
export const SHIKI_THEME_DARK = "github-dark";

// Cached promise — null on cold start, set on first init call.
let highlighterPromise: Promise<HighlighterCore | null> | null = null;

function initHighlighter(): Promise<HighlighterCore | null> {
  if (__DEV__) {
    console.log("[shiki] initializing highlighter");
  }
  if (!isNativeEngineAvailable()) {
    // Native module didn't link — usually means dev client wasn't rebuilt
    // after install. Fall back silently to plain text so the app still
    // ships content; the warning is for the developer.
    console.warn(
      "[shiki] react-native-shiki-engine native module unavailable — code blocks will render plain. Did you rebuild the dev client?",
    );
    return Promise.resolve(null);
  }
  return createHighlighterCore({
    themes: [githubLight, githubDark],
    langs: LANGS,
    engine: createNativeEngine(),
  }).catch((err) => {
    console.warn("[shiki] highlighter init failed:", err);
    return null;
  });
}

/** Kick off the singleton init. Call once at app boot. Idempotent: repeat
 *  calls reuse the cached promise.
 *
 *  Also arms the Android background-release listener; both halves are
 *  idempotent, so calling this more than once is harmless. Re-calling after a
 *  release is how the foreground half of the lifecycle invariant is restored. */
export function prewarmHighlighter(): void {
  highlighterPromise ??= initHighlighter();
  attachMemoryPressureHandler();
}

// Guards against arming the AppState listener twice.
let memoryPressureHandlerAttached = false;

/**
 * Drop the singleton highlighter and everything it holds, so the native
 * Oniguruma pattern cache goes with it. The next `highlight()` re-initializes
 * lazily.
 *
 * Why releasing the instance is the only lever available: `react-native-shiki-
 * engine` exposes no trim API — `createNativeEngine` takes `maxCacheSize` at
 * creation and nothing else — and the C++ side has no memory-warning hook, so
 * each grammar's pattern LRU (capped at 50 MB, `CACHE_MEMORY_LIMIT` in
 * `cpp/onig_regex.h`) is only reclaimed when its scanner is destroyed.
 * `dispose()` does reach it: Shiki's registry walks every loaded grammar →
 * `CompiledRuleSet.dispose()` → the engine's `dispose()` → TurboModule
 * `destroyScanner` → `free_scanner()`, which `onig_free()`s every compiled
 * regex.
 *
 * The dispose itself runs in the `.then` continuation, i.e. as a microtask of
 * the AppState callback — microtasks drain before the JS thread goes idle, so
 * it completes inside the background transition rather than waiting for the
 * app to come back.
 *
 * Race: a `highlight()` that was already awaiting the promise dropped here can
 * still hand the disposed instance to `codeToTokensBase`, which throws Shiki's
 * "instance has been disposed". That throw is swallowed by `highlight()`'s
 * catch and degrades to plain text, so the worst case is one code block
 * blinking to plain — never a crash.
 *
 * The `__DEV__` line is the observable hook for this path: release and re-init
 * are otherwise invisible from outside the process (neither the native cache
 * nor Android's LMK behaviour has a public counter).
 */
export function releaseHighlighter(): void {
  const pending = highlighterPromise;
  highlighterPromise = null;
  if (!pending) return;
  void pending
    .then((hl) => {
      hl?.dispose();
      if (__DEV__) {
        console.log("[shiki] released highlighter (native scanners destroyed)");
      }
    })
    .catch(() => {
      // An init that failed has nothing to dispose.
    });
}

/**
 * Android-only: release the highlighter when the app goes to the background,
 * and re-arm when it comes back.
 *
 * The two platforms lose this memory in different ways. iOS gets an explicit
 * memory warning and is rarely killed for background footprint, so keeping the
 * instance resident preserves what it has always done (code blocks are already
 * colored the instant you come back). Android publishes no JS-visible memory
 * warning at all — the AppState background transition is the only signal we
 * get, and background footprint is exactly what the LMK ranks the process by,
 * for as long as the user leaves the app parked.
 *
 * Why the release cannot be deferred behind a `setTimeout` grace period: RN
 * pauses JS timers whenever the host is paused. `JavaTimerManager.onHostPause`
 * sets `isPaused`, and the timer queue is only advanced from a Choreographer
 * frame callback, so a timer scheduled during the background transition does
 * not fire until the app resumes — at which point it is too late to matter.
 * Measured on Medium_Phone_API_35: a 2 s deferred release never ran during
 * 10 s in the background, and the `active` handler cancelled it on resume.
 * The release therefore happens synchronously on the transition.
 *
 * That leaves the transient background → active pair an intent-driven activity
 * transition emits (a deep link, a notification tap; measured at 165 ms) to
 * release and immediately re-acquire. That is deliberate: `prewarmHighlighter`
 * on the `active` edge restores the invariant, so the cost is one re-init on
 * the transition instead of a permanently released highlighter at boot.
 *
 * Costs nothing visible: already-rendered blocks keep the token runs they hold
 * in component state, and blocks opened after a resume find a highlighter that
 * the `active` edge already re-armed.
 */
export function attachMemoryPressureHandler(): void {
  if (memoryPressureHandlerAttached || Platform.OS !== "android") return;
  memoryPressureHandlerAttached = true;
  AppState.addEventListener("change", (status: AppStateStatus) => {
    if (status === "background") {
      releaseHighlighter();
      return;
    }
    if (status === "active") {
      // No-op when the highlighter survived (a plain `active` event) — an init
      // only when the background edge above actually released it.
      prewarmHighlighter();
    }
  });
}

/** Resolve a fence info string ("ts", "JavaScript ", "py") to a known
 *  Shiki language id, or null if we don't have a grammar for it. Caller
 *  uses null to degrade to plain text. */
export function resolveLang(input: string | undefined): string | null {
  if (!input) return null;
  const lower = input.toLowerCase().trim();
  const resolved = LANG_ALIASES[lower] ?? lower;
  return KNOWN_LANGS.has(resolved) ? resolved : null;
}

export interface HighlightedToken {
  content: string;
  /** Hex color from the active Shiki theme. May be undefined for whitespace
   *  or default-colored tokens — caller leaves them at the inherited color. */
  color?: string;
}

export interface HighlightedLine {
  tokens: HighlightedToken[];
}

/** Highlight `code` and return token runs grouped by line. Returns null
 *  when the engine is unavailable, the language is unknown, or any error
 *  occurs — caller is expected to fall back to plain monospace. */
export async function highlight(
  code: string,
  lang: string,
  theme: string,
): Promise<HighlightedLine[] | null> {
  highlighterPromise ??= initHighlighter();
  const hl = await highlighterPromise;
  if (!hl) return null;
  try {
    const tokens = hl.codeToTokensBase(code, { lang, theme });
    return tokens.map((line: ThemedToken[]) => ({
      tokens: line.map((t) => ({ content: t.content, color: t.color })),
    }));
  } catch (err) {
    console.warn(`[shiki] highlight failed for lang=${lang}:`, err);
    return null;
  }
}
