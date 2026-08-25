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
  await expect(page.getByPlaceholder("credential_ref（必填引用，不是明文）")).toBeVisible();
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
