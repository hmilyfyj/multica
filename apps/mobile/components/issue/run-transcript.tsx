/**
 * Run transcript — the timeline body of the run-detail sheet
 * (`app/(app)/[workspace]/issue/[id]/runs/[taskId].tsx`) and, in `compact`
 * density, of the steps fold on a run row.
 *
 * Renders every kind the daemon emits, in `seq` order (see
 * `lib/run-transcript.ts` for the mapping): `thinking` and `text` collapse to
 * a preview before expanding, `tool_use` shows the one argument worth reading
 * and expands to the raw params, `tool_result` previews the output and expands
 * to the (display-clipped) body, `error` is a red row. Web's dialog shows the
 * same five kinds; the difference is the window below.
 *
 * "Show earlier steps" — web puts this on the inline run row
 * (`inline-comment-run.tsx`, +12 per tap over an in-memory list) and renders
 * the whole transcript in its dialog. Mobile has no server pagination for task
 * messages, so every surface here loads the full run and reveals the newest
 * `RUN_TRANSCRIPT_PAGE_SIZE` rows, widening by a page per tap. The window is
 * about how much this screen renders, not about what it fetches.
 *
 * List engine: FlashList v2 in full density, same `maintainVisibleContentPosition`
 * pair as the chat list — the reader follows new steps while sitting at the
 * bottom, and keeps their place once they scroll back up. The compact variant
 * maps a plain `View` instead: it is mounted inside the runs sheet's
 * `ScrollView`, and a virtualised list nested in a plain scroll view warns and
 * costs more than the windowed rows it would manage.
 */
import { useState } from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { Text } from "@/components/ui/text";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Markdown } from "@/lib/markdown";
import { cn } from "@/lib/utils";
import {
  RUN_TRANSCRIPT_PAGE_SIZE,
  isTranscriptOutputTruncated,
  runEntryInputText,
  runEntryTitle,
  runEntryToolSummary,
  transcriptPreview,
  transcriptWindow,
  type RunTranscriptEntry,
} from "@/lib/run-transcript";

/** Display clip for an expanded tool result. Web clips at the same size and
 *  says so; the source-side truncation flag is separate and stays visible. */
const OUTPUT_DISPLAY_CLIP = 4000;

const MUTED = "#71717a";
const FAINT = "#a1a1aa";
const DANGER = "#dc2626";

interface Props {
  entries: RunTranscriptEntry[];
  /** The owning task is still running — new rows may appear below. */
  isStreaming?: boolean;
  /** Inline density for the run row's steps fold. */
  compact?: boolean;
}

