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
