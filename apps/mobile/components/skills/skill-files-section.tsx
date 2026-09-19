/**
 * Skill file list — read-only, in web's two-group shape: the main file
 * (SKILL.md, always present) then the supporting files counted by name
 * (packages/views/skills/components/skill-detail-page.tsx:564-757, locale keys
 * `detail.files.main` / `detail.files.supporting`).
 *
 * There is no file viewer here. Web's FilesTab opens a body in an editor; the
 * mobile view is read-only and the detail request is `?include=metadata`, which
 * carries sizes instead of bodies on purpose — a SKILL.md routinely runs
 * 50-200KB, so shipping every one of them to render a list would be megabytes
 * thrown away on arrival.
 */
import { View } from "react-native";
import type { SkillDetail } from "@/data/schemas";
import { Text } from "@/components/ui/text";
import { formatFileSize, SKILL_MD, skillFileList } from "@/lib/skill-origin";

interface Props {
  detail: SkillDetail;
}

export function SkillFilesSection({ detail }: Props) {
  const entries = skillFileList(detail);
  const main = entries.find((entry) => entry.path === SKILL_MD);
  const supporting = entries.filter((entry) => entry.path !== SKILL_MD);

  return (
    <View className="gap-2">
      <Text className="px-4 text-xs font-medium uppercase text-muted-foreground">
        Files
      </Text>
      <View className="border-y border-border bg-background">
        <Text className="px-4 pt-3 text-xs text-muted-foreground">
          Main file
        </Text>
        {main ? <FileRow path={main.path} size={main.size} /> : null}

        <View className="ml-4 h-px bg-border" />
        <Text className="px-4 pt-3 text-xs text-muted-foreground">
          {supporting.length === 0
            ? "No supporting files"
            : `Supporting ${supporting.length}`}
        </Text>
        {supporting.map((entry) => (
          <FileRow key={entry.path} path={entry.path} size={entry.size} />
        ))}
      </View>
    </View>
  );
}

function FileRow({ path, size }: { path: string; size: number }) {
  return (
    <View className="flex-row items-center justify-between gap-3 px-4 py-3">
      <Text className="flex-1 font-mono text-xs text-foreground" numberOfLines={1}>
        {path}
      </Text>
      <Text className="text-xs text-muted-foreground">
        {formatFileSize(size)}
      </Text>
    </View>
  );
}
