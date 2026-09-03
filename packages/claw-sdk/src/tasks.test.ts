import { describe, expect, it } from "vitest";
import { ClawClient } from "./client.js";
import { getResult, syncInvokeTask } from "./tasks.js";

describe("getResult", () => {
  it("passes wait and timeout_seconds query params", async () => {
    const urls: string[] = [];
    const client = new ClawClient({
      baseUrl: "http://claw.example",
      fetch: (async (input) => {
        urls.push(String(input));
        return new Response(
          JSON.stringify({
            session_id: "ses_1",
            status: "completed",
            result_summary: "done",
            wait_outcome: "completed",
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    });

    const { body, status } = await getResult(client, "ses_1", {
      wait: true,
      timeoutSeconds: 90,
    });
    expect(status).toBe(200);
    expect(body.result_summary).toBe("done");
    expect(urls[0]).toContain("wait=true");
    expect(urls[0]).toContain("timeout_seconds=90");
  });
});

describe("syncInvokeTask", () => {
  it("posts goal and timeout to /v1/tasks/sync", async () => {
    let posted: unknown = null;
    const client = new ClawClient({
      baseUrl: "http://claw.example",
      fetch: (async (_input, init) => {
        posted = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            session_id: "ses_sync",
            status: "completed",
            wait_outcome: "completed",
            result_summary: "sync result",
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    });

    const { body } = await syncInvokeTask(client, {
      goal: "test goal",
      timeoutSeconds: 120,
    });
    expect(posted).toEqual({ goal: "test goal", timeout_seconds: 120 });
    expect(body.wait_outcome).toBe("completed");
    expect(body.result_summary).toBe("sync result");
  });
});

describe("approval modes", () => {
  it("serializes all explicit modes without changing the caller's interaction type", async () => {
    const { createTask } = await import("./tasks.js");
    const posts: unknown[] = [];
    const client = new ClawClient({ baseUrl: "http://claw.example", fetch: (async (_url, init) => {
      posts.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ session_id: "ses", status: "pending" }), { status: 202 });
    }) as typeof fetch });
    for (const approvalMode of ["request_approval", "auto_review", "full_access"] as const) {
      await createTask(client, { goal: "test", interactionMode: "non_streaming", approvalMode });
    }
    expect(posts).toEqual(["request_approval", "auto_review", "full_access"].map((approval_mode) => ({
      goal: "test", source: "chat", interaction_mode: "non_streaming", approval_mode,
    })));
  });

  it("returns recoverable human interruptions while preserving genuine conflicts", async () => {
    const client = new ClawClient({ baseUrl: "http://claw.example", fetch: (async () =>
      new Response(JSON.stringify({ code: "needs_human", session_id: "waiting", wait_outcome: "needs_human" }), { status: 409 })) as typeof fetch });
    const result = await syncInvokeTask(client, { goal: "test", approvalMode: "request_approval" });
    expect(result.status).toBe(409);
    expect(result.body.session_id).toBe("waiting");
    const conflict = new ClawClient({ baseUrl: "http://claw.example", fetch: (async () =>
      new Response(JSON.stringify({ code: "version_conflict" }), { status: 409 })) as typeof fetch });
    await expect(syncInvokeTask(conflict, { goal: "test" })).rejects.toMatchObject({ code: "version_conflict" });
  });

  it("keeps the same mode and command key across a bounded Run conflict retry", async () => {
    const { followUp } = await import("./tasks.js");
    const runs: { body: unknown; key: string | null }[] = [];
    const client = new ClawClient({ baseUrl: "http://claw.example", fetch: (async (url, init) => {
      if (String(url).endsWith("/runs")) {
        runs.push({ body: JSON.parse(String(init?.body)), key: new Headers(init?.headers).get("Idempotency-Key") });
        return new Response(JSON.stringify(runs.length === 1 ? { code: "version_conflict" } : { session_id: "s", run_id: "r" }), { status: runs.length === 1 ? 409 : 202 });
      }
      return new Response(JSON.stringify({ session_id: "s", status: "ready", projection_version: 8 }), { status: 200 });
    }) as typeof fetch });
    await followUp(client, "s", "next", 5, "ready", { approvalMode: "full_access" });
    expect(runs).toHaveLength(2);
    expect(runs[0]).toEqual(runs[1]);
    expect(runs[0]?.body).toEqual({ approval_mode: "full_access" });
  });
});
