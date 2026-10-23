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
      if (kind === "schema") value.schema_version = 4;
      await expect(getEvaluations(client(value))).rejects.toThrow("评测报告格式无效");
    },
  );
});

describe("E3 repeated holdout reports", () => {
  it("computes all-success consistency separately from any-success", async () => {
    const base = report().runs[0]!;
    const run = { ...base, protocol: "e3-heldout-v1", trials: 3,
      attempts: [0, 1].flatMap((task) => [0, 1, 2].map((trial) => ({ ...base.attempts[0]!, task_id: String(task), trial,
        success: task === 1 || trial < 2, official_reward: task === 1 || trial < 2 ? 1 : 0 }))) };
    const parsed = (await getEvaluations(client({ ...report(), runs: [run] }))).runs[0]!;
    const { evaluationConsistency } = await import("./evaluations.js");
    expect(evaluationConsistency(parsed).map((p) => p.value)).toEqual([
      expect.closeTo(5 / 6), expect.closeTo(2 / 3), 0.5,
    ]);
    parsed.attempts.pop();
    expect(evaluationConsistency(parsed)).toEqual([]);
  });
  it("validates independently graded complete scenarios and rejects inflated metrics", async () => {
    const base = report().runs[0]!;
    const run = { ...base, protocol: "e3-heldout-v1", trials: 3,
      config: { ...base.config, benchmark: "appworld", domain: null }, task_ids: ["family_1", "family_2", "family_3"],
      attempts: [1, 2, 3].flatMap((task) => [0, 1, 2].map((trial) => ({ ...base.attempts[0]!, task_id: `family_${task}`, trial,
        success: task < 3, official_reward: task < 3 ? 1 : 0 }))),
      official_metrics: [0, 1, 2].map((trial) => ({ trial, tasks: 3, scenarios: 1, task_goal_completion: 0.667, scenario_goal_completion: 0 })),
    };
    const value = { ...report(), runs: [run] };
    expect((await getEvaluations(client(value))).runs[0]!.official_metrics).toHaveLength(3);
    run.official_metrics[0]!.scenario_goal_completion = 1;
    await expect(getEvaluations(client(value))).rejects.toThrow("格式无效");
  });
});

it("keeps a crashed attempt unsuccessful while accepting its independent final-state grade", async () => {
  const base = report().runs[0]!;
  const attempts = [1, 2, 3].flatMap((task) => [0, 1, 2].map((trial) => ({ ...base.attempts[0]!, task_id: `family_${task}`, trial,
    success: task < 3, official_reward: task < 3 ? 1 : 0 })));
  const run = { ...base, protocol: "e3-heldout-v1", trials: 3, config: { ...base.config, benchmark: "appworld", domain: null },
    task_ids: ["family_1", "family_2", "family_3"],
    attempts: attempts.map((a, i) => i === 8 ? { ...a, status: "runtime_error", official_reward: null, independent_reward: 0 } : a),
    official_metrics: [0, 1, 2].map((trial) => ({ trial, tasks: 3, scenarios: 1, task_goal_completion: 0.667, scenario_goal_completion: 0 })),
  };
  const parsed = (await getEvaluations(client({ ...report(), runs: [run] }))).runs[0]!;
  expect(parsed.attempts[8]).toMatchObject({ status: "runtime_error", success: false, official_reward: null, independent_reward: 0 });
  expect(evaluationStats(parsed)).toMatchObject({ success: 6, errors: 1, expected: 9 });
});

it("accepts v2 final goal judgments while preserving and explaining live diagnostics", async () => {
  const base = report().runs[0]!;
  const run = { ...base, protocol: "e3-heldout-v1", trials: 3, scoring_basis: "post-close-official", scoring_adjustments: 6, verifier_revision: "a".repeat(40),
    config: { ...base.config, benchmark: "appworld", domain: null }, task_ids: ["family_1", "family_2", "family_3"],
    attempts: [1, 2, 3].flatMap((task) => [0, 1, 2].map((trial) => ({ ...base.attempts[0]!, task_id: `family_${task}`, trial,
      success: task === 1, episode_success: true, official_reward: 1, independent_reward: task === 1 ? 1 : 0 }))),
    official_metrics: [0, 1, 2].map((trial) => ({ trial, tasks: 3, scenarios: 1, task_goal_completion: 0.333, scenario_goal_completion: 0 })),
  };
  const value = { ...report(), schema_version: 2, runs: [run] };
  const parsed = await getEvaluations(client(value));
  expect(parsed.schema_version).toBe(2);
  expect(evaluationStats(parsed.runs[0]!)).toMatchObject({ success: 3, rate: 1 / 3 });
  expect(parsed.runs[0]!.attempts[8]).toMatchObject({ success: false, episode_success: true, official_reward: 1, independent_reward: 0 });
  run.scoring_adjustments = 0;
  await expect(getEvaluations(client(value))).rejects.toThrow("格式无效");
});


it("preserves reference component limitations and rejects incomplete v3 batches", async () => {
  const base = report().runs[0]!;
  const run = { ...base, protocol: "auraclaw-components-v1", trials: 3, validation_scope: "reference-adapter",
    config: { ...base.config, benchmark: "longmemeval", split: "s_cleaned", domain: null },
    component: { condition: "retrieval-memory", judge_model: "qwen-test", judge_scope: "custom-judge-not-official-comparable",
      reference_memory: true, reference_skills: false, development_exposed_tasks: [], task_timeouts: { "0": 600, "1": 600 } },
    attempts: [0, 1].flatMap((task) => [0, 1, 2].map((trial) => ({ ...base.attempts[0]!, task_id: String(task), trial }))),
  };
  const value = { ...report(), schema_version: 3, runs: [run] };
  const parsed = await getEvaluations(client(value));
  expect(parsed.runs[0]!.component).toMatchObject({ reference_memory: true, judge_model: "qwen-test" });
  await expect(getEvaluations(client({ ...value, schema_version: 2 }))).rejects.toThrow("格式无效");
  run.attempts.pop();
  await expect(getEvaluations(client(value))).rejects.toThrow("格式无效");
});
