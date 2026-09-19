import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

export const agentListOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: ["agents", wsId] as const,
    queryFn: ({ signal }) => api.listAgents({ signal }),
    enabled: !!wsId,
    // Mirrors Web/Desktop: projected unstable ages offline without an event,
    // while offline recovery is covered by lifecycle events and reconnect.
    refetchInterval: (query) =>
      query.state.data?.some(
        (agent) =>
          !agent.archived_at &&
          (agent.runtime_availability === "online" ||
            agent.runtime_availability === "unstable"),
      )
        ? 30_000
        : false,
  });

// One agent's whole task history — backs the agent detail Runs section.
// Keyed under the `["agents", wsId]` prefix so the roster's `agent:*`
// realtime invalidations cover it too; task lifecycle events are the detail
// screen's own record subscription (the listing-level presence hook
// deliberately does not carry this per-record key).
export const agentTasksOptions = (wsId: string | null, agentId: string) =>
  queryOptions({
    queryKey: ["agents", wsId, "tasks", agentId] as const,
    queryFn: ({ signal }) => api.listAgentTasks(agentId, { signal }),
    enabled: !!wsId && !!agentId,
  });
