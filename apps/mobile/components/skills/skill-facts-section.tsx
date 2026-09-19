/**
 * Skill-detail facts — the read-only identity rows, in the iOS Settings shape
 * the other detail screens use.
 *
 * Source is the row that matters most here: a skill's provenance lives only in
 * `config.origin`, and this is where a reader finds out whether a skill is
 * maintained in the app or mirrored from GitHub / ClawHub / a local runtime
 * (see `lib/skill-origin.ts`). Web shows the same set in SkillIdentity plus its
 * Overview tab's properties.
 *
 * "Added by" resolves from the member list already in the cache.
 */
import { View } from "react-native";
import type { SkillDetail } from "@/data/schemas";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { useActorLookup } from "@/data/use-actor-name";
import { useSkillOriginLabel } from "@/lib/use-skill-origin-label";
import { formatFileSize, skillFileList } from "@/lib/skill-origin";

interface Props {
  detail: SkillDetail;
}

export function SkillFactsSection({ detail }: Props) {
  const sourceLabel = useSkillOriginLabel(detail);
  const { getName, getAvatarUrl } = useActorLookup();
  const creatorName = detail.created_by
    ? getName("member", detail.created_by)
    : null;
  const files = skillFileList(detail);

  return (
    <View className="gap-2">
      <Text className="px-4 text-xs font-medium uppercase text-muted-foreground">
        Details
      </Text>
      <View className="border-y border-border bg-background">
        <Row label="Source" value={<Value>{sourceLabel}</Value>} />
        <Separator />
        <Row
          label="Added by"
          value={
            detail.created_by && creatorName ? (
              <View className="flex-row items-center gap-2">
                <ActorAvatar
                  type="member"
                  id={detail.created_by}
                  name={creatorName}
                  avatarUrl={getAvatarUrl("member", detail.created_by)}
                  size={20}
                />
                <Text className="text-sm text-foreground" numberOfLines={1}>
                  {creatorName}
                </Text>
              </View>
            ) : (
              <Value>—</Value>
            )
          }
        />
        <Separator />
        <Row
          label="Files"
          value={
            <Value>
              {`${files.length} · ${formatFileSize(
                files.reduce((sum, file) => sum + (file.size ?? 0), 0),
              )}`}
            </Value>
          }
        />
        <Separator />
        <Row label="Created" value={<Value>{formatDate(detail.created_at)}</Value>} />
        <Separator />
        <Row label="Updated" value={<Value>{formatDate(detail.updated_at)}</Value>} />
      </View>
    </View>
  );
}

function Value({ children }: { children: React.ReactNode }) {
  return (
    <Text className="text-sm text-foreground" numberOfLines={1}>
      {children}
    </Text>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View className="flex-row items-center justify-between gap-4 px-4 py-3">
      <Text className="text-sm text-foreground">{label}</Text>
      <View className="flex-1 items-end">{value}</View>
    </View>
  );
}

function Separator() {
  return <View className="ml-4 h-px bg-border" />;
}
