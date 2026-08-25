import { type Page } from "@playwright/test";

export type ClawTraffic = {
  paths: string[];
  cancels: number;
};

export async function mockClaw(page: Page): Promise<ClawTraffic> {
  const traffic: ClawTraffic = { paths: [], cancels: 0 };

  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    traffic.paths.push(`${route.request().method()} ${url.pathname}`);
    if (url.pathname.endsWith("/cancel")) {
      traffic.cancels += 1;
    }

    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

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
      await json(
        {
          session_id: "ses_e2e",
          run_id: "run_e2e",
          status: "pending",
          status_url: "/v1/tasks/ses_e2e",
          result_url: "/v1/tasks/ses_e2e/result",
          stream_url: "/v1/streams/ses_e2e",
        },
        202,
      );
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
