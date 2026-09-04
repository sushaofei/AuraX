import { expect, test } from "@playwright/test";
import { runtimeFailureLabel, runtimeFailureUsage } from "../src/lib/runtime-failure";

test("no progress is distinct from resource exhaustion and uses structured usage", () => {
  expect(runtimeFailureLabel("runtime_no_progress_detected")).toContain("重复调用保护");
  expect(runtimeFailureUsage({ details: {
    budget: { max_steps: 48, max_output_tokens: 8192 },
    usage: { steps_used: 21, output_tokens: 1303 },
  } })).toBe("步骤 21/48 · 输出 token 1303/8192");
  expect(runtimeFailureLabel("runtime_deadline_exceeded")).toContain("截止时间");
  expect(runtimeFailureLabel("runtime_budget_exceeded")).toContain("未区分类型");
  expect(runtimeFailureUsage({ message: "21/48 steps", details: null })).toBe("");
  expect(runtimeFailureUsage(null)).toBe("");
});
