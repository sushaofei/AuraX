import { expect, test } from "@playwright/test";
import { mockClaw } from "./mock-claw";

test("Skill detail distinguishes pending, error, empty and retained content", async ({ page }) => {
  await mockClaw(page, { skillLifecycle: true });
  let markdown = "# Initial description";
  let failed = false;
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let first = true;
  await page.route("**/v1/admin/skills/acme/revision-demo", async (route) => {
    if (first) { first = false; await pending; }
    if (failed) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "unavailable", message: "Description temporarily unavailable" }) });
      return;
    }
    await route.fulfill({ json: { publisher: "acme", name: "revision-demo", skill_markdown: markdown } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Skill", exact: true }).click();
  await page.getByRole("button", { name: /acme\/revision-demo/ }).click();
  await expect(page.getByText("正在加载说明…")).toBeVisible();
  await expect(page.getByText("此技能未提供 SKILL.md。")).toHaveCount(0);
  release!();
  await expect(page.getByRole("heading", { name: "Initial description" })).toBeVisible();
  failed = true;
  await page.getByRole("button", { name: "刷新说明", exact: true }).click();
  await expect(page.getByRole("button", { name: "重试加载说明" })).toBeEnabled({ timeout: 15000 });
  await expect(page.getByRole("alert")).toContainText("503");
  await expect(page.getByRole("heading", { name: "Initial description" })).toBeVisible();
  await expect(page.getByText("此技能未提供 SKILL.md。")).toHaveCount(0);
  failed = false;
  markdown = "";
  await page.getByRole("button", { name: "重试加载说明" }).click();
  await expect(page.getByText("此技能未提供 SKILL.md。")).toBeVisible();
  markdown = "# Recovered description";
  await page.getByRole("button", { name: "刷新说明", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Recovered description" })).toBeVisible();
});

test("two independent clients can refresh the same updated Skill description", async ({ browser }) => {
  let markdown = "# Version one";
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    for (const page of pages) {
      await mockClaw(page, { skillLifecycle: true });
      await page.route("**/v1/admin/skills/acme/revision-demo", (route) => route.fulfill({ json: { publisher: "acme", name: "revision-demo", skill_markdown: markdown } }));
      await page.goto("http://127.0.0.1:1420/");
      await page.getByRole("button", { name: "Skill", exact: true }).click();
      await page.getByRole("button", { name: /acme\/revision-demo/ }).click();
      await expect(page.getByRole("heading", { name: "Version one" })).toBeVisible();
    }
    markdown = "# Version two";
    for (const page of pages) {
      await page.getByRole("button", { name: "刷新说明", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Version two" })).toBeVisible();
    }
  } finally { await Promise.all(contexts.map((context) => context.close())); }
});

test("publishing a directory strips its root and refreshes an already cached description", async ({ page }) => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = await mkdtemp(join(tmpdir(), "aurax-skill-test-"));
  const directory = join(root, "revision-demo");
  await mkdir(join(directory, "references"), { recursive: true });
  await writeFile(join(directory, "manifest.json"), JSON.stringify({ publisher: "acme", name: "revision-demo", version: "1.0.0" }));
  await writeFile(join(directory, "SKILL.md"), "# Published description");
  await writeFile(join(directory, "references", "tools.md"), "Tool reference");
  try {
    await mockClaw(page, { skillLifecycle: true });
    let published = false;
    let fileKeys: string[] = [];
    await page.route("**/v1/admin/skills/acme/revision-demo", (route) => route.fulfill({ json: { publisher: "acme", name: "revision-demo", skill_markdown: published ? "# Published description" : "# Cached description" } }));
    await page.route("**/v1/admin/skill-publications", async (route) => {
      fileKeys = Object.keys(route.request().postDataJSON().files);
      published = true;
      await route.fulfill({ json: { publisher: "acme", name: "revision-demo" } });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Skill", exact: true }).click();
    await page.getByRole("button", { name: /acme\/revision-demo/ }).click();
    await expect(page.getByRole("heading", { name: "Cached description" })).toBeVisible();
    await page.getByRole("button", { name: "发布新版本", exact: true }).click();
    await page.getByLabel("包目录").setInputFiles(directory);
    await page.getByRole("button", { name: "确认发布", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Published description" })).toBeVisible();
    expect(fileKeys.sort()).toEqual(["SKILL.md", "manifest.json", "references/tools.md"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
