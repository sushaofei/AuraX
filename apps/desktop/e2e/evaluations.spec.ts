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
    await expect(page.getByText("50.0%", { exact: true })).toBeVisible();
    await expect(page.getByText("100.0%", { exact: true })).toBeVisible();
    await expect(page.getByText("1 / 2 次尝试成功")).toBeVisible();
    const tau = page.locator(".evaluation-card").filter({ has: page.getByRole("heading", { name: "τ-bench", exact: true }) });
    const source = tau.getByRole("link", { name: "τ-bench 官方文档（新窗口）", exact: true });
    await expect(source).toHaveAttribute("href", "https://github.com/sierra-research/tau-bench");
    await expect(source).toHaveAttribute("target", "_blank");
    await expect(source).toHaveAttribute("rel", "noopener noreferrer");
    await tau.locator(".evaluation-samples summary").click();
    await expect(tau.getByText("任务未通过", { exact: true })).toBeVisible();
    await tau.locator(".evaluation-provenance summary").click();
    await expect(tau.getByText("c".repeat(40), { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByLabel("基准", { exact: true }).selectOption("appworld");
    await expect(page.locator(".evaluation-card")).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "AppWorld", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "AppWorld 官方文档（新窗口）", exact: true })).toHaveAttribute("href", "https://github.com/StonyBrookNLP/appworld");
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
  await expect(page.getByRole("alert")).toContainText("尚未发布");
  mode = "invalid";
  await page.getByRole("button", { name: "刷新报告" }).click();
  await expect(page.getByRole("alert")).toContainText("格式无效");
  mode = "empty";
  await page.getByRole("button", { name: "刷新报告" }).click();
  await expect(page.getByText("暂无已发布的评测结果。")).toBeVisible();
  mode = "partial";
  await page.getByRole("button", { name: "刷新报告" }).click();
  await expect(page.getByText("未完成 · 缺 1 次", { exact: false })).toBeVisible();
  await expect(page.getByText("50.0%", { exact: true })).toHaveCount(0);
});

test("E3 labels repeated holdouts and shows independently verified subset scene scores", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 820 });
  await mockClaw(page);
  const base = report().runs[1]!;
  const run = { ...base, protocol: "e3-heldout-v1", trials: 3, task_ids: ["family_1", "family_2", "family_3"],
    attempts: [1, 2, 3].flatMap((task) => [0, 1, 2].map((trial) => ({ ...base.attempts[0]!, task_id: `family_${task}`, trial,
      success: task < 3, official_reward: task < 3 ? 1 : 0 }))),
    official_metrics: [0, 1, 2].map((trial) => ({ trial, tasks: 3, scenarios: 1, task_goal_completion: 0.667, scenario_goal_completion: 0 })),
  };
  await page.route("**/aurax/evaluations", (route) => route.fulfill({ json: { ...report(), runs: [run] } }));
  await page.goto("/");
  await page.getByRole("button", { name: "评测", exact: true }).click();
  await expect(page.getByText("在多应用交互环境中", { exact: false })).toBeVisible();
  await expect(page.getByText("pass^3", { exact: false })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "TGC", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "66.7%", exact: true })).toHaveCount(3);
  await expect(page.getByText("6 / 9 次尝试成功")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("final scoring corrections are visible and never overwrite the original diagnostic", async ({ page }) => {
  await mockClaw(page);
  const base = report().runs[1]!;
  const run = { ...base, protocol: "e3-heldout-v1", trials: 3, scoring_basis: "post-close-official", scoring_adjustments: 6, verifier_revision: "a".repeat(40),
    task_ids: ["family_1", "family_2", "family_3"],
    attempts: [1, 2, 3].flatMap((task) => [0, 1, 2].map((trial) => ({ ...base.attempts[0]!, task_id: `family_${task}`, trial,
      success: task === 1, episode_success: true, official_reward: 1, independent_reward: task === 1 ? 1 : 0 }))),
    official_metrics: [0, 1, 2].map((trial) => ({ trial, tasks: 3, scenarios: 1, task_goal_completion: 0.333, scenario_goal_completion: 0 })),
  };
  await page.route("**/aurax/evaluations", (route) => route.fulfill({ json: { ...report(), schema_version: 2, runs: [run] } }));
  await page.goto("/");
  await page.getByRole("button", { name: "评测", exact: true }).click();
  await expect(page.getByText("3 / 9 次尝试成功")).toBeVisible();
  await expect(page.getByText("评分修订 · 6 次判定更正", { exact: false })).toBeVisible();
  await page.locator(".evaluation-samples summary").click();
  await expect(page.getByText("原始判定：成功 → 未通过", { exact: true })).toHaveCount(6);
});


test("primary cohorts and history remain separate without removing reports", async ({ page }) => {
  await mockClaw(page);
  const value = report();
  const prior = value.runs[0]!;
  const current = { ...prior, run_id: `eval_${"e".repeat(32)}`, protocol: "e3-heldout-v1", trials: 3,
    attempts: prior.attempts.flatMap((a) => [0, 1, 2].map((trial) => ({ ...a, trial }))) };
  await page.route("**/aurax/evaluations", (route) => route.fulfill({ json: { ...value, runs: [current, ...value.runs] } }));
  await page.goto("/");
  await page.getByRole("button", { name: "评测", exact: true }).click();
  await expect(page.getByRole("heading", { name: "τ-bench", exact: true })).toHaveCount(1);
  await expect(page.getByText("从真实运行结果了解 Agent", { exact: false })).toHaveCount(0);
  await page.locator(".evaluation-history > summary").click();
  await expect(page.getByRole("heading", { name: "τ-bench", exact: true })).toHaveCount(2);
  await page.getByLabel("基准", { exact: true }).selectOption("appworld");
  await expect(page.locator(".evaluation-history")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "AppWorld", exact: true })).toBeVisible();
});
