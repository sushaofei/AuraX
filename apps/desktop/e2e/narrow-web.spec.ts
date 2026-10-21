import { expect, test } from "@playwright/test";
import { mockClaw } from "./mock-claw";

for (const width of [390, 760]) {
  test(`web remains readable with an open trace at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 820 });
    await mockClaw(page);
    await page.goto("/");
    await page.getByPlaceholder("要 AuraClaw 做什么？").fill("窄窗口布局验证");
    await page.getByRole("button", { name: "开始", exact: true }).click();
    const trace = page.locator("#chat-execution-trace");
    await expect(trace).toBeVisible();
    await expect(trace.getByRole("separator")).toBeHidden();
    const checkOverflow = async () => {
      expect(await page.locator(".stage").evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      )).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    };
    await checkOverflow();
    const content = await page.locator(".view-panel:not(.view-hidden) .bench").boundingBox();
    const details = await trace.boundingBox();
    expect(content).not.toBeNull();
    expect(details!.y).toBeGreaterThanOrEqual(content!.y + content!.height);
    expect(details!.width).toBeLessThanOrEqual(width);
    for (const view of ["任务", "历史", "MCP", "Skill", "配置"]) {
      await page.locator("nav").getByRole("button", { name: view, exact: true }).click();
      await checkOverflow();
    }
  });
}
