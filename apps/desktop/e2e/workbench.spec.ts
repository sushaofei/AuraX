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
  await expect(page.getByText("允许使用的 Skill")).toBeVisible();

  await page.getByRole("button", { name: "历史" }).click();
  await expect(page.getByRole("heading", { name: "历史" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "全部" })).toBeVisible();

  await page.getByRole("button", { name: "MCP" }).click();
  await expect(page.getByLabel("认证方式")).toBeVisible();
  await expect(page.getByPlaceholder("credential_ref（必填引用，不是明文）")).toBeVisible();
  await page.getByLabel("认证方式").selectOption("none");
  await expect(page.getByPlaceholder("credential_ref（必填引用，不是明文）")).toHaveCount(0);
  await expect(page.locator("input[type=password]")).toHaveCount(0);

  await page.getByRole("button", { name: "Skill" }).click();
  await expect(page.getByText("没有发布入口")).toBeVisible();

  await page.getByRole("button", { name: "连接" }).click();
  await expect(page.getByText("X-Tenant-ID: platform")).toBeVisible();
  await expect(page.getByText("界面不能切换账号")).toBeVisible();

  expect(forbidden).toEqual([]);
  expect(traffic.paths.some((path) => path.includes("/internal/"))).toBe(false);
});

test("creating a chat session does not cancel when leaving the view", async ({ page }) => {
  const traffic = await mockClaw(page);
  await page.goto("/");
  await page.getByPlaceholder("要 AuraClaw 做什么？").fill("介绍 AuraClaw");
  await page.getByRole("button", { name: "开始" }).click();
  await expect(page.getByText("ses_e2e")).toBeVisible();
  await page.getByRole("button", { name: "历史" }).click();
  await expect(page.getByRole("heading", { name: "历史" })).toBeVisible();
  expect(traffic.cancels).toBe(0);
});

test("execution trace folds product activity and can be filtered and collapsed", async ({ page }) => {
  await mockClaw(page);
  await page.goto("/");
  await page.getByPlaceholder("要 AuraClaw 做什么？").fill("介绍 AuraClaw");
  await page.getByRole("button", { name: "开始" }).click();
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
