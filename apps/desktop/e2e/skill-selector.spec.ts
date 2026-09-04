import { expect, test } from "@playwright/test";
import { mockClaw } from "./mock-claw";

for (const availability of ["installation_version_mismatch", "dependencies_unavailable"]) {
  test(`enabled Skill exposes ${availability} and toggles by installation state`, async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await mockClaw(page);
    let status = "active";
    let revision = 5;
    const actions: string[] = [];
    await page.route(/\/v1\/admin\/skills(?:\?.*)?$/, (route) => route.fulfill({ json: {
      items: [{ publisher: "acme", name: "price-insight-deviation", version: "2.0.0",
        status: "active", description: "价格分析", risk_level: "low", package_digest: "sha256:current",
        availability: status === "active" ? availability : "installation_disabled",
        installation: { status, revision, version_constraint: "=1.0.0" },
        required_tools: [], required_resources: [], required_skills: [] }],
    } }));
    await page.route(/\/v1\/admin\/skills\/acme\/price-insight-deviation:(enable|disable)/, async (route) => {
      const action = new URL(route.request().url()).pathname.split(":").at(-1)!;
      actions.push(action);
      expect(route.request().headers()["x-expected-revision"]).toBe(String(revision));
      status = action === "disable" ? "disabled" : "active";
      revision += 1;
      await route.fulfill({ json: { installation: { status, revision } } });
    });
    await page.goto("/");
    const view = page.locator(".view-panel:not(.view-hidden)");
    const chip = view.getByRole("button", { name: /price-insight-deviation/ });
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(chip).toContainText("已启用 · 不可用");
    await expect(view.getByText(availability === "installation_version_mismatch"
      ? /当前发布 2.0.0，安装绑定 =1.0.0/ : /依赖不可用，请到 Skill 管理页检查依赖/)).toBeVisible();
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    await expect(chip).toContainText("关");
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(chip).toContainText("已启用 · 不可用");
    expect(actions).toEqual(["disable", "enable"]);
  });
}
