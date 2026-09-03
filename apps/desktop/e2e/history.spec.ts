import { expect, test } from "@playwright/test";
import { historyOrigin, matchesHistoryStatus } from "../src/lib/session-history";
import { mockClaw } from "./mock-claw";

test("history distinguishes Session state from the most recent Run", () => {
  for (const status of ["ready", "closed"]) {
    expect(matchesHistoryStatus({ status, run_status: "completed" }, "done")).toBe(true);
    expect(matchesHistoryStatus({ status, run_status: "failed" }, "failed")).toBe(true);
    expect(matchesHistoryStatus({ status, run_status: "cancelled" }, "cancelled")).toBe(true);
    expect(matchesHistoryStatus({ status, run_status: "completed" }, "live")).toBe(false);
  }
  expect(matchesHistoryStatus({ status: "closed", run_status: "completed" }, "closed")).toBe(true);
  expect(matchesHistoryStatus({ status: "closed", run_status: "running" }, "live")).toBe(false);
  expect(matchesHistoryStatus({ status: "running", run_status: "running" }, "live")).toBe(true);
  expect(matchesHistoryStatus({ status: "ready", run_status: null }, "done")).toBe(false);
  expect(matchesHistoryStatus({ status: "completed", run_status: null }, "done")).toBe(true);
  expect(matchesHistoryStatus({ status: "waiting_for_human", run_status: "running" }, "hitl")).toBe(true);
  expect(matchesHistoryStatus({ status: "waiting_for_human", run_status: "running" }, "live")).toBe(false);
  expect(matchesHistoryStatus({ status: "paused", run_status: "running" }, "paused")).toBe(true);
  expect(historyOrigin(null)).toBe("unknown");
});

const task = (id: string, status: string, runStatus: string | null) => ({
  tenant_id: "1", session_id: id, root_session_id: id, run_id: `run_${id}`,
  status, run_status: runStatus, goal: id, source: "chat", schedule_id: null,
  occurrence_id: null, progress: 1, current_stage: "done", result_summary: null,
  result_ref: null, artifact_refs: [], error: null, projection_version: 2,
  projected_at: "2026-09-02T10:00:00Z",
});

test("history keeps completed and failed records visible without browser-local type metadata", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await mockClaw(page);
  const rows = [task("closed-success", "closed", "completed"), task("ready-success", "ready", "completed"), task("ready-failure", "ready", "failed")];
  await page.route("**/v1/tasks?*", (route) => route.fulfill({ json: { tasks: rows, next_cursor: null } }));
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: "历史" }).click();
  const archive = page.locator(".archive");
  await expect(archive.locator(".item")).toHaveCount(3);
  await archive.getByRole("tablist", { name: "按状态筛选" }).getByRole("tab", { name: "已完成", exact: true }).click();
  await expect(archive.locator(".item")).toHaveCount(2);
  await archive.getByRole("tab", { name: "失败", exact: true }).click();
  await expect(archive.locator(".item")).toHaveCount(1);
  await expect(archive.getByRole("button", { name: /ready-failure/ })).toBeVisible();
  await archive.getByRole("tab", { name: "任务", exact: true }).click();
  await expect(archive.getByText("当前筛选没有匹配记录，历史数据仍在。")).toBeVisible();
  await archive.getByRole("button", { name: "查看未分类记录" }).click();
  await expect(archive.locator(".item")).toHaveCount(3);
  await archive.getByRole("tab", { name: "已关闭", exact: true }).click();
  await expect(archive.locator(".item")).toHaveCount(1);
  await page.reload();
  await page.locator("nav").getByRole("button", { name: "历史" }).click();
  await expect(archive.locator(".item")).toHaveCount(3);
});

test("history paginates, refreshes and never reuses another identity's cached list", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await mockClaw(page);
  let fail = false;
  await page.route("**/v1/tasks?*", (route) => {
    if (fail) return route.fulfill({ status: 503, json: { code: "unavailable", message: "测试连接中断" } });
    const tenant = route.request().headers()["x-tenant-id"];
    if (tenant === "other") return route.fulfill({ json: { tasks: [], next_cursor: null } });
    const more = new URL(route.request().url()).searchParams.has("cursor");
    return route.fulfill({ json: { tasks: [task(more ? "older-success" : "recent-failure", "ready", more ? "completed" : "failed")], next_cursor: more ? null : "page2" } });
  });
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: "历史" }).click();
  const archive = page.locator(".archive");
  await archive.getByRole("tab", { name: "已完成", exact: true }).click();
  await archive.getByRole("button", { name: "加载更多历史" }).click();
  await expect(archive.getByRole("button", { name: /older-success/ })).toBeVisible();
  await expect(archive.getByRole("button", { name: "加载更多历史" })).toHaveCount(0);
  fail = true;
  await archive.getByRole("button", { name: "刷新历史" }).click();
  await expect(archive.getByRole("alert")).toContainText("测试连接中断");
  await expect(archive.getByText("当前租户暂无交互主会话历史。请核对测试身份。")).toHaveCount(0);
  fail = false;
  await page.locator("nav").getByRole("button", { name: "配置" }).click();
  await page.getByLabel("租户 ID").fill("other");
  await page.getByRole("button", { name: "保存测试身份" }).click();
  await page.locator("nav").getByRole("button", { name: "历史" }).click();
  await expect(archive.locator(".item")).toHaveCount(0);
  await expect(archive.getByText("当前租户暂无交互主会话历史。请核对测试身份。")).toBeVisible();
});
