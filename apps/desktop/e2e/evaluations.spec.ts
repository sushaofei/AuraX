import { expect, test } from "@playwright/test";
import { mockClaw } from "./mock-claw";

function report() {
  return { schema_version: 1, exported_at: "2026-10-21T08:00:00Z", runs: ["tau-bench", "appworld"].map((benchmark, index) => ({
    run_id: `eval_${String(index).repeat(32)}`, scope: "development", validation_scope: "official-sdk-adapter",
    model_snapshot_verified: false, total_cost: null, harness_profile: "test-fixed-tools", upstream_revision: "b".repeat(40),
    config: { benchmark, split: "dev", model: "test-model", harness_revision: "c".repeat(40),
      dataset_revision: `sha256:${"d".repeat(64)}`, max_actions: 30, max_output_tokens: 24576,
      per_turn_output_tokens: 4096, timeout_seconds: 600, seed: 10, domain: null, user_model: null, user_provider: null },
    task_ids: ["sample-0", "sample-1"], trials: 1,
    attempts: [true, index === 1].map((success, i) => ({ task_id: `sample-${i}`, trial: 0, status: "completed", success,
      official_reward: success ? 1 : 0, elapsed_seconds: 10, model_calls: 2, tool_calls: 2, dataset_revision_verified: true })),
  })) };
}
for (const width of [390, 760, 1440]) {
  test(`evaluation results, failures, provenance and filter at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 820 });
    await mockClaw(page);
    await page.route("**/aurax/evaluations", (route) => route.fulfill({ json: report() }));
    await page.goto("/");
    await page.getByRole("button", { name: "评测", exact: true }).click();
    await expect(page.getByText("50%", { exact: true })).toBeVisible();
    await expect(page.getByText("100%", { exact: true })).toBeVisible();
    await expect(page.getByText("1 / 2 次计划尝试成功")).toBeVisible();
    const tau = page.locator(".evaluation-card").filter({ has: page.getByRole("heading", { name: "τ-bench", exact: true }) });
    await tau.locator("summary").click();
    await expect(tau.getByText("任务未通过", { exact: true })).toBeVisible();
    await expect(tau.getByText("c".repeat(40), { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByLabel("基准", { exact: true }).selectOption("appworld");
    await expect(page.locator(".evaluation-card")).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "AppWorld", exact: true })).toBeVisible();
  });
}
test("missing, invalid, empty and refreshed reports stay distinct", async ({ page }) => {
  await mockClaw(page);
  let mode = "missing";
  await page.route("**/aurax/evaluations", (route) => {
    if (mode === "missing") return route.fulfill({ status: 404, json: { message: "尚未配置评测报告" } });
    if (mode === "invalid") return route.fulfill({ json: { schema_version: 9 } });
    if (mode === "empty") return route.fulfill({ json: { ...report(), runs: [] } });
    const value = report(); value.runs[0].attempts.pop();
    return route.fulfill({ json: value });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "评测", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("尚未接入");
  mode = "invalid";
  await page.getByRole("button", { name: "刷新报告" }).click();
  await expect(page.getByRole("alert")).toContainText("格式无效");
  mode = "empty";
  await page.getByRole("button", { name: "刷新报告" }).click();
  await expect(page.getByText("暂无已发布的评测结果。")).toBeVisible();
  mode = "partial";
  await page.getByRole("button", { name: "刷新报告" }).click();
  await expect(page.getByText("样本未跑完，缺 1 次", { exact: false })).toBeVisible();
  await expect(page.getByText("50%", { exact: true })).toHaveCount(0);
});
