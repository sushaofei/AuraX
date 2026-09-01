import { expect, test } from "@playwright/test";
import { mockClaw } from "./mock-claw";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
});

test("shell shows AuraX and mock identity, not an account switcher", async ({ page }) => {
  await mockClaw(page);
  await page.goto("/");
  await expect(page.getByText("AuraX", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("关窗不会取消任务")).toBeVisible();
  await expect(page.locator(".rail .meta")).toContainText("platform");
  await expect(page.locator(".rail .meta")).toContainText("local-org / local-user");
  await expect(page.getByRole("combobox")).toHaveCount(0);
});

test("critical views load without hitting internal APIs or AuraMCP", async ({ page }) => {
  const traffic = await mockClaw(page);
  const forbidden: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/internal/v1") || url.includes(":8020") || url.includes("auramcp")) {
      forbidden.push(url);
    }
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "对话" })).toBeVisible();
  await expect(page.getByText("model.output.delta")).toBeVisible();

  await page.getByRole("button", { name: "任务" }).click();
  await expect(page.getByRole("heading", { name: "任务" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "异步 202 + wait" })).toBeVisible();
  await expect(page.locator(".view-panel:not(.view-hidden) .skill-picker-label")).toBeVisible();

  await page.getByRole("button", { name: "历史" }).click();
  await expect(page.getByRole("heading", { name: "历史" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "对话" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "任务" })).toBeVisible();

  await page.getByRole("button", { name: "MCP" }).click();
  await expect(page.getByLabel("认证方式")).toBeVisible();
  await expect(page.getByPlaceholder("credential_ref（必填引用，不是明文）")).toBeVisible();
  await page.getByLabel("认证方式").selectOption("none");
  await expect(page.getByPlaceholder("credential_ref（必填引用，不是明文）")).toHaveCount(0);
  await expect(page.locator("input[type=password]")).toHaveCount(0);

  await page.getByRole("button", { name: "Skill" }).click();
  await expect(page.getByRole("tab", { name: "Catalog" })).toBeVisible();
  await expect(page.getByText("发布已签名 Skill 包（小包）")).toBeVisible();
  await expect(page.getByText("AuraX 不执行或签名 Skill")).toBeVisible();

  await page.getByRole("button", { name: "连接" }).click();
  await expect(page.getByText("X-Tenant-ID: platform")).toBeVisible();
  await expect(page.getByText("界面不能切换账号")).toBeVisible();

  expect(forbidden).toEqual([]);
  expect(traffic.paths.some((path) => path.includes("/internal/"))).toBe(false);
});

test("skill uninstall refreshes the selected revision before force escalation", async ({ page }) => {
  const traffic = await mockClaw(page, { skillLifecycle: true });
  page.on("dialog", async (dialog) => {
    await dialog.accept(dialog.type() === "prompt" ? "e2e_uninstall" : undefined);
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Skill" }).click();
  await page.getByRole("button", { name: /acme\/revision-demo/ }).click();
  await expect(page.getByText("disabled / rev 2")).toBeVisible();

  await page.getByRole("button", { name: "卸载（draining）" }).click();
  await expect(page.getByText("draining / rev 3")).toBeVisible();
  await expect(page.getByRole("button", { name: "卸载（draining）" })).toHaveCount(0);

  await page.getByRole("button", { name: "强制卸载" }).click();
  await expect(page.getByText("uninstalled / rev 4")).toBeVisible();
  await expect(page.getByRole("button", { name: "重新安装" })).toBeVisible();
  expect(traffic.skillExpectedRevisions).toEqual(["2", "3"]);
});

test("creating a chat session does not cancel when leaving the view", async ({ page }) => {
  const traffic = await mockClaw(page);
  await page.goto("/");
  await page.getByPlaceholder("要 AuraClaw 做什么？").fill("介绍 AuraClaw");
  await page.getByRole("button", { name: "开始" }).click();
  await expect(page.locator(".session-meta")).toContainText("ses_e2e");
  await page.getByRole("button", { name: "历史" }).click();
  await expect(page.getByRole("heading", { name: "历史" })).toBeVisible();
  expect(traffic.cancels).toBe(0);
});

test("chat view renders streaming delta from SSE", async ({ page }) => {
  await mockClaw(page);
  await page.goto("/");
  await page.getByPlaceholder("要 AuraClaw 做什么？").fill("介绍 AuraClaw");
  await page.getByRole("button", { name: "开始" }).click();
  await expect(page.getByText("流式")).toBeVisible();
});

test("task view async trigger shows authoritative result", async ({ page }) => {
  await mockClaw(page);
  await page.goto("/");
  await page.getByRole("button", { name: "任务" }).click();
  await page.getByPlaceholder("POST /v1/tasks goal").fill("介绍 AuraClaw");
  await page.getByRole("button", { name: "异步触发" }).click();
  await expect(page.locator(".session-meta")).toContainText("ses_e2e");
  await expect(page.locator(".result-card strong")).toContainText("权威结果");
  await expect(page.getByText("AuraClaw 是 Managed Agent 控制面。")).toBeVisible();
});

test("task view sync invoke mode", async ({ page }) => {
  await mockClaw(page);
  await page.goto("/");
  await page.getByRole("button", { name: "任务" }).click();
  await page.getByRole("tab", { name: "同步 /tasks/sync" }).click();
  await page.getByPlaceholder("POST /v1/tasks/sync goal").fill("sync goal");
  await page.getByRole("button", { name: "同步调用" }).click();
  await expect(page.getByText("ses_sync")).toBeVisible();
  await expect(page.getByText("同步调用结果")).toBeVisible();
});

test("execution trace folds product activity and can be filtered and collapsed", async ({ page }) => {
  await mockClaw(page);
  await page.goto("/");
  await page.getByRole("button", { name: "任务" }).click();
  await page.getByPlaceholder("POST /v1/tasks goal").fill("介绍 AuraClaw");
  await page.getByRole("button", { name: "异步触发" }).click();
  await page.getByRole("button", { name: /执行轨迹/ }).click();

  const trace = page.getByLabel("对话执行轨迹");
  await expect(trace).toBeVisible();
  await expect(trace.getByText("Run · run_e2e")).toBeVisible();
  await expect(trace.getByRole("button", { name: /auramcp\.about\.auraclaw/ })).toBeVisible();

  await trace.getByRole("button", { name: "能力" }).click();
  await expect(trace.getByRole("button", { name: /product-answer/ })).toBeVisible();
  await expect(trace.getByText("Model input")).toHaveCount(0);

  await trace.getByRole("button", { name: /auramcp\.about\.auraclaw/ }).click();
  await expect(trace.getByText('"server_id": "auramcp"')).toBeVisible();

  await trace.getByRole("button", { name: "收起执行轨迹" }).click();
  await expect(trace).toBeHidden();
  await page.getByRole("button", { name: /执行轨迹/ }).click();
  await expect(trace).toBeVisible();
});

test("approval refreshes the task version and shows submission feedback", async ({ page }) => {
  const traffic = await mockClaw(page, { approval: true });
  await page.goto("/");
  await page.getByPlaceholder("要 AuraClaw 做什么？").fill("调用工具");
  await page.getByRole("button", { name: "开始" }).click();
  await expect(page.getByText("待人审")).toBeVisible();

  await page.getByRole("button", { name: "批准" }).click();

  await expect(page.getByText("审批已提交，等待 Runtime 恢复…")).toBeVisible();
  expect(traffic.approvals).toBe(1);
  expect(traffic.approvalExpectedVersions).toEqual(["21"]);
});
