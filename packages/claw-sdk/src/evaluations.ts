import type { ClawClient } from "./client.js";

export interface EvaluationAttempt {
  task_id: string; trial: number; status: string; success: boolean;
  official_reward: number | null; elapsed_seconds: number | null;
  model_calls: number | null; tool_calls: number | null; dataset_revision_verified: boolean;
}
export interface EvaluationRun {
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
export interface EvaluationReport { schema_version: 1; exported_at: string; runs: EvaluationRun[] }
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
    requireValue((reward === null || reward <= 1) && (!success || (status === "completed" && reward === 1)));
    identities.add(key);
    return { task_id, trial, status, success, official_reward: reward, elapsed_seconds: nullableNumber(a.elapsed_seconds),
      model_calls: nullableNumber(a.model_calls, true), tool_calls: nullableNumber(a.tool_calls, true),
      dataset_revision_verified: boolean(a.dataset_revision_verified) };
  });
  const config = { benchmark: text(c.benchmark), split: text(c.split), model: text(c.model),
    harness_revision: revision(c.harness_revision), dataset_revision: text(c.dataset_revision),
    max_actions: number(c.max_actions, true), max_output_tokens: number(c.max_output_tokens, true),
    per_turn_output_tokens: number(c.per_turn_output_tokens, true), timeout_seconds: number(c.timeout_seconds),
    seed: number(c.seed, true), domain: nullableText(c.domain), user_model: nullableText(c.user_model), user_provider: nullableText(c.user_provider) };
  requireValue(/^sha256:[a-f0-9]{64}$/.test(config.dataset_revision) && config.max_actions > 0 && config.max_output_tokens > 0 && config.per_turn_output_tokens > 0 && config.timeout_seconds > 0);
  const run_id = text(r.run_id); requireValue(/^eval_[a-f0-9]{32}$/.test(run_id));
  return { run_id, scope: r.scope, validation_scope: r.validation_scope, model_snapshot_verified: false, total_cost: null,
    config, harness_profile: text(r.harness_profile), upstream_revision: r.upstream_revision === null ? null : revision(r.upstream_revision), task_ids, trials, attempts };
}
export async function getEvaluations(client: ClawClient): Promise<EvaluationReport> {
  const { body } = await client.request<unknown>("GET", "/aurax/evaluations");
  const report = object(body);
  requireValue(report.schema_version === 1 && typeof report.exported_at === "string" && Number.isFinite(Date.parse(report.exported_at)) && Array.isArray(report.runs));
  const runs = report.runs.map(parseRun);
  requireValue(new Set(runs.map((run) => run.run_id)).size === runs.length);
  return { schema_version: 1, exported_at: report.exported_at, runs };
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
