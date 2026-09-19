/**
 * Runtimes 只读视图的纯函数部分（FEATURE-569）。
 *
 * 这里只做「server 值 → 展示值」的映射，零 React、零网络，便于 node vitest
 * 直接测。文案与取值口径对齐 web，来源写在各自函数上方，避免两端口径漂移。
 *
 * 网页版的对应实现：
 *   - 健康四态标签   packages/views/runtimes/components/shared.tsx（HEALTH_LABEL_EN）
 *   - 健康四态派生   @multica/core/runtimes `deriveRuntimeHealth`（本模块直接复用，不再实现）
 *   - 名称 / provider @multica/core/runtimes `runtimeDisplayName` / `providerDisplayName`
 *   - 版本           packages/views/runtimes/components/runtime-list.tsx `CliCell`
 *   - 设备串拆分     packages/views/runtimes/components/runtime-detail.tsx `parseDeviceInfo`
 *   - 最近心跳       packages/views/runtimes/utils.ts `formatLastSeen`
 *   - 数字格式       packages/views/runtimes/utils.ts `formatTokens` / `formatUsd`
 */
import type { RuntimeUsage } from "@multica/core/types";
import { readRuntimeCliVersion } from "@multica/core/runtimes";

/** `cost_usd_ticks` is 1e-10 USD per tick (server/internal/handler/runtime.go). */
export const COST_USD_TICKS_PER_USD = 10_000_000_000;

/** 移动端用量概要的窗口天数；行标题「Usage · 30D」与这里写在一处。 */
export const RUNTIME_USAGE_DAYS = 30;

/**
 * 健康四态的英文标签。四态本身由 core 的 `deriveRuntimeHealth(status,
 * last_seen_at, now)` 派生（online / recently_lost / offline / long_offline），
 * 这里只负责文案，取值与 web `HEALTH_LABEL_EN` 一致。
 */
const HEALTH_LABELS: Record<string, string> = {
  online: "Online",
  recently_lost: "Recently lost",
  offline: "Offline",
  long_offline: "Long offline",
};

export function runtimeHealthLabel(health: string): string {
  // 服务端加了新状态时原样显示，不猜也不崩。
  return HEALTH_LABELS[health] ?? health;
}

/**
 * `runtime_mode` 是 local / cloud 两值。web 用 ProviderLogo + RuntimeKindBadge
 * 表达这一维（runtime-list.tsx:227-289），手机端用文字徽标。
 */
const MODE_LABELS: Record<string, string> = {
  local: "Local",
  cloud: "Cloud",
};

export function runtimeModeLabel(mode: string): string {
  return MODE_LABELS[mode] ?? mode;
}

/**
 * `profile_id` 非空表示这条 runtime 由自定义 runtime profile 启动，否则是内置
 * 协议族 —— 与 web `RuntimeKindBadge` 的判据一致（runtime-list.tsx:227-241）。
 */
export function runtimeKindLabel(profileId: string | null | undefined): string {
  return profileId ? "Custom" : "Built-in";
}

/**
 * runtime 的可见性文案。
 *
 * 注意这是**另一条轴**：agent 的 visibility 用的是 "Personal" / "Workspace"
 * （packages/core/agents/visibility-label.ts），runtime 的是 `private` /
 * `public`，语义是「只有 owner 能绑 agent」还是「工作区任何成员都能」
 * （server/internal/handler/runtime.go `canUseRuntimeForAgent`）。web 的
 * RuntimeDetail 也是分开渲染的（packages/views/runtimes/components/
 * runtime-detail.tsx `VisibilityReadout`），所以这里不能复用 agent 那份文案。
 */
const RUNTIME_VISIBILITY_LABELS: Record<string, string> = {
  private: "Private",
  public: "Public",
};

export function runtimeVisibilityLabel(visibility: string): string {
  return RUNTIME_VISIBILITY_LABELS[visibility] ?? visibility;
}

