import type { ClawClient } from "./client.js";

export interface EvaluationAttempt {
  task_id: string; trial: number; status: string; success: boolean;
  episode_success: boolean | null; independent_reward: number | null; official_reward: number | null; elapsed_seconds: number | null;
  model_calls: number | null; tool_calls: number | null; dataset_revision_verified: boolean;
}
export interface OfficialEvaluationTrial {
  trial: number; tasks: number; scenarios: number; task_goal_completion: number; scenario_goal_completion: number;
}
export interface EvaluationRun {
  scoring_basis: "episode" | "post-close-official"; scoring_adjustments: number; verifier_revision: string | null;
  protocol: "e3-heldout-v1" | null; official_metrics: OfficialEvaluationTrial[] | null;
  run_id: string; scope: "development"; validation_scope: "official-sdk-adapter" | "fixture";
  model_snapshot_verified: false; total_cost: null;
  config: {
    benchmark: string; split: string; model: string; harness_revision: string; dataset_revision: string;
    max_actions: number; max_output_tokens: number; per_turn_output_tokens: number;
    timeout_seconds: number; seed: number; domain: string | null;
    user_model: string | null; user_provider: string | null;
  };
  harness_profile: string; upstream_revision: string | null; task_ids: string[]; trials: number; attempts: EvaluationAttempt[];
}
export interface EvaluationReport { schema_version: 1 | 2; exported_at: string; runs: EvaluationRun[] }
const statuses = ["completed", "incomplete", "budget_exhausted", "infra_error", "runtime_error", "evaluation_error", "timeout"];
function requireValue(value: boolean): asserts value {
  if (!value) throw new Error("评测报告格式无效，请联系管理员");
}
function object(value: unknown): Record<string, unknown> {
  requireValue(typeof value === "object" && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  requireValue(typeof value === "string" && /^[A-Za-z0-9_.:/+-]{1,160}$/.test(value));
  return value;
}
function number(value: unknown, integer = false): number {
  requireValue(typeof value === "number" && Number.isFinite(value) && value >= 0 && (!integer || Number.isSafeInteger(value)));
  return value;
}
function nullableNumber(value: unknown, integer = false): number | null { return value === null ? null : number(value, integer); }
function nullableText(value: unknown): string | null { return value === null ? null : text(value); }
function boolean(value: unknown): boolean { requireValue(typeof value === "boolean"); return value; }
function revision(value: unknown): string { const result = text(value); requireValue(/^[a-f0-9]{40}$/.test(result)); return result; }
function parseRun(value: unknown): EvaluationRun {
  const r = object(value), c = object(r.config);
  requireValue(r.protocol === undefined || r.protocol === null || r.protocol === "e3-heldout-v1");
  const protocol = r.protocol ?? null;
  const scoring_basis = r.scoring_basis ?? "episode";
  requireValue(scoring_basis === "episode" || scoring_basis === "post-close-official");
  const scoring_adjustments = r.scoring_adjustments === undefined ? 0 : number(r.scoring_adjustments, true);
  const verifier_revision = r.verifier_revision === undefined || r.verifier_revision === null ? null : revision(r.verifier_revision);
  let official_metrics: OfficialEvaluationTrial[] | null = null;
  if (r.official_metrics !== undefined && r.official_metrics !== null) {
    requireValue(Array.isArray(r.official_metrics));
    official_metrics = r.official_metrics.map((value) => {
      const m = object(value);
      const result = { trial: number(m.trial, true), tasks: number(m.tasks, true), scenarios: number(m.scenarios, true),
        task_goal_completion: number(m.task_goal_completion), scenario_goal_completion: number(m.scenario_goal_completion) };
      requireValue(result.task_goal_completion <= 1 && result.scenario_goal_completion <= 1 && result.tasks > 0 && result.scenarios > 0);
      return result;
    });
  }
  requireValue(r.scope === "development" && r.model_snapshot_verified === false && r.total_cost === null);
  requireValue(r.validation_scope === "official-sdk-adapter" || r.validation_scope === "fixture");
  requireValue(Array.isArray(r.task_ids) && r.task_ids.length > 0 && Array.isArray(r.attempts));
  const task_ids = r.task_ids.map(text), trials = number(r.trials, true);
  requireValue(new Set(task_ids).size === task_ids.length && trials > 0);
  const identities = new Set<string>();
  const attempts = r.attempts.map((item): EvaluationAttempt => {
    const a = object(item), task_id = text(a.task_id), trial = number(a.trial, true), status = text(a.status);
    const key = JSON.stringify([task_id, trial]), success = boolean(a.success), reward = nullableNumber(a.official_reward);
    requireValue(task_ids.includes(task_id) && trial < trials && !identities.has(key) && statuses.includes(status));
    const independent = a.independent_reward === undefined ? null : nullableNumber(a.independent_reward);
    const goal = independent ?? reward;
    requireValue((reward === null || reward <= 1) && (!success || (status === "completed" && goal === 1)));
    if (a.independent_reward !== undefined && a.independent_reward !== null) {
      const independent = number(a.independent_reward);
      requireValue((independent === 0 || independent === 1) && (scoring_basis === "post-close-official" || reward === null || independent === reward));
    }
    identities.add(key);
    return { task_id, trial, status, success, episode_success: a.episode_success === undefined || a.episode_success === null ? null : boolean(a.episode_success), official_reward: reward, independent_reward: a.independent_reward === undefined ? null : nullableNumber(a.independent_reward), elapsed_seconds: nullableNumber(a.elapsed_seconds),
      model_calls: nullableNumber(a.model_calls, true), tool_calls: nullableNumber(a.tool_calls, true),
      dataset_revision_verified: boolean(a.dataset_revision_verified) };
  });
  const config = { benchmark: text(c.benchmark), split: text(c.split), model: text(c.model),
    harness_revision: revision(c.harness_revision), dataset_revision: text(c.dataset_revision),
    max_actions: number(c.max_actions, true), max_output_tokens: number(c.max_output_tokens, true),
    per_turn_output_tokens: number(c.per_turn_output_tokens, true), timeout_seconds: number(c.timeout_seconds),
    seed: number(c.seed, true), domain: nullableText(c.domain), user_model: nullableText(c.user_model), user_provider: nullableText(c.user_provider) };
  requireValue(/^sha256:[a-f0-9]{64}$/.test(config.dataset_revision) && config.max_actions > 0 && config.max_output_tokens > 0 && config.per_turn_output_tokens > 0 && config.timeout_seconds > 0);
  if (protocol) requireValue(trials === 3 && config.split === "dev");
  if (official_metrics !== null) {
    requireValue(config.benchmark === "appworld" && official_metrics.length === trials && new Set(official_metrics.map((m) => m.trial)).size === trials);
    const families = new Set(task_ids.map((t) => t.slice(0, t.lastIndexOf("_"))));
    for (const family of families) requireValue([1, 2, 3].every((v) => task_ids.includes(`${family}_${v}`)));
    for (const m of official_metrics) {
      const rows = attempts.filter((a) => a.trial === m.trial);
      requireValue(m.trial < trials && m.tasks === task_ids.length && m.scenarios === families.size && rows.length === task_ids.length && rows.every((a) => a.independent_reward !== null || a.official_reward !== null));
      const rewards = new Map(rows.map((a) => [a.task_id, (a.independent_reward ?? a.official_reward) === 1]));
      const tgc = Math.round([...rewards.values()].filter(Boolean).length / task_ids.length * 1000) / 1000;
      const sgc = Math.round([...families].filter((f) => [1, 2, 3].every((v) => rewards.get(`${f}_${v}`))).length / families.size * 1000) / 1000;
      requireValue(Math.abs(tgc - m.task_goal_completion) < 1e-9 && Math.abs(sgc - m.scenario_goal_completion) < 1e-9);
    }
  }
  if (scoring_basis === "post-close-official") {
    requireValue(official_metrics !== null && verifier_revision !== null && attempts.every((a) => a.independent_reward !== null && a.episode_success !== null));
    requireValue(scoring_adjustments === attempts.filter((a) => a.success !== a.episode_success).length);
    requireValue(attempts.every((a) => a.success === (a.status === "completed" && a.independent_reward === 1)));
  } else requireValue(scoring_adjustments === 0);
  const run_id = text(r.run_id); requireValue(/^eval_[a-f0-9]{32}$/.test(run_id));
  return { scoring_basis, scoring_adjustments, verifier_revision, protocol: protocol as EvaluationRun["protocol"], official_metrics, run_id, scope: r.scope, validation_scope: r.validation_scope, model_snapshot_verified: false, total_cost: null,
    config, harness_profile: text(r.harness_profile), upstream_revision: r.upstream_revision === null ? null : revision(r.upstream_revision), task_ids, trials, attempts };
}
export async function getEvaluations(client: ClawClient): Promise<EvaluationReport> {
  const { body } = await client.request<unknown>("GET", "/aurax/evaluations");
  const report = object(body);
  requireValue((report.schema_version === 1 || report.schema_version === 2) && typeof report.exported_at === "string" && Number.isFinite(Date.parse(report.exported_at)) && Array.isArray(report.runs));
  const runs = report.runs.map(parseRun);
  requireValue(new Set(runs.map((run) => run.run_id)).size === runs.length);
  return { schema_version: report.schema_version, exported_at: report.exported_at, runs };
}
export function evaluationStats(run: EvaluationRun) {
  const expected = run.task_ids.length * run.trials;
  const success = run.attempts.filter((a) => a.success).length;
  const errors = run.attempts.filter((a) => ["infra_error", "runtime_error", "evaluation_error", "timeout"].includes(a.status)).length;
  const complete = run.attempts.length === expected;
  return { expected, success, errors, failures: run.attempts.length - success - errors,
    missing: expected - run.attempts.length, complete, rate: complete ? success / expected : null };
}
export function evaluationStatus(status: string, success: boolean) {
  if (success) return "成功";
  return ({ completed: "任务未通过", incomplete: "任务未完成", budget_exhausted: "预算耗尽", infra_error: "环境异常",
    runtime_error: "运行异常", evaluation_error: "评分异常", timeout: "超时" } as Record<string, string>)[status] ?? "未知状态";
}

/** Mean over tasks of C(successes,k)/C(trials,k); not the probability of any success. */
export function evaluationConsistency(run: EvaluationRun): { k: number; value: number }[] {
  if (!evaluationStats(run).complete) return [];
  return Array.from({ length: Math.min(3, run.trials) }, (_, i) => {
    const k = i + 1;
    const value = run.task_ids.reduce((sum, task) => {
      const successes = run.attempts.filter((a) => a.task_id === task && a.success).length;
      let estimate = successes < k ? 0 : 1;
      if (estimate) for (let j = 0; j < k; j++) estimate *= (successes - j) / (run.trials - j);
      return sum + estimate;
    }, 0) / run.task_ids.length;
    return { k, value };
  });
}
