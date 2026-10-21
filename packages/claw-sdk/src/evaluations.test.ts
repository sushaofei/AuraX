import { describe, expect, it } from "vitest";
import { ClawClient } from "./client.js";
import { evaluationStats, getEvaluations } from "./evaluations.js";

function report() {
  return { schema_version: 1, exported_at: "2026-10-21T08:00:00Z", runs: [{
    run_id: `eval_${"a".repeat(32)}`, scope: "development", validation_scope: "official-sdk-adapter",
    model_snapshot_verified: false, total_cost: null, harness_profile: "test-fixed-tools", upstream_revision: "b".repeat(40),
    config: { benchmark: "tau-bench", split: "dev", model: "test-model", harness_revision: "c".repeat(40),
      dataset_revision: `sha256:${"d".repeat(64)}`, max_actions: 30, max_output_tokens: 24576,
      per_turn_output_tokens: 4096, timeout_seconds: 600, seed: 10, domain: "retail", user_model: "sim", user_provider: "openai" },
    task_ids: ["0", "1"], trials: 1,
    attempts: [true, false].map((success, i) => ({ task_id: String(i), trial: 0, status: "completed", success,
      official_reward: success ? 1 : 0, elapsed_seconds: 10, model_calls: 2, tool_calls: 2, dataset_revision_verified: true })),
  }] };
}
function client(value: unknown) {
  return new ClawClient({ baseUrl: "http://localhost", fetch: (async (url) => {
    expect(String(url)).toBe("http://localhost/aurax/evaluations");
    return new Response(JSON.stringify(value));
  }) as typeof fetch });
}
describe("evaluation artifacts", () => {
  it("keeps failures in the denominator and preserves unknown cost", async () => {
    const r = (await getEvaluations(client(report()))).runs[0]!;
    expect(evaluationStats(r)).toMatchObject({ rate: 0.5, success: 1, failures: 1, errors: 0, expected: 2 });
    expect(r.total_cost).toBeNull();
  });
  it("does not score partial runs as a perfect result", async () => {
    const value = report(); value.runs[0]!.attempts.pop();
    const run = (await getEvaluations(client(value))).runs[0]!;
    expect(evaluationStats(run)).toMatchObject({ rate: null, missing: 1, complete: false });
  });
  it("distinguishes execution errors from task failures", async () => {
    const value = report(); value.runs[0]!.attempts[1]!.status = "infra_error";
    const run = (await getEvaluations(client(value))).runs[0]!;
    expect(evaluationStats(run)).toMatchObject({ rate: 0.5, errors: 1, failures: 0 });
  });
  it.each(["duplicate", "foreign-task", "invalid-number", "inconsistent-success", "schema"]) (
    "rejects %s", async (kind) => {
      const value = report(), run = value.runs[0]!;
      if (kind === "duplicate") run.attempts.push(run.attempts[0]!);
      if (kind === "foreign-task") run.attempts[0]!.task_id = "unexpected";
      if (kind === "invalid-number") run.attempts[0]!.elapsed_seconds = -1;
      if (kind === "inconsistent-success") run.attempts[0]!.official_reward = 0;
      if (kind === "schema") value.schema_version = 2;
      await expect(getEvaluations(client(value))).rejects.toThrow("评测报告格式无效");
    },
  );
});
