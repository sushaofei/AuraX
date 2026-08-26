import { describe, expect, it } from "vitest";
import { ClawClient } from "./client.js";
import { followUp, getActivity } from "./tasks.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("followUp", () => {
  it("appends a message then requests a new run at head+1", async () => {
    const calls: { url: string; method: string; version: string | null }[] = [];
    const client = new ClawClient({
      baseUrl: "http://claw.example",
      fetch: (async (input, init) => {
        const url = String(input);
        calls.push({
          url,
          method: init?.method ?? "GET",
          version: new Headers(init?.headers).get("X-Expected-Version"),
        });
        if (url.endsWith("/messages")) {
          return jsonResponse(
            { session_id: "ses_1", run_id: "run_old", status: "ready" },
            202,
          );
        }
        if (url.includes("/v1/tasks/ses_1")) {
          return jsonResponse({ session_id: "ses_1", projection_version: 7 });
        }
        if (url.endsWith("/runs")) {
          return jsonResponse(
            { session_id: "ses_1", run_id: "run_new", status: "pending" },
            202,
          );
        }
        return jsonResponse({ message: "unexpected" }, 500);
      }) as typeof fetch,
    });

    const result = await followUp(client, "ses_1", "介绍下你自己", 7, "ready");
    expect(result.body.run_id).toBe("run_new");
    expect(calls.map((call) => `${call.method} ${call.url} v=${call.version}`)).toEqual([
      "POST http://claw.example/v1/sessions/ses_1/messages v=7",
      "GET http://claw.example/v1/tasks/ses_1 v=null",
      "POST http://claw.example/v1/sessions/ses_1/runs v=8",
    ]);
  });

  it("does not request a run while the session cannot accept one", async () => {
    const methods: string[] = [];
    const client = new ClawClient({
      baseUrl: "http://claw.example",
      fetch: (async (input, init) => {
        methods.push(`${init?.method ?? "GET"} ${String(input)}`);
        return jsonResponse(
          { session_id: "ses_1", run_id: "run_1", status: "pending" },
          202,
        );
      }) as typeof fetch,
    });
    await followUp(client, "ses_1", "later", 4, "pending");
    expect(methods).toEqual(["POST http://claw.example/v1/sessions/ses_1/messages"]);
  });
});

describe("getActivity", () => {
  it("uses the canonical aggregate-version cursor", async () => {
    let requested = "";
    const client = new ClawClient({
      baseUrl: "http://claw.example",
      fetch: (async (input) => {
        requested = String(input);
        return jsonResponse({
          session_id: "ses_1",
          projection_version: 8,
          source_version: 9,
          nodes: [],
          next_after_version: 9,
          has_more: false,
        });
      }) as typeof fetch,
    });

    const result = await getActivity(client, "ses_1", { afterVersion: 7, limit: 50 });
    expect(requested).toBe(
      "http://claw.example/v1/tasks/ses_1/activity?after_version=7&limit=50",
    );
    expect(result.body.next_after_version).toBe(9);
  });
});