export function RunTranscript({
  entries,
  isStreaming = false,
  compact = false,
}: Props) {
  const [visibleCount, setVisibleCount] = useState(RUN_TRANSCRIPT_PAGE_SIZE);
  const { start, hiddenCount } = transcriptWindow(entries.length, visibleCount);

  if (entries.length === 0) {
    return (
      <Text
        className={cn(
          "text-xs text-muted-foreground",
          compact ? "py-0.5" : "px-1 py-2",
        )}
      >
        {isStreaming
          ? "Waiting for the agent's first step…"
          : "No steps recorded for this run."}
      </Text>
    );
  }

  const visible = entries.slice(start);
  const control = (
    <View className={compact ? "pb-1" : "pb-2"}>
      {hiddenCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Show ${hiddenCount} earlier steps`}
          onPress={() =>
            setVisibleCount((count) => count + RUN_TRANSCRIPT_PAGE_SIZE)
          }
          className="flex-row items-center gap-1 py-1 active:opacity-70"
        >
          <Ionicons name="chevron-up" size={12} color={MUTED} />
          <Text className="text-xs text-muted-foreground">
            Show {hiddenCount} earlier step{hiddenCount === 1 ? "" : "s"}
          </Text>
        </Pressable>
      ) : null}
      <Text className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {entries.length === 1 ? "1 step" : `${entries.length} steps`}
        {isStreaming ? " · live" : ""}
      </Text>
    </View>
  );

  if (compact) {
    return (
      <View className="rounded-lg border border-border bg-muted/20 px-2 py-1.5">
        {control}
        <View className="gap-0.5">
          {visible.map((entry) => (
            <TranscriptRow key={entry.key} entry={entry} compact />
          ))}
        </View>
      </View>
    );
  }

  return (
    <FlashList
      data={visible}
      keyExtractor={(entry) => entry.key}
      renderItem={({ item }) => <TranscriptRow entry={item} />}
      ListHeaderComponent={control}
      contentContainerStyle={{ paddingBottom: 24 }}
      // Follow new steps while the reader sits at the bottom; leave their
      // position alone the moment they scroll back up.
      maintainVisibleContentPosition={{
        autoscrollToBottomThreshold: 0.2,
        startRenderingFromBottom: true,
      }}
      keyboardShouldPersistTaps="handled"
    />
  );
}

function TranscriptRow({
  entry,
  compact = false,
}: {
  entry: RunTranscriptEntry;
  compact?: boolean;
}) {
  switch (entry.kind) {
    case "thinking":
      return <ThinkingRow entry={entry} compact={compact} />;
    case "text":
      return <TextRow entry={entry} compact={compact} />;
    case "tool_use":
      return <ToolCallRow entry={entry} />;
    case "tool_result":
      return <ToolResultRow entry={entry} />;
    case "error":
      return <ErrorRow entry={entry} />;
  }
}

/** Shared collapsed row: leading glyph + label + one-line summary, wrapped in
 *  a `Collapsible` when the row has something to expand into. Callers choose
 *  the glyph the way `chat-timeline.tsx` does — a bulb for thinking, a chevron
 *  for the tool rows that open — so a transcript reads the same in both
 *  surfaces. */
function DisclosureRow({
  entry,
  icon,
  iconColor = MUTED,
  summary,
  summaryClassName = "text-muted-foreground",
  expandable,
  children,
}: {
  entry: RunTranscriptEntry;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  iconColor?: string;
  summary: string;
  summaryClassName?: string;
  expandable: boolean;
  children: React.ReactNode;
}) {
  const trigger = (
    <View className="flex-row items-start gap-1.5 py-0.5">
      <Ionicons name={icon} size={12} color={iconColor} style={{ marginTop: 2 }} />
      <Text className="flex-1 text-xs" numberOfLines={2}>
        <Text className="text-xs font-medium text-foreground">
          {runEntryTitle(entry)}
        </Text>
        {summary ? (
          <Text className={cn("text-xs", summaryClassName)}> {summary}</Text>
        ) : null}
      </Text>
    </View>
  );

  if (!expandable) return trigger;

  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Pressable accessibilityRole="button" className="active:opacity-70">
          {trigger}
        </Pressable>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <View className="ml-4 rounded-xs bg-muted/40 px-2 py-1.5">{children}</View>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ThinkingRow({
  entry,
  compact,
}: {
  entry: RunTranscriptEntry;
  compact: boolean;
}) {
  const text = entry.content ?? "";
  if (!text) return null;
  // The inline fold has no room to expand, so it caps the preview instead.
  if (compact) {
    return (
      <View className="flex-row items-start gap-1.5 py-0.5">
        <Ionicons
          name="bulb-outline"
          size={12}
          color={FAINT}
          style={{ marginTop: 2 }}
        />
        <Text className="flex-1 text-xs italic text-muted-foreground" numberOfLines={2}>
          {transcriptPreview(text, 160)}
        </Text>
      </View>
    );
  }
  return (
    <DisclosureRow
      entry={entry}
      icon="bulb-outline"
      iconColor={FAINT}
      summary={transcriptPreview(text, 100)}
      summaryClassName="italic text-muted-foreground"
      expandable
    >
      <Text className="text-xs italic text-muted-foreground">{text}</Text>
    </DisclosureRow>
  );
}

function TextRow({
  entry,
  compact,
}: {
  entry: RunTranscriptEntry;
  compact: boolean;
}) {
  const text = entry.content ?? "";
  if (!text.trim()) return null;
  if (compact) {
    return (
      <Text className="text-xs text-foreground" numberOfLines={3}>
        {transcriptPreview(text, 240)}
      </Text>
    );
  }
  // The agent's own words are the reason to open a transcript; render them as
  // prose rather than as another collapsed step.
  return (
    <View className="py-1">
      <Markdown content={text} compact />
    </View>
  );
}

function ToolCallRow({ entry }: { entry: RunTranscriptEntry }) {
  const summary = runEntryToolSummary(entry);
  const inputText = runEntryInputText(entry);
  if (!inputText) {
    return (
      <View className="flex-row items-center gap-1.5 py-0.5">
        <View style={{ width: 12 }} />
        <Text className="text-xs font-medium text-foreground">
          {runEntryTitle(entry)}
        </Text>
        {summary ? (
          <Text className="flex-1 text-xs text-muted-foreground" numberOfLines={1}>
            {summary}
          </Text>
        ) : null}
      </View>
    );
  }
  return (
    <DisclosureRow
      entry={entry}
      icon="chevron-forward"
      summary={summary}
      expandable
    >
      <Text className="text-xs text-muted-foreground">{inputText}</Text>
    </DisclosureRow>
  );
}

function ToolResultRow({ entry }: { entry: RunTranscriptEntry }) {
  const output = entry.output ?? "";
  if (!output) return null;
  const clipped =
    output.length > OUTPUT_DISPLAY_CLIP
      ? `${output.slice(0, OUTPUT_DISPLAY_CLIP)}\n…(truncated)`
      : output;
  const sourceTruncated = isTranscriptOutputTruncated(entry);

  return (
    <DisclosureRow
      entry={entry}
      icon="chevron-forward"
      summary={transcriptPreview(output, 100)}
      summaryClassName="text-muted-foreground/80"
      expandable
    >
      <Text className="text-xs text-muted-foreground">{clipped}</Text>
      {sourceTruncated ? (
        <Text className="mt-1 text-[11px] text-muted-foreground/80">
          Output was truncated when recorded — the rest was never uploaded.
        </Text>
      ) : null}
    </DisclosureRow>
  );
}

function ErrorRow({ entry }: { entry: RunTranscriptEntry }) {
  return (
    <View className="flex-row items-start gap-1.5 py-0.5">
      <Ionicons
        name="alert-circle"
        size={12}
        color={DANGER}
        style={{ marginTop: 2 }}
      />
      <Text className="flex-1 text-xs text-destructive" numberOfLines={4}>
        {entry.content}
      </Text>
    </View>
  );
}
