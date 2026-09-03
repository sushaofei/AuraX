import { expect, test } from "@playwright/test";
import { mockClaw } from "./mock-claw";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
});

test("shell shows AuraX and the active test identity", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
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
  await expect(page.getByRole("heading", { name: "MCP 服务器", exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("搜索 MCP 服务器")).toBeVisible();
  await page.getByRole("button", { name: "添加服务器" }).first().click();
  await expect(page.getByRole("heading", { name: "连接至自定义 MCP" })).toBeVisible();
  await expect(page.getByLabel("允许的 Tool 前缀")).toHaveCount(0);
  await expect(page.getByLabel("认证方式")).toBeVisible();
  await expect(page.getByPlaceholder("credential_ref（必填引用，不是明文）")).toBeVisible();
  await page.getByLabel("认证方式").selectOption("none");
  await expect(page.getByPlaceholder("credential_ref（必填引用，不是明文）")).toHaveCount(0);
  await expect(page.locator("input[type=password]")).toHaveCount(0);

  await page.getByRole("button", { name: "Skill" }).click();
  await expect(page.getByRole("button", { name: "技能目录", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "＋ 发布 Skill" })).toBeVisible();
  await expect(page.getByText("AuraX 不执行或签名 Skill")).toBeVisible();

  await page.getByRole("button", { name: "配置" }).click();
  await expect(page.getByText("X-Tenant-ID: platform")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存测试身份" })).toBeVisible();

  expect(forbidden).toEqual([]);
  expect(traffic.paths.some((path) => path.includes("/internal/"))).toBe(false);
});

test("Skill catalog provides grouped navigation, focused details and responsive layout", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockClaw(page, { skillLifecycle: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Skill", exact: true }).click();
  const skills = page.locator(".skill-admin");
  await expect(skills.getByRole("heading", { name: "acme" })).toContainText("1 个技能");
  await expect(skills.getByText("选择一个 Skill 查看治理详情。")).toHaveCount(0);
  await skills.getByLabel("安装状态", { exact: true }).selectOption("active");
  await expect(skills.getByText("没有匹配的 Skill", { exact: true })).toBeVisible();
  await skills.getByLabel("安装状态", { exact: true }).selectOption("disabled");
  await skills.getByRole("button", { name: /acme\/revision-demo/ }).click();
  await expect(skills.getByRole("heading", { name: "技能说明", exact: true })).toBeVisible();
  await expect(skills.getByRole("heading", { name: "能力依赖", exact: true })).toBeVisible();
  await expect(skills.getByRole("heading", { name: "版本与治理", exact: true })).toBeVisible();
  await expect(skills.getByRole("heading", { name: "安装与状态", exact: true })).toBeVisible();
  await skills.locator(".skill-dependency summary").first().click();
  await expect(skills.getByText("未声明 Tool 依赖。")).toBeVisible();
  await page.screenshot({ path: "/tmp/aurax-skill-detail.png", fullPage: true });
  await page.setViewportSize({ width: 760, height: 1000 });
  await expect(skills.locator(".skill-summary")).toHaveCSS("position", "static");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await skills.getByRole("button", { name: "返回技能目录" }).click();
  await expect(skills.getByLabel("安装状态", { exact: true })).toHaveValue("disabled");
  await skills.getByRole("button", { name: "发布 Skill" }).click();
  await expect(skills.getByRole("heading", { name: "发布已签名 Skill 包" })).toBeVisible();
  await expect(skills.getByRole("button", { name: "确认发布" })).toBeDisabled();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await skills.getByRole("button", { name: "收起发布" }).click();
  await page.screenshot({ path: "/tmp/aurax-skill-catalog.png", fullPage: true });
});

test("Skill publisher and admission views expose structured states and safe actions", async ({ page }) => {
  await mockClaw(page);
  await page.route("**/v1/admin/skill-publishers", (route) => route.fulfill({ json: { publishers: [{ publisher: { publisher: "acme", display_name: "Acme 团队", status: "active", revision: 1 }, keys: [{ key_id: "signing-v1", algorithm: "Ed25519", status: "active", revision: 1 }] }] } }));
  await page.route("**/v1/admin/skill-admissions?*", (route) => route.fulfill({ json: { admissions: [{ admission_id: "adm_test", outcome: "rejected", stage: "signature", safe_error_code: "invalid_signature", content_policy_version: "v1", duration_ms: 12, occurred_at: "2026-09-03T00:00:00Z" }], next_cursor: null } }));
  await page.route("**/v1/admin/skill-admissions/metrics", (route) => route.fulfill({ json: { window: { hours: 24 }, metrics: [], alerts: [] } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Skill", exact: true }).click();
  const skills = page.locator(".skill-admin");
  await skills.getByRole("button", { name: "发布者", exact: true }).click();
  await skills.getByRole("button", { name: /Acme 团队/ }).click();
  await expect(skills.getByRole("heading", { name: "签名公钥", exact: true })).toBeVisible();
  await expect(skills.getByText("signing-v1", { exact: true })).toBeVisible();
  await expect(skills.getByRole("button", { name: "登记公钥", exact: true })).toBeDisabled();
  await skills.getByRole("button", { name: "返回发布者列表" }).click();
  await skills.getByRole("button", { name: "＋ 注册发布者" }).click();
  await expect(skills.getByRole("button", { name: "注册发布者", exact: true })).toBeDisabled();
  await skills.getByLabel("发布者标识", { exact: true }).fill("example");
  await skills.getByLabel("显示名称", { exact: true }).fill("示例团队");
  await expect(skills.getByRole("button", { name: "注册发布者", exact: true })).toBeEnabled();
  await skills.getByRole("button", { name: "准入审计", exact: true }).click();
  await expect(skills.getByText("暂无指标", { exact: true })).toBeVisible();
  await skills.locator(".skill-audit-record summary").click();
  await expect(skills.getByText("invalid_signature", { exact: true })).toBeVisible();
  await expect(skills.getByRole("button", { name: "下一页" })).toBeDisabled();
});

test("configured test identity is persisted and injected into AuraClaw requests", async ({ page }) => {
  const traffic = await mockClaw(page);
  await page.goto("/");
  await page.getByRole("button", { name: "配置" }).click();
  await page.getByLabel("租户 ID").fill("tenant-chain");
  await page.getByLabel("部门 ID").fill("dept-chain");
  await page.getByLabel("用户 ID").fill("user-chain");
  await page.getByRole("button", { name: "保存测试身份" }).click();

  await expect(page.locator(".rail .meta")).toContainText("tenant-chain");
  await expect(page.locator(".rail .meta")).toContainText("dept-chain / user-chain");
  await page.getByRole("button", { name: "历史" }).click();
  await expect(page.getByRole("heading", { name: "历史" })).toBeVisible();

  expect(
    traffic.identities.some(
      (identity) =>
        identity.tenantId === "tenant-chain" &&
        identity.deptId === "dept-chain" &&
        identity.userId === "user-chain",
    ),
  ).toBe(true);

  await expect
    .poll(() =>
      page.evaluate(() => window.localStorage.getItem("aurax.claw.testIdentity")),
    )
    .toBe(
      JSON.stringify({
        tenantId: "tenant-chain",
        deptId: "dept-chain",
        userId: "user-chain",
      }),
    );
});

test("MCP view exposes quarantined Catalog instead of only aggregate runtime state", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const traffic = await mockClaw(page, { quarantinedCatalog: true });
  await page.goto("/");
  await page.getByRole("button", { name: "MCP" }).click();

  await expect(page.getByPlaceholder("搜索 MCP 服务器")).toBeVisible();
  await expect(page.getByRole("button", { name: /ChainTowerMCP/ }).first()).toBeVisible();
  await expect(page.getByText(/能力目录已隔离/)).toBeVisible();
  await expect(page.getByText(/第 624 代 · 尚未更新/)).toBeVisible();
  await expect(page.getByText("能力定义已变更但版本未更新，请升级 MCP 能力版本后重新同步。")).toBeVisible();
  await expect(page.getByTitle("诊断代码：CapabilitySchemaDriftError")).toBeVisible();
  await expect(page.getByRole("switch", { name: "停用 ChainTowerMCP" })).toBeVisible();
  await page.getByRole("button", { name: "配置 ChainTowerMCP" }).click();
  await expect(page.getByRole("heading", { name: "配置 ChainTowerMCP" })).toBeVisible();
  await expect(page.getByLabel("允许的 Tool 前缀")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "同步目录" })).toBeVisible();
  await expect(page.getByRole("button", { name: "← 返回服务器" })).toBeVisible();
  await page.getByRole("button", { name: "查看能力" }).click();
  await expect(page.getByRole("tab", { name: "Tool 2" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Resource 1" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Prompt 1" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tool" })).toBeVisible();
  await expect(page.getByText("market", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /Get market quote/ }).click();
  const capability = page.locator(".mcp-capability-card").filter({
    hasText: "market.quote.get",
  });
  await expect(capability.getByText("只读", { exact: true })).toBeVisible();
  await expect(capability.getByText("已开启")).toBeVisible();
  await expect(capability.getByText("Input Schema", { exact: true })).toBeVisible();
  await expect(capability.getByText("Output Schema", { exact: true })).toBeVisible();
  await capability.getByRole("button", { name: "模拟检查" }).click();
  await expect.poll(() => traffic.mcpActions).toContain("test");
  await expect(capability.getByText(/连接、目录与 Schema 正常/)).toBeVisible();
  await capability.getByLabel("Get market quote 模拟 Input").fill(
    JSON.stringify({ symbol: "AAPL" }, null, 2),
  );
  await capability.getByLabel("Get market quote 期望 Output").fill(
    JSON.stringify({ status: "ok" }, null, 2),
  );
  await capability.getByRole("button", { name: "运行测试" }).click();
  await expect.poll(() => traffic.mcpCapabilityInputs).toContainEqual({ symbol: "AAPL" });
  await expect(capability.getByRole("status")).toContainText("测试通过");
  await expect(capability.getByRole("status")).toContainText("Schema 通过");
  await expect(capability.getByRole("status")).toContainText("期望 匹配");
  await expect(capability.getByText("123.45")).toBeVisible();
});

test("MCP capability catalog falls back to legacy tools when capabilities returns 404", async ({ page }) => {
  await mockClaw(page, {
    quarantinedCatalog: true,
    legacyMcpCapabilities: true,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "MCP" }).click();
  await page.getByRole("button", { name: "配置 ChainTowerMCP" }).click();
  await page.getByRole("button", { name: "查看能力" }).click();

  await expect(page.getByRole("status")).toContainText("已自动回退到旧版 Tool 目录");
  await expect(page.getByRole("tab", { name: "Tool 2" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Resource 0" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Prompt 0" })).toBeVisible();
  await expect(page.getByText(/HTTP 404/)).toHaveCount(0);
});

test("skill uninstall refreshes the selected revision before force escalation", async ({ page }) => {
  const traffic = await mockClaw(page, { skillLifecycle: true });
  const uninstallModes = ["graceful", "force"];
  page.on("dialog", async (dialog) => {
    if (dialog.type() !== "prompt") {
      await dialog.accept();
      return;
    }
    await dialog.accept(
      dialog.message().includes("卸载方式") || dialog.message().includes("正在等待")
        ? uninstallModes.shift()
        : "e2e_uninstall",
    );
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Skill" }).click();
  await page.getByRole("button", { name: /acme\/revision-demo/ }).click();
  await page.getByText("技术信息", { exact: true }).click();
  await expect(page.getByText("disabled / rev 2")).toBeVisible();
  await expect(page.getByRole("button", { name: "卸载", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "永久清理" })).toHaveCount(0);

  await page.getByRole("button", { name: "卸载", exact: true }).click();
  await expect(page.getByText("draining / rev 3")).toBeVisible();
  await expect(page.getByRole("button", { name: "卸载", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "永久清理" })).toHaveCount(0);

  await page.getByRole("button", { name: "卸载", exact: true }).click();
  await expect(page.getByText("uninstalled / rev 4")).toBeVisible();
  await expect(page.getByRole("button", { name: "重新安装" })).toBeVisible();
  await expect(page.getByRole("button", { name: "永久清理" })).toBeVisible();
  expect(traffic.skillExpectedRevisions).toEqual(["2", "3"]);
  expect(traffic.skillForces).toEqual([false, true]);

  await page.getByRole("button", { name: "对话" }).click();
  const chat = page.locator(".view-panel:not(.view-hidden)");
  await expect(chat.getByRole("button", { name: /revision-demo/ })).toHaveCount(0);
  await expect(chat.getByText("当前没有可用于对话的 Skill")).toBeVisible();
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
  expect(traffic.closes).toBe(0);
});

test("chat view renders streaming delta from SSE", async ({ page }) => {
  await mockClaw(page);
  await page.goto("/");
  await page.getByPlaceholder("要 AuraClaw 做什么？").fill("介绍 AuraClaw");
  await page.getByPlaceholder("要 AuraClaw 做什么？").press("Enter");
  await expect(page.getByText("流式")).toBeVisible();
});

test("failed chat run shows the current error separately from transcript history", async ({ page }) => {
  await mockClaw(page, { failedChat: true });
  await page.goto("/");
  await page.getByPlaceholder("要 AuraClaw 做什么？").fill("使用价格洞察 Skill");
  await page.getByRole("button", { name: "开始" }).click();

  const failure = page.locator(".run-failure");
  await expect(failure.getByText("本轮执行失败")).toBeVisible();
  await expect(failure.getByText("not_found")).toBeVisible();
  await expect(failure.getByText("Skill Tool dependency is unavailable")).toBeVisible();
  await expect(failure.getByText(/transcript 保留会话历史/)).toBeVisible();
});

test("chat execution trace is docked, resizable, and stores its width", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockClaw(page);
  await page.goto("/");
  await page.getByPlaceholder("要 AuraClaw 做什么？").fill("介绍 AuraClaw");
  await page.getByRole("button", { name: "开始" }).click();

  const trace = page.locator("#chat-execution-trace");
  const resizeHandle = trace.getByRole("separator", { name: "调整执行轨迹宽度" });
  const sessionOverview = trace.getByRole("region", { name: "实时状态" });
  await expect(trace).toBeVisible();
  await expect(sessionOverview).toBeVisible();
  await expect(sessionOverview.getByText("介绍 AuraClaw")).toBeVisible();
  await expect(sessionOverview.getByText("ses_e2e")).toBeVisible();
  await expect(sessionOverview.getByText("run_e2e")).toBeVisible();
  await expect(sessionOverview.getByRole("progressbar", { name: "Session 进度" })).toBeVisible();
  await expect(trace.locator(".trace-scroll .trace-session-overview")).toHaveCount(0);
  await expect(trace.locator(".trace-scroll")).toHaveCSS("overflow-y", "auto");
  expect(
    await sessionOverview.locator(".session-status-grid").evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns.split(" ").length,
    ),
  ).toBe(4);
  await expect(trace.getByText("Run · run_e2e")).toBeVisible();
  await expect(resizeHandle).toBeVisible();
  await expect(trace).toHaveCSS("position", "sticky");
  await expect(page.locator(".chat-scroll .chat-composer")).toHaveCount(0);
  await expect(page.locator(".view-panel:not(.view-hidden) .chat-composer")).toBeVisible();

  const chatBox = await page.locator(".view-panel:not(.view-hidden) .bench").boundingBox();
  const initialTraceBox = await trace.boundingBox();
  expect(chatBox).not.toBeNull();
  expect(initialTraceBox).not.toBeNull();
  expect(initialTraceBox!.x).toBeGreaterThanOrEqual(chatBox!.x + chatBox!.width);

  await resizeHandle.focus();
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(resizeHandle).toHaveAttribute("aria-valuenow", "400");
  await expect(trace).toHaveCSS("width", "400px");

  const handleBox = await resizeHandle.boundingBox();
  expect(handleBox).not.toBeNull();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + 80);
  await page.mouse.down();
  await page.mouse.move(handleBox!.x - 50, handleBox!.y + 80);
  await page.mouse.up();
  await expect(resizeHandle).toHaveAttribute("aria-valuenow", "456");
  await expect(trace).toHaveCSS("width", "456px");
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("aurax.ui.executionTraceWidth")))
    .toBe("456");
});

test("task view async trigger shows authoritative result", async ({ page }) => {
  const traffic = await mockClaw(page);
  await page.goto("/");
  await page.getByRole("button", { name: "任务" }).click();
  await page.getByPlaceholder("POST /v1/tasks goal").fill("介绍 AuraClaw");
  await page.getByRole("button", { name: "异步触发" }).click();
  await expect(page.locator(".session-meta")).toContainText("ses_e2e");
  await expect(page.locator(".result-card strong")).toContainText("权威结果");
  await expect(page.getByText("AuraClaw 是 Managed Agent 控制面。")).toBeVisible();
  await expect(page.getByRole("note").getByText("一次性任务")).toBeVisible();
  await expect(page.getByPlaceholder("POST /v1/tasks goal")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "追问" })).toHaveCount(0);
  expect(traffic.paths.filter((path) => path === "POST /v1/tasks")).toHaveLength(1);
  await expect.poll(() => traffic.closes).toBe(1);
  expect(traffic.closeReasons).toEqual(["task run reached terminal state"]);
  await expect(page.getByRole("note")).toContainText("Session 已自动结束");
  await page.getByRole("button", { name: "新建任务" }).click();
  await expect(page.getByPlaceholder("POST /v1/tasks goal")).toBeVisible();
});

test("task view sync invoke mode", async ({ page }) => {
  const traffic = await mockClaw(page);
  await page.goto("/");
  await page.getByRole("button", { name: "任务" }).click();
  await page.getByRole("tab", { name: "同步 /tasks/sync" }).click();
  await page.getByPlaceholder("POST /v1/tasks/sync goal").fill("sync goal");
  await page.getByRole("button", { name: "同步调用" }).click();
  await expect(page.locator(".result-card").getByText(/ses_sync/)).toBeVisible();
  await expect(page.locator(".result-card").getByText("同步调用结果")).toBeVisible();
  await expect.poll(() => traffic.closes).toBe(1);
  expect(traffic.closeReasons).toEqual(["task run reached terminal state"]);
  await expect(page.getByRole("note")).toContainText("Session 已自动结束");
});

test("execution trace folds product activity and can be filtered and collapsed", async ({ page }) => {
  await mockClaw(page);
  await page.goto("/");
  await page.getByRole("button", { name: "任务" }).click();
  await page.getByPlaceholder("POST /v1/tasks goal").fill("介绍 AuraClaw");
  await page.getByRole("button", { name: "异步触发" }).click();

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