/**
 * runtime 自身的 CLI 版本，取自 `metadata.version`。
 *
 * 刻意不取 `metadata.cli_version`：那是机器级的 multica daemon 版本，同一台机器
 * 上每条 runtime 都一样，web 曾因此把每行显示成同一个数字（#3838，见 CliCell
 * 注释）。cloud runtime 与字段缺失都返回 null —— CliCell 同样显示 "—"。
 */
export function runtimeVersion(runtime: {
  runtime_mode: string;
  metadata: Record<string, unknown>;
}): string | null {
  if (runtime.runtime_mode === "cloud") return null;
  const version = runtime.metadata?.version;
  return typeof version === "string" && version.length > 0 ? version : null;
}

/**
 * 机器级 daemon CLI 版本（`metadata.cli_version`）。web 把它放在机器详情头部而不
 * 是每条 runtime 行（CliCell 上方注释），移动端沿用：只有详情页显示。
 * 复用 core 的读取函数，字段名只在一处定义；core 用 "" 表示缺失，这里收敛成 null。
 */
export function runtimeDaemonCliVersion(
  metadata: Record<string, unknown> | undefined,
): string | null {
  return readRuntimeCliVersion(metadata) || null;
}

/**
 * `device_info` 是 daemon 拼好的一整串，形如 "host.local · 2.1.121 (Claude Code)"。
 * 按第一个 " · " 切成主机名与 runtime 版本两半，便于各自带标签展示；老 runtime 只
 * 报主机名时后半段为 undefined。与 web `parseDeviceInfo` 同一算法。
 */
export function splitDeviceInfo(raw: string): {
  hostname: string;
  runtime?: string;
} {
  const idx = raw.indexOf(" · ");
  if (idx < 0) return { hostname: raw };
  return {
    hostname: raw.slice(0, idx),
    runtime: raw.slice(idx + 3),
  };
}

/**
 * 复合单位的相对时间（"2m 14s ago" / "1d 4h ago" / "6d 19h ago"），与 web
 * `formatLastSeen`（packages/views/runtimes/utils.ts:23）逐档对齐。
 *
 * 与 lib/time-ago.ts 的 `timeAgo` 不同：那是列表行通用的粗粒度文案（"2m ago"），
 * 详情页要多给一级精度 —— 一眼分清「刚掉线」和「掉了很久」往往只差一个更细的单位。
 */
export function formatLastSeen(lastSeenAt: string | null): string {
  if (!lastSeenAt) return "Never";
  const diffMs = Date.now() - new Date(lastSeenAt).getTime();
  if (diffMs < 5_000) return "Just now";

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return `${seconds}s ago`;
  if (hours < 1) {
    const s = seconds % 60;
    return s > 0 ? `${minutes}m ${s}s ago` : `${minutes}m ago`;
  }
  if (days < 1) {
    const m = minutes % 60;
    return m > 0 ? `${hours}h ${m}m ago` : `${hours}h ago`;
  }
  const h = hours % 24;
  return h > 0 ? `${days}d ${h}h ago` : `${days}d ago`;
}

/**
 * 用量窗口收敛。
 *
 * 服务端 `days=N` 返回的是「今天这个不完整的桶 + 前 N 天」共 N+1 个日历桶
 * （server/internal/handler/runtime.go:360-371，多出的那一天是给网页版算环比
 * 用的）。概要既然是「近 30 天」，就得把这多出来的一天去掉，否则数字比标签大
 * 一天。按日期分组取最新的 `days` 个日历日，同一天的多个模型行整组保留。
 */
export function runtimeUsageWindow(
  rows: RuntimeUsage[],
  days: number,
): RuntimeUsage[] {
  if (days <= 0) return [];
  const ordered = [...new Set(rows.map((row) => row.date))].sort();
  const keep = new Set(ordered.slice(-days));
  return rows.filter((row) => keep.has(row.date));
}

