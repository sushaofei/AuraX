import { expect, test, type Locator } from "@playwright/test";
import { mockClaw } from "./mock-claw";

// Verify actual rendered foreground/background pairs, not only theme token values.
async function contrast(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const luminance = (color: string) => {
      const channels = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map((value) => {
        const normalized = value / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
    };
    const style = getComputedStyle(element);
    let background = style.backgroundColor;
    let parent = element.parentElement;
    while (background === "rgba(0, 0, 0, 0)" && parent) {
      background = getComputedStyle(parent).backgroundColor;
      parent = parent.parentElement;
    }
    const foreground = luminance(style.color);
    const behind = luminance(background);
    return (Math.max(foreground, behind) + 0.05) / (Math.min(foreground, behind) + 0.05);
  });
}

test("warm paper theme keeps product surfaces and primary controls legible", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => window.localStorage.clear());
  await mockClaw(page, { skillLifecycle: true, quarantinedCatalog: true });
  await page.goto("/");
  await expect(page.locator(".stage")).toHaveCSS("background-color", "rgb(244, 239, 231)");
  await expect(page.locator(".stage")).toHaveCSS("background-image", "none");
  expect(await contrast(page.locator("nav button.active"))).toBeGreaterThanOrEqual(4.5);
  expect(await contrast(page.locator(".rail .meta"))).toBeGreaterThanOrEqual(4.5);
  await page.getByPlaceholder("要 AuraClaw 做什么？").fill("介绍 AuraClaw");
  await page.getByRole("button", { name: "开始" }).click();
  const trace = page.locator("#chat-execution-trace");
  await expect(trace).toBeVisible();
  await expect(trace).toHaveCSS("background-color", "rgb(35, 33, 31)");
  expect(await contrast(trace)).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: "/tmp/aurax-warm-chat.png" });

  for (const view of ["任务", "历史", "MCP", "Skill", "配置"]) {
    await page.locator("nav").getByRole("button", { name: view, exact: true }).click();
    expect(await contrast(page.locator("nav button.active"))).toBeGreaterThanOrEqual(4.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (view === "MCP") {
      await expect(page.locator(".mcp-server-list")).toBeVisible();
      await expect(page.locator(".mcp-server-list")).toHaveCSS("background-color", "rgb(252, 250, 246)");
      await page.screenshot({ path: "/tmp/aurax-warm-mcp.png" });
    }
    if (view === "Skill") {
      const publish = page.getByRole("button", { name: "＋ 发布 Skill" });
      expect(await contrast(publish)).toBeGreaterThanOrEqual(4.5);
      await publish.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(publish).toBeFocused();
      await expect(publish).toHaveCSS("outline-style", "solid");
      await expect(page.locator(".skill-row-list")).toBeVisible();
      await page.screenshot({ path: "/tmp/aurax-warm-skill.png" });
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("nav button.active")).toHaveCSS("transition-duration", "0s");
});
