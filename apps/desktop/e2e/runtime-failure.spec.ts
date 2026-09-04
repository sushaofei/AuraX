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

test("chat exposes reserved usage separately from actual tool dispatches", async ({ page }) => {
  const { mockClaw } = await import("./mock-claw");
  await page.addInitScript(() => localStorage.clear());
  await mockClaw(page);
  await page.route(/\/v1\/tasks\/[^/?]+$/, async (route) => route.fulfill({ json: {
    tenant_id: "platform", session_id: "ses_demo", root_session_id: "ses_demo", run_id: "run_demo",
    status: "running", run_status: "running", goal: "预算测试", projection_version: 5,
    runtime_budget: { limits: { max_steps: 48, max_output_tokens: 8192 }, usage: {
      steps_used: 9, model_turns: 5, tool_attempts: 4, tool_dispatches: 1,
      output_tokens: 1303, output_tokens_reserved: 1024,
    } },
  } }));
  await page.goto("/");
  await page.getByPlaceholder("要 AuraClaw 做什么？").fill("预算测试");
  await page.getByRole("button", { name: "开始" }).click();
  const usage = page.getByLabel("本轮资源用量");
  await expect(usage).toContainText("步骤 9/48");
  await expect(usage).toContainText("工具尝试 4 次");
  await expect(usage).toContainText("实际调用 1 次");
  await expect(usage).toContainText("在途预留 1024");
  await page.screenshot({ path: "/tmp/aurax-runtime-budget-101.png", fullPage: true });
});
