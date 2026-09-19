/**
 * Squads 只读视图的纯函数部分（FEATURE-569）。
 *
 * 口径来源（web）：
 *   - 成员类型标签      packages/views/locales/en/squads.json `member_type`
 *   - leader 判定       packages/views/squads/components/squad-detail-page.tsx:191
 *   - leader 名称回退   packages/views/squads/components/squads-page.tsx `LeaderCell`（193-209）
 *   - 成员数文案        packages/views/locales/en/squads.json `members_tab.section_count`
 */
import type { SquadMember } from "@multica/core/types";

/** web `member_type`：agent / member 两值。未知值原样显示，不猜也不崩。 */
const MEMBER_TYPE_LABELS: Record<string, string> = {
  agent: "Agent",
  member: "Member",
};

export function squadMemberTypeLabel(type: string): string {
  return MEMBER_TYPE_LABELS[type] ?? type;
}

/**
 * squad 的 leader 是一个 agent 成员（`leader_id` 是 agent id，见后端
 * CreateSquadRequest）。web 的判定同时要求 member_type 为 agent，避免某个真人成员
 * 的 user id 恰好等于 leader_id 时被误标。
 */
export function isSquadLeader(member: SquadMember, leaderId: string): boolean {
  return member.member_type === "agent" && member.member_id === leaderId;
}

/**
 * 在 agent 列表里找 leader 的名字；leader 已删或列表还没到手时返回 null。
 *
 * 单独一个函数而不是直接用 `useActorLookup().getName`：后者查不到时会返回
 * "Unknown Agent"，那样 `squadLeaderLabel` 里「退化成 id 前 8 位」那一档就永远走
 * 不到，而 web 的 LeaderCell 正是靠这一档兜底的。
 */
export function findSquadLeaderName(
  leaderId: string,
  agents: { id: string; name: string }[],
): string | null {
  if (!leaderId) return null;
  return agents.find((agent) => agent.id === leaderId)?.name ?? null;
}

/**
 * leader 的显示名。成员列表还没加载出来时（或 leader 已被删除）退化成 id 前 8 位，
 * 与 web `LeaderCell` 的 `leader?.name ?? leaderId.slice(0, 8)` 一致；id 也拿不到
 * 时给 "—"。
 */
export function squadLeaderLabel(
  leaderId: string,
  leaderName: string | null | undefined,
): string {
  if (leaderName) return leaderName;
  return leaderId ? leaderId.slice(0, 8) : "—";
}

/** "0 members" / "1 member" / "N members"。 */
export function squadMemberCountLabel(count: number): string {
  return count === 1 ? "1 member" : `${count} members`;
}
