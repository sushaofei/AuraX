import { type Page } from "@playwright/test";

export type ClawTraffic = {
  paths: string[];
  cancels: number;
  approvals: number;
  approvalExpectedVersions: string[];
  skillExpectedRevisions: string[];
  skillForces: boolean[];
};

export async function mockClaw(
  page: Page,
  options: {
    approval?: boolean;
    failedChat?: boolean;
    quarantinedCatalog?: boolean;
    skillLifecycle?: boolean;
  } = {},
): Promise<ClawTraffic> {
  const traffic: ClawTraffic = {
    paths: [],
    cancels: 0,
    approvals: 0,
    approvalExpectedVersions: [],
    skillExpectedRevisions: [],
    skillForces: [],
  };
  let taskReads = 0;
  let e2eTaskReads = 0;
  let e2eTranscriptReads = 0;
  let skillStatus = "disabled";
  let skillRevision = 2;

  const installation = () => ({
    publisher: "acme",
    name: "revision-demo",
    version_constraint: "=1.0.0",
    pinned_package_digest: "sha256:e2e",
    status: skillStatus,
    source_id: null,
    auto_upgrade: false,
    revision: skillRevision,
    reason_code: null,
    uninstall_action: skillStatus === "draining" ? "continue" : skillStatus === "uninstalled" ? "cancel" : null,
    uninstall_policy_version: skillStatus === "disabled" ? null : "skill-uninstall-v1",
    uninstall_policy_decision_id: skillStatus === "disabled" ? null : "e2e-uninstall",
    updated_by: "local-user",
    updated_at: "2026-09-01T00:00:00Z",
  });
  const catalogSkill = () => ({
    publisher: "acme",
    name: "revision-demo",
    version: "1.0.0",
    latest_version: "1.0.0",
    status: "active",
    description: "Revision lifecycle regression fixture",
    risk_level: "low",
    package_digest: "sha256:e2e",
    required_tools: [],
    required_resources: [],
    required_skills: [],
    installation: installation(),
    availability: `installation_${skillStatus}`,
  });

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
      await json({ skills: options.skillLifecycle ? [catalogSkill()] : [] });
      return;
    }
    if (options.skillLifecycle && url.pathname === "/v1/admin/skills/acme/revision-demo") {
      await json({ ...catalogSkill(), skill_markdown: "# Revision demo" });
      return;
    }
    if (options.skillLifecycle && url.pathname === "/v1/admin/skills/acme/revision-demo/management") {
      await json({
        publisher: "acme",
        name: "revision-demo",
        installation: installation(),
        versions: [
          {
            publication: {
              publisher: "acme",
              name: "revision-demo",
              version: "1.0.0",
              package_digest: "sha256:e2e",
              status: "revoked",
              source_id: null,
              revision: 2,
              reason_code: "e2e_revoke",
              revocation_action: "cancel",
              revocation_policy_version: "skill-revocation-v1",
              revocation_policy_decision_id: "e2e-revoke",
              updated_by: "local-user",
              updated_at: "2026-09-01T00:00:00Z",
            },
            package: {
              publisher: "acme",
              name: "revision-demo",
              version: "1.0.0",
              package_digest: "sha256:e2e",
              retention_status: "retained",
              retention_until: "2099-01-01T00:00:00Z",
              legal_hold: false,
              retention_revision: 1,
              retention_updated_by: "local-user",
              retention_updated_at: "2026-09-01T00:00:00Z",
              purged_at: null,
            },
          },
        ],
      });
      return;
    }
    if (
      options.skillLifecycle &&
      url.pathname === "/v1/admin/skills/acme/revision-demo:uninstall"
    ) {
      traffic.skillExpectedRevisions.push(
        route.request().headers()["x-expected-revision"] ?? "",
      );
      const force = url.searchParams.get("force") === "true";
      traffic.skillForces.push(force);
      skillStatus = force ? "uninstalled" : "draining";
      skillRevision += 1;
      await json({ installation: installation() }, 202);
      return;
    }
    if (url.pathname === "/v1/admin/mcp-servers") {
      await json({
        servers: options.quarantinedCatalog
          ? [
              {
                server_id: "chaintowermcp",
                desired_state: "enabled",
                latest_revision: 2,
                latest_config: { title: "ChainTowerMCP" },
                runtime: { observed_state: "active", safe_error_code: null },
                catalog_publication: {
                  active_generation: 624,
                  status: "quarantined",
                  stale: true,
                  last_sync_error: "CapabilitySchemaDriftError",
                },
              },
            ]
          : [],
      });
      return;
    }
    if (url.pathname === "/v1/tasks" && route.request().method() === "GET") {
      await json({ tasks: [], next_cursor: null });
      return;
    }
    if (url.pathname === "/v1/tasks/sync" && route.request().method() === "POST") {
      await json({
        session_id: "ses_sync",
        status: "completed",
        wait_outcome: "completed",
        result_summary: "同步调用结果",
        status_url: "/v1/tasks/ses_sync",
        result_url: "/v1/tasks/ses_sync/result",
        stream_url: "/v1/streams/ses_sync",
      });
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
    if (url.pathname === "/v1/tasks/ses_e2e/result") {
      await json({
        session_id: "ses_e2e",
        status: "completed",
        wait_outcome: "completed",
        result_summary: "AuraClaw 是 Managed Agent 控制面。",
      });
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
    if (url.pathname === "/v1/tasks/ses_approval/activity") {
      await json({
        session_id: "ses_approval",
        projection_version: 21,
        source_version: 21,
        next_after_version: 21,
        has_more: false,
        nodes: [
          activityNode(1, "run", "waiting", "Run run_approval", "run_approval"),
          activityNode(2, "tool", "waiting", "auramcp.about.auraclaw", "run_approval", {
            source: "mcp",
            server_id: "auramcp",
          }),
          activityNode(3, "approval", "waiting", "等待人工审批", "run_approval"),
        ],
      });
      return;
    }
    if (url.pathname === "/v1/tasks/ses_e2e") {
      e2eTaskReads += 1;
      const running = !options.failedChat && e2eTaskReads < 4;
      await json({
        tenant_id: "platform",
        session_id: "ses_e2e",
        root_session_id: "ses_e2e",
        run_id: "run_e2e",
        status: running ? "running" : "ready",
        run_status: running ? "running" : options.failedChat ? "failed" : "completed",
        goal: "介绍 AuraClaw",
        source: "chat",
        schedule_id: null,
        occurrence_id: null,
        progress: running ? 0.4 : 1,
        current_stage: running ? "model" : options.failedChat ? "failed" : "done",
        result_summary: running ? null : "AuraClaw 是 Managed Agent 控制面。",
        result_ref: null,
        artifact_refs: [],
        error: options.failedChat
          ? { code: "not_found", message: "Skill Tool dependency is unavailable" }
          : null,
        projection_version: 2,
        projected_at: "2026-08-25T04:13:04Z",
      });
      return;
    }
    if (url.pathname === "/v1/tasks/ses_e2e/transcript") {
      e2eTranscriptReads += 1;
      const running = e2eTranscriptReads < 4;
      await json({
        session_id: "ses_e2e",
        projection_version: 2,
        status: running ? "running" : "ready",
        run_status: running ? "running" : "completed",
        messages: running
          ? [{ role: "user", content: "介绍 AuraClaw" }]
          : [
              { role: "user", content: "介绍 AuraClaw" },
              { role: "assistant", content: "**AuraClaw** 是控制面。" },
            ],
        pending_approval: null,
      });
      return;
    }
    if (url.pathname === "/v1/tasks/ses_e2e/activity") {
      await json({
        session_id: "ses_e2e",
        projection_version: 12,
        source_version: 12,
        next_after_version: 12,
        has_more: false,
        nodes: [
          activityNode(1, "user_prompt", "completed", "User prompt", null),
          activityNode(2, "run", "completed", "Run run_e2e", "run_e2e"),
          activityNode(3, "model_input", "completed", "Model input", "run_e2e", {
            message_count: 1,
            input_digest: "sha256:e2e",
          }),
          activityNode(4, "skill", "completed", "product-answer", "run_e2e", {
            skill_version: "1.0.0",
          }),
          activityNode(5, "tool", "completed", "auramcp.about.auraclaw", "run_e2e", {
            source: "mcp",
            server_id: "auramcp",
          }),
          activityNode(6, "model_output", "completed", "Model output", "run_e2e"),
        ],
      });
      return;
    }
    if (url.pathname.startsWith("/v1/streams/")) {
      const deltaPayload = JSON.stringify({
        event_id: "rte_e2e_1",
        session_id: "ses_e2e",
        run_id: "run_e2e",
        sequence: 1,
        type: "model.output.delta",
        payload: { delta: "流式" },
        visibility: "user",
      });
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `event: model.output.delta\ndata: ${deltaPayload}\n\n`,
      });
      return;
    }

    await json({ message: "unmocked" }, 404);
  });

  return traffic;
}

function activityNode(
  sequence: number,
  type: string,
  status: string,
  title: string,
  runId: string | null,
  detail: unknown = {},
) {
  return {
    id: `activity-${type}-${sequence}`,
    type,
    status,
    title,
    summary: `${title} summary`,
    sequence,
    updated_version: sequence,
    run_id: runId,
    started_at: `2026-08-25T04:13:${String(sequence).padStart(2, "0")}Z`,
    completed_at: status === "completed" ? `2026-08-25T04:13:${String(sequence).padStart(2, "0")}Z` : null,
    duration_ms: status === "completed" ? 120 : null,
    detail,
    correlation: { event_ids: [`evt-${sequence}`] },
  };
}
