import { expect, test } from "@playwright/test";
import { mockClaw } from "./mock-claw";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("approval-test-init")) {
      localStorage.clear();
      sessionStorage.setItem("approval-test-init", "yes");
    }
  });
});

test("chat defaults to human approval and persists an explicit automatic review choice", async ({ page }) => {
  const traffic = await mockClaw(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const view = page.locator(".view-panel:not(.view-hidden)");
  await view.getByRole("button", { name: "审批模式：请求批准", exact: true }).click();
  await expect(page.getByRole("menuitemradio", { name: /帮我批准/ })).toBeVisible();
  await page.screenshot({ path: "/private/tmp/aurax-approval-menu.png" });
  await page.getByRole("menuitemradio", { name: /帮我批准/ }).click();
  await view.getByLabel("消息", { exact: true }).fill("审核后读取敏感报告");
  await view.getByRole("button", { name: "开始", exact: true }).click();
  await expect.poll(() => traffic.taskInputs.length).toBe(1);
  expect(traffic.taskInputs[0]).toMatchObject({ interaction_mode: "streaming", approval_mode: "auto_review" });
  await expect(view.getByRole("button", { name: "审批模式：帮我批准", exact: true })).toBeVisible();
  await page.reload();
  await expect(view.getByRole("button", { name: "审批模式：帮我批准", exact: true })).toBeVisible();
});

for (const trigger of ["async", "sync"] as const) {
  test(`${trigger} task defaults to full access and supports an explicit human override`, async ({ page }) => {
    const traffic = await mockClaw(page);
    await page.goto("/");
    await page.getByRole("button", { name: "任务", exact: true }).click();
    const view = page.locator(".view-panel:not(.view-hidden)");
    await expect(view.getByRole("button", { name: "审批模式：完全访问权限", exact: true })).toBeVisible();
    if (trigger === "sync") await page.getByRole("tab", { name: /同步/ }).click();
    await view.getByRole("button", { name: "审批模式：完全访问权限", exact: true }).click();
    await page.getByRole("menuitemradio", { name: /请求批准/ }).click();
    await view.getByLabel("任务目标").fill("执行需审批的操作");
    await view.getByRole("button", { name: trigger === "sync" ? "同步调用" : "异步触发", exact: true }).click();
    await expect.poll(() => traffic.taskInputs.length).toBe(1);
    expect(traffic.taskInputs[0]?.approval_mode).toBe("request_approval");
    if (trigger === "async") expect(traffic.taskInputs[0]?.interaction_mode).toBe("non_streaming");
  });
}

test("keyboard menu stays within a narrow viewport and legacy backend is explicit", async ({ page }) => {
  await mockClaw(page);
  await page.setViewportSize({ width: 760, height: 900 });
  await page.goto("/");
  const button = page.getByRole("button", { name: "审批模式：请求批准", exact: true });
  await button.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "审批模式：完全访问权限", exact: true }).first()).toBeFocused();
  await page.route("**/v1/approval-modes", route => route.fulfill({ status: 404, body: "{}" }));
  await page.reload();
  await expect(page.locator(".view-panel:not(.view-hidden)").getByRole("button", { name: "审批模式：当前服务不支持" })).toBeDisabled();
});
