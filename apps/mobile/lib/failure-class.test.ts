import { describe, expect, it } from "vitest";

import {
  FAILURE_CLASSES,
  FAILURE_CLASS_LABEL,
  failureClassOf,
  type FailureClass,
} from "./failure-class";

// One representative wire value per class. The mapping is a mirror, so the
// value of this test is catching a mirror that drifted out of sync with
// packages/core/dashboard/failure-class.ts (or a typo in a wire string, which
// would silently push a whole class into "other").
const SAMPLE_BY_CLASS: Record<Exclude<FailureClass, "other">, string[]> = {
  auth: ["agent_error.provider_auth_or_access", "agent_error.missing_config"],
  rate_limit: [
    "agent_error.provider_capacity_or_rate_limit",
    "agent_error.provider_quota_limit",
  ],
  timeout: ["timeout", "agent_error.agent_timeout", "codex_semantic_inactivity"],
  provider: [
    "agent_error.provider_server_error",
    "agent_error.provider_network",
    "agent_error.model_not_found_or_unavailable",
    "api_invalid_request",
  ],
  runtime: [
    "runtime_offline",
    "runtime_recovery",
    "queued_expired",
    "agent_error.runtime_missing_executable",
    "agent_error.runtime_version_unsupported",
    "skill_bundle_unavailable",
    "runtime_cli_timeout",
    "environment_prepare_failed",
  ],
  agent: [
    "agent_error.process_failure",
    "codex_resume_oversized",
    "agent_error.empty_or_unparseable_output",
    "agent_error.context_overflow",
    "iteration_limit",
    "agent_blocked",
  ],
};

describe("failureClassOf", () => {
  it("folds every canonical reason into its display class", () => {
    for (const [failureClass, reasons] of Object.entries(SAMPLE_BY_CLASS)) {
      for (const reason of reasons) {
        expect(failureClassOf(reason)).toBe(failureClass);
      }
    }
  });

  it("folds legacy coarse values and the unclassified sentinel into other", () => {
    expect(failureClassOf("agent_error")).toBe("other");
    expect(failureClassOf("agent_error.unknown")).toBe("other");
    expect(failureClassOf("manual")).toBe("other");
    expect(failureClassOf("unclassified")).toBe("other");
  });

  it("folds a reason from a newer backend into other instead of dropping it", () => {
    // A row that lands in no bucket would make the class totals stop
    // reconciling with the failure count above them.
    expect(failureClassOf("agent_error.some_future_reason")).toBe("other");
    expect(failureClassOf("")).toBe("other");
  });
});

describe("failure class labels", () => {
  it("labels all seven classes so no row can render an empty label", () => {
    for (const failureClass of FAILURE_CLASSES) {
      expect(FAILURE_CLASS_LABEL[failureClass]).toBeTruthy();
    }
  });
});
