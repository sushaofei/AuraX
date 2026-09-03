import { expect, test } from "@playwright/test";
import { mockClaw } from "./mock-claw";

test("Skill upgrade shows cleanup progress and no old version history", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await mockClaw(page);
  let phase = "draining";
  const upgrade = () => ({ operation_id: "upgrade", current_version: "2.0.0", generation: 2,
    phase, reason_code: phase === "blocked" ? "skill_package_legal_hold" : null });
  const skill = () => ({ publisher: "acme", name: "upgrade-demo", version: "2.0.0", status: "active",
    description: "升级测试", risk_level: "low", package_digest: "sha256:current",
    required_tools: [], required_resources: [], required_skills: [], availability: "available",
    installation: { status: "active", revision: 2, version_constraint: "=2.0.0" }, upgrade: upgrade() });
  await page.route("**/v1/admin/skills?*", (route) => route.fulfill({ json: { items: [skill()], skills: [skill()] } }));
  await page.route("**/v1/admin/skills/acme/upgrade-demo", (route) => route.fulfill({ json: { ...skill(), skill_markdown: "# Current Skill" } }));
  await page.route("**/v1/admin/skills/acme/upgrade-demo/management", (route) => route.fulfill({ json: {
    publisher: "acme", name: "upgrade-demo", upgrade: upgrade(), versions: ["1.0.0", "2.0.0"].map((version) => ({
      publication: { version, status: version === "2.0.0" ? "active" : "revoked", updated_at: "2026-09-03" },
      package: { retention_status: "retained", legal_hold: false },
    })),
  } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Skill", exact: true }).click();
  const skills = page.locator(".skill-admin");
  await skills.getByRole("button", { name: /acme\/upgrade-demo/ }).click();
  await expect(skills.getByText("新版本已切换，正在等待旧版本任务结束。结束后自动卸载并删除旧版本。")).toBeVisible();
  await expect(skills.locator(".governance-row")).toHaveCount(1);
  await expect(skills.locator(".governance-row")).toContainText("v2.0.0");
  for (const [next, message] of [
    ["deleting", "新版本已切换，正在删除旧版本及其包文件。"],
    ["blocked", "旧版本清理暂未完成，系统会继续重试。请刷新状态查看进展。"],
    ["completed", "升级完成，旧版本及其包文件已删除。"],
  ]) {
    phase = next!;
    await skills.getByRole("button", { name: "刷新清理状态" }).click();
    await expect(skills.getByText(message!, { exact: true })).toBeVisible();
  }
  await page.screenshot({ path: "/tmp/aurax-skill-upgrade-complete.png", fullPage: true });
});
