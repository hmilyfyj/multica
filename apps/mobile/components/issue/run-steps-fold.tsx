/**
 * Inline steps fold on a run row — the mobile minimum of web's
 * `inline-comment-run.tsx`: read a run's steps without leaving the Runs sheet.
 *
 * Web's version fetches the transcript when a *historical* run is expanded and
 * keeps it collapsed otherwise ("Historical, collapsed runs still don't fetch
 * transcripts"), which is what this mirrors: the transcript query and its
 * `task:message` subscription are mounted by a child that only exists while
 * the fold is open. A row that is never expanded costs no request and receives
 * no frames.
 *
 * The full surface stays the run-detail sheet — this one is deliberately read
 * -only and windowed (`RunTranscript compact`, newest page only, no Markdown),
 * because it renders inside a sheet that is already a scroll view.
 */
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "@/components/ui/text";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { RunTranscript } from "@/components/issue/run-transcript";
import { useRunTranscript } from "@/components/issue/use-run-transcript";

interface Props {
  taskId: string;
  /** Owning task is still running — drives the live hint in the fold. */
  isStreaming: boolean;
}

export function RunStepsFold({ taskId, isStreaming }: Props) {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Steps"
          className="self-start flex-row items-center gap-1 py-0.5 active:opacity-70"
        >
          <Ionicons name="chevron-forward" size={12} color="#71717a" />
          <Text className="text-xs text-muted-foreground">Steps</Text>
        </Pressable>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <View className="mt-1">
          <RunSteps taskId={taskId} isStreaming={isStreaming} />
        </View>
      </CollapsibleContent>
    </Collapsible>
  );
}

function RunSteps({ taskId, isStreaming }: Props) {
  const { entries, isLoading, isError } = useRunTranscript(taskId);

  if (isLoading) {
    return (
      <Text className="text-xs text-muted-foreground">Loading steps…</Text>
    );
  }
  if (isError) {
    return (
      <Text className="text-xs text-destructive">
        {"Couldn't load steps."}
      </Text>
    );
  }
  return (
    <RunTranscript entries={entries} isStreaming={isStreaming} compact />
  );
}
