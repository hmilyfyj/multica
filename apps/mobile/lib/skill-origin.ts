/**
 * Skills 只读视图的纯函数部分（FEATURE-569）。
 *
 * Skills 没有 `source` 字段：来源只存在于 `config.origin` 这个 JSONB（后端
 * `POST /api/runtimes/{id}/local-skills/import` 与导入流程写入，
 * server/internal/handler/skill_refresh.go:31-53 是它的形状定义）。网页版也是这么
 * 读的（packages/views/skills/lib/origin.ts `readOrigin`），本模块沿用同一套判别。
 *
 * 只读移动端不做外链：网页版会把 `origin.source_url` 渲染成 `<a>`，前提是先过一层
 * 主机白名单校验（origin.ts `originSourceUrl`，因为 `config` 可被任何有编辑权的人
 * 原样写入）。手机端只显示来源文案，因此不复制那套校验，也不暴露任何 URL。
 *
 * 文案来源：packages/views/locales/en/skills.json `table.source_*`。
 */
import type { SkillSummary } from "@multica/core/types";

export type SkillOriginType =
  | "runtime_local"
  | "clawhub"
  | "skills_sh"
  | "github"
  | "manual";

export interface SkillOrigin {
  type: SkillOriginType;
  /** runtime_local 来源才有：注册该本地 skill 的 runtime 与它的 provider。 */
  runtime_id?: string;
  provider?: string;
}

/**
 * 判别 `config.origin`。手动创建的 skill 没有 origin，统一合成 `{ type:
 * "manual" }`，让调用方只面对一种形状；未知/损坏的 origin 同样退化成 manual ——
 * 这串 JSONB 不保证结构，猜一个来源比不显示来源更糟。
 */
export function readSkillOrigin(skill: SkillSummary): SkillOrigin {
  const raw = skill.config?.origin as Record<string, unknown> | undefined;
  if (!raw) return { type: "manual" };

  switch (raw.type) {
    case "runtime_local":
      return {
        type: "runtime_local",
        runtime_id: typeof raw.runtime_id === "string" ? raw.runtime_id : undefined,
        provider: typeof raw.provider === "string" ? raw.provider : undefined,
      };
    case "clawhub":
      return { type: "clawhub" };
    case "skills_sh":
      return { type: "skills_sh" };
    case "github":
      return { type: "github" };
    default:
      return { type: "manual" };
  }
}

/**
 * 来源文案。runtime_local 优先显示 runtime 名（调用方从 runtime 列表里按
 * `runtime_id` 解析后传入），拿不到时退化到 provider，再退化到通用文案 —— 与 web
 * `SourceCell`（skills-page.tsx:316-376）的退化顺序一致。
 */
export function skillOriginLabel(
  origin: SkillOrigin,
  runtimeName?: string | null,
): string {
  switch (origin.type) {
    case "runtime_local":
      if (runtimeName) return `From ${runtimeName}`;
      if (origin.provider) return `From ${origin.provider} runtime`;
      return "From a runtime";
    case "clawhub":
      return "From ClawHub";
    case "skills_sh":
      return "From Skills.sh";
    case "github":
      return "From GitHub";
    case "manual":
      return "Created manually";
  }
}

/** SKILL.md 是每个 skill 必有的主文件；其余是附带文件。与 web 的常量同名。 */
export const SKILL_MD = "SKILL.md";

export interface SkillFileEntry {
  path: string;
  /** 字节数；服务端没给时是 0（SkillFileMetadataSchema 的默认值）。 */
  size: number;
}

/**
 * 只读文件清单：SKILL.md 恒在最前，随后是附带文件，保持服务端顺序。
 *
 * 详情接口用 `?include=metadata`：`content_size` 是 SKILL.md 正文的字节数（正文本身
 * 不返回 —— 单个 skill 的 SKILL.md 常见 50–200KB，见 server/internal/handler/
 * skill.go:107-121），`files` 是附带文件的 path/size。网页版的 `totalFileCount` 同样
 * 把 SKILL.md 算作 +1。
 */
export function skillFileList(detail: {
  content_size: number;
  files: { path: string; size: number }[];
}): SkillFileEntry[] {
  return [
    { path: SKILL_MD, size: detail.content_size },
    ...detail.files.map((file) => ({ path: file.path, size: file.size })),
  ];
}

const FILE_SIZE_UNITS = ["B", "KB", "MB", "GB"] as const;

/**
 * 文件大小（1024 进制，一位小数）。用显式循环避免依赖 Hermes 的 ES2023 数组方法；
 * 超过 GB 与 0 字节都有确定输出。
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < FILE_SIZE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  if (unitIndex === 0) return `${Math.round(value)} ${FILE_SIZE_UNITS[0]}`;
  return `${Number(value.toFixed(1))} ${FILE_SIZE_UNITS[unitIndex]}`;
}