export interface RuntimeUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  /**
   * provider 没有定价、因而没有计入 `costUsd` 的 token 数（四类之和）。单独报出
   * 来，是为了让「成本 $0」不会被读成「没有用量」—— 网页版靠价格表把这些 token
   * 估成钱，移动端不做估算（见 costUsd 注释）。
   */
  unpricedTokens: number;
  /**
   * provider 自己上报的费用（`cost_usd_ticks ÷ 1e10`），USD。
   *
   * 这是权威数字，不含任何客户端估算：网页版会用 186 行的 MODEL_PRICING 表把
   * 未计价 token 也折算成钱（packages/views/runtimes/utils.ts estimateCost），
   * 移动端刻意不复刻那张表（`apps/mobile` 不依赖 `@multica/views`），所以这里
   * 只报权威值，缺口用 unpricedTokens 显式说明。
   */
  costUsd: number;
  /** 有任一模型用量的日历天数。 */
  activeDays: number;
}

export function runtimeUsageTotals(rows: RuntimeUsage[]): RuntimeUsageTotals {
  const totals: RuntimeUsageTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    unpricedTokens: 0,
    costUsd: 0,
    activeDays: 0,
  };
  const activeDates = new Set<string>();
  let ticks = 0;

  for (const row of rows) {
    totals.inputTokens += row.input_tokens;
    totals.outputTokens += row.output_tokens;
    totals.cacheReadTokens += row.cache_read_tokens;
    totals.cacheWriteTokens += row.cache_write_tokens;
    totals.unpricedTokens += uncostedTokens(row);
    ticks += row.cost_usd_ticks ?? 0;
    activeDates.add(row.date);
  }

  totals.totalTokens =
    totals.inputTokens +
    totals.outputTokens +
    totals.cacheReadTokens +
    totals.cacheWriteTokens;
  totals.costUsd = ticks / COST_USD_TICKS_PER_USD;
  totals.activeDays = activeDates.size;
  return totals;
}

/** 四类未计价 token 之和，缺字段按 0 处理（老后端不返回这组字段）。 */
function uncostedTokens(row: RuntimeUsage): number {
  return (
    (row.uncosted_input_tokens ?? 0) +
    (row.uncosted_output_tokens ?? 0) +
    (row.uncosted_cache_read_tokens ?? 0) +
    (row.uncosted_cache_write_tokens ?? 0)
  );
}

const TOKEN_UNITS = [
  { divisor: 1, suffix: "" },
  { divisor: 1_000, suffix: "K" },
  { divisor: 1_000_000, suffix: "M" },
  { divisor: 1_000_000_000, suffix: "B" },
  { divisor: 1_000_000_000_000, suffix: "T" },
] as const;

/**
 * 紧凑 token 计数（1234 → "1.2K"）。与 web `formatTokens` 同一算法，含跨档进位
 * （999,999 → "1M" 而不是 "1000K"）。用显式循环而不是 `findLastIndex`，避免
 * 依赖 Hermes 对 ES2023 数组方法的支持情况。
 */
export function formatTokens(n: number): string {
  const magnitude = Math.abs(n);
  let unitIndex = 0;
  for (let i = TOKEN_UNITS.length - 1; i >= 0; i -= 1) {
    if (magnitude >= TOKEN_UNITS[i]!.divisor) {
      unitIndex = i;
      break;
    }
  }

  if (unitIndex === 0) return n.toLocaleString();

  let unit = TOKEN_UNITS[unitIndex]!;
  let scaled = n / unit.divisor;

  if (
    Math.abs(Number(scaled.toFixed(1))) >= 1_000 &&
    unitIndex < TOKEN_UNITS.length - 1
  ) {
    unit = TOKEN_UNITS[unitIndex + 1]!;
    scaled = n / unit.divisor;
  }

  return `${Number(scaled.toFixed(1))}${unit.suffix}`;
}

/**
 * 百元以下保留两位小数，以上取整 —— 与 web `formatUsd` 一致：四位数花费再带两位
 * 小数是噪音，而百元以下不带两位会把单次运行抹成 $0。
 */
export function formatUsd(n: number): string {
  if (n >= 100) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2)}`;
}
