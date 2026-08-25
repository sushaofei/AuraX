import { type Page } from "@playwright/test";

export type ClawTraffic = {
  paths: string[];
  cancels: number;
  approvals: number;
  approvalExpectedVersions: string[];
};

export async function mockClaw(
  page: Page,
  options: { approval?: boolean } = {},
): Promise<ClawTraffic> {
  const traffic: ClawTraffic = {
    paths: [],
    cancels: 0,
    approvals: 0,
    approvalExpectedVersions: [],
  };
  let taskReads = 0;

  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    traffic.paths.push(`${route.request().method()} ${url.pathname}`);
    if (url.pathname.endsWith("/cancel")) {
      traffic.cancels += 1;
    }
    if (url.pathname.endsWith("/approvals/apr_e2e/responses")) {
      traffic.approvals += 1;
      traffic.approvalExpectedVersions.push(
        route.request().headers()["x-expected-version"] ?? "",
      );
      await json(
        {
          session_id: "ses_approval",
          run_id: "run_approval",
          status: "runnable",
          run_status: "runnable",
        },
        202,
      );
      return;
    }

    if (url.pathname === "/v1/admin/skills") {
      await json({ skills: [] });
      return;
    }
    if (url.pathname === "/v1/admin/mcp-servers") {
      await json({ servers: [] });
      return;
    }
    if (url.pathname === "/v1/tasks" && route.request().method() === "GET") {
      await json({ tasks: [], next_cursor: null });
      return;
    }
    if (url.pathname === "/v1/tasks" && route.request().method() === "POST") {
      const approval = Boolean(options.approval);
      await json(
        {
          session_id: approval ? "ses_approval" : "ses_e2e",
          run_id: approval ? "run_approval" : "run_e2e",
          status: "pending",
          status_url: `/v1/tasks/${approval ? "ses_approval" : "ses_e2e"}`,
          result_url: `/v1/tasks/${approval ? "ses_approval" : "ses_e2e"}/result`,
          stream_url: `/v1/streams/${approval ? "ses_approval" : "ses_e2e"}`,
        },
        202,
      );
      return;
    }
    if (url.pathname === "/v1/tasks/ses_approval") {
      taskReads += 1;
      await json({
        tenant_id: "platform",
        session_id: "ses_approval",
        root_session_id: "ses_approval",
        run_id: "run_approval",
        status: "waiting_for_human",
        run_status: "waiting_for_human",
        goal: "调用工具",
        source: "chat",
        schedule_id: null,
        occurrence_id: null,
        progress: 0,
        current_stage: "waiting_for_human",
        result_summary: null,
        result_ref: null,
        artifact_refs: [],
        error: null,
        projection_version: taskReads === 1 ? 20 : 21,
        projected_at: "2026-08-25T04:13:04Z",
      });
      return;
    }
    if (url.pathname === "/v1/tasks/ses_approval/transcript") {
      await json({
        session_id: "ses_approval",
        projection_version: 21,
        status: "waiting_for_human",
        run_status: "waiting_for_human",
        messages: [{ role: "user", content: "调用工具" }],
        pending_approval: {
          approval_id: "apr_e2e",
          tool_name: "auramcp.about.auraclaw",
          reason: "write-with-approval action requires human approval",
          status: "waiting",
        },
      });
      return;
    }
    if (url.pathname === "/v1/tasks/ses_e2e") {
      await json({
        tenant_id: "platform",
        session_id: "ses_e2e",
        root_session_id: "ses_e2e",
        run_id: "run_e2e",
        status: "ready",
        run_status: "completed",
        goal: "介绍 AuraClaw",
        source: "chat",
        schedule_id: null,
        occurrence_id: null,
        progress: 1,
        current_stage: "done",
        result_summary: "AuraClaw 是 Managed Agent 控制面。",
        result_ref: null,
        artifact_refs: [],
        error: null,
        projection_version: 2,
        projected_at: "2026-08-25T04:13:04Z",
      });
      return;
    }
    if (url.pathname === "/v1/tasks/ses_e2e/transcript") {
      await json({
        session_id: "ses_e2e",
        projection_version: 2,
        status: "ready",
        run_status: "completed",
        messages: [
          { role: "user", content: "介绍 AuraClaw" },
          { role: "assistant", content: "**AuraClaw** 是控制面。" },
        ],
        pending_approval: null,
      });
      return;
    }
    if (url.pathname.startsWith("/v1/streams/")) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: "event: ping\ndata: {}\n\n",
      });
      return;
    }

    await json({ message: "unmocked" }, 404);
  });

  return traffic;
}
