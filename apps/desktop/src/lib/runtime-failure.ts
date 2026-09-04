const STOP_LABELS: Record<string, string> = {
  runtime_step_budget_exceeded: "本轮步骤额度已用尽",
  runtime_output_token_budget_exceeded: "本轮输出额度已用尽",
  runtime_cost_budget_exceeded: "本轮成本额度已用尽",
  runtime_deadline_exceeded: "本轮已到截止时间",
  runtime_no_progress_detected: "重复调用保护已停止本轮执行",
  runtime_budget_exceeded: "本轮触发旧版运行限制（未区分类型）",
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function runtimeFailureLabel(code: string | null): string {
  return (code && STOP_LABELS[code]) || "本轮执行失败";
}

export function runtimeFailureUsage(error: Record<string, unknown> | null | undefined): string {
  const details = record(error?.details);
  const budget = record(details.budget);
  const usage = record(details.usage);
  const parts: string[] = [];
  if (typeof usage.steps_used === "number" && typeof budget.max_steps === "number") {
    parts.push(`步骤 ${usage.steps_used}/${budget.max_steps}`);
  }
  if (typeof usage.output_tokens === "number" && typeof budget.max_output_tokens === "number") {
    parts.push(`输出 token ${usage.output_tokens}/${budget.max_output_tokens}`);
  }
  return parts.join(" · ");
}
