import { useQuery } from "@tanstack/react-query";
import type { SkillSummary } from "@multica/core/types";
import { runtimeDisplayName } from "@multica/core/runtimes";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { useWorkspaceStore } from "@/data/workspace-store";
import { readSkillOrigin, skillOriginLabel } from "@/lib/skill-origin";

/**
 * The source label for a skill, with a runtime-local origin resolved to its
 * runtime's name.
 *
 * A skill list row and the detail screen show the same label, and both need the
 * same lookup: `config.origin.runtime_id` → the runtime roster the presence dot
 * already keeps in cache (so this costs no request of its own). Web resolves it
 * the same way in `SourceCell`
 * (packages/views/skills/components/skills-page.tsx:316-376).
 */
export function useSkillOriginLabel(skill: SkillSummary): string {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));

  const origin = readSkillOrigin(skill);
  const runtime = origin.runtime_id
    ? runtimes.find((candidate) => candidate.id === origin.runtime_id)
    : undefined;

  return skillOriginLabel(origin, runtime ? runtimeDisplayName(runtime) : null);
}
