import { describe, expect, it } from "vitest";
import { identityHeaders, MOCK_IDENTITY } from "./identity.js";
import { ClawClient } from "./client.js";

describe("mock identity", () => {
  it("keeps tenant, org and user as three distinct values", () => {
    expect(MOCK_IDENTITY.tenantId).toBe("platform");
    expect(MOCK_IDENTITY.deptId).toBe("local-org");
    expect(MOCK_IDENTITY.userId).toBe("local-user");
    expect(new Set(Object.values(MOCK_IDENTITY)).size).toBe(3);
  });

  it("injects AuraClaw development headers", () => {
    expect(identityHeaders()).toEqual({
      "X-Tenant-ID": "platform",
      "X-Dept-ID": "local-org",
      "X-Actor-ID": "local-user",
    });
  });
});

describe("ClawClient", () => {
  it("does not put identity into the task body", async () => {
    let captured: { url: string; headers: Headers; body: string | null } | undefined;
    const client = new ClawClient({
      baseUrl: "http://claw.example",
      fetch: (async (input, init) => {
        captured = {
          url: String(input),
          headers: new Headers(init?.headers),
          body: typeof init?.body === "string" ? init.body : null,
        };
        return new Response(
          JSON.stringify({ session_id: "ses_1", run_id: "run_1", status: "pending" }),
          { status: 202, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch,
    });
    await client.request("POST", "/v1/tasks", {
      json: { goal: "hello", source: "chat" },
      idempotencyKey: "task:test",
    });
    expect(captured?.headers.get("X-Tenant-ID")).toBe("platform");
    expect(captured?.headers.get("X-Dept-ID")).toBe("local-org");
    expect(captured?.headers.get("X-Actor-ID")).toBe("local-user");
    expect(captured?.headers.get("Idempotency-Key")).toBe("task:test");
    expect(captured?.body).toBe(JSON.stringify({ goal: "hello", source: "chat" }));
    expect(captured?.body).not.toContain("tenant_id");
  });

  it("resolves empty baseUrl against a local origin", async () => {
    let capturedUrl: string | undefined;
    const client = new ClawClient({
      baseUrl: "",
      fetch: (async (input) => {
        capturedUrl = String(input);
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    await client.request("GET", "/v1/tasks");
    expect(capturedUrl).toBe("http://127.0.0.1:8080/v1/tasks");
  });

  it("does not invoke platform fetch as a method on ClawClient", async () => {
    const native = globalThis.fetch;
    const seenThis: unknown[] = [];
    globalThis.fetch = function windowFetch(this: unknown) {
      seenThis.push(this);
      if (this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    } as typeof fetch;
    try {
      const client = new ClawClient({ baseUrl: "http://claw.example" });
      await client.request("GET", "/v1/tasks");
      expect(seenThis).toEqual([globalThis]);
    } finally {
      globalThis.fetch = native;
    }
  });
});
