import { describe, expect, it } from "vitest";
import { ClawApiError } from "./errors.js";
import { ClawClient } from "./client.js";
import { createMcpServer, inferMcpNetworkMode, listMcpTools, mcpLifecycle, saveMcpServer, updateMcpServer } from "./mcp.js";

function jsonResponse(body: unknown, status = 202): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("inferMcpNetworkMode", () => {
  it("uses loopback for Credential Proxy localhost aliases", () => {
    expect(inferMcpNetworkMode("http://127.0.0.1:8020/mcp")).toBe("loopback");
    expect(inferMcpNetworkMode("http://localhost:8020/mcp")).toBe("loopback");
    expect(inferMcpNetworkMode("http://[::1]:8020/mcp")).toBe("loopback");
    expect(inferMcpNetworkMode("  http://127.0.0.1:8020/mcp  ")).toBe("loopback");
  });

  it("uses private for RFC1918 and link-local addresses", () => {
    expect(inferMcpNetworkMode("http://10.244.16.131:48088/rpc-api/agent-runtime/mcp")).toBe(
      "private",
    );
    expect(inferMcpNetworkMode("http://192.168.1.10/mcp")).toBe("private");
    expect(inferMcpNetworkMode("http://172.16.0.5/mcp")).toBe("private");
    expect(inferMcpNetworkMode("http://169.254.10.1/mcp")).toBe("private");
  });

  it("keeps public for remote HTTPS endpoints", () => {
    expect(inferMcpNetworkMode("https://mcp.example/mcp")).toBe("public");
    expect(inferMcpNetworkMode("https://auramcp.internal/mcp")).toBe("public");
  });

  it("does not treat 0.0.0.0 as loopback", () => {
    expect(inferMcpNetworkMode("http://0.0.0.0:8020/mcp")).toBe("public");
  });
});

describe("createMcpServer", () => {
  it("sends loopback when the endpoint is local AuraMCP", async () => {
    let body: string | null = null;
    const client = new ClawClient({
      baseUrl: "http://claw.example",
      fetch: (async (_input, init) => {
        body = typeof init?.body === "string" ? init.body : null;
        return jsonResponse({ server_id: "auramcp", desired_state: "disabled", latest_revision: 1 });
      }) as typeof fetch,
    });
    await createMcpServer(client, {
      server_id: "auramcp",
      title: "AuraMCP extensions",
      endpoint: "http://127.0.0.1:8020/mcp",
      auth_strategy: "workload_trusted_context",
      credential_ref: "vault/auramcp#workload",
      allowed_tool_prefixes: ["auramcp."],
    });
    expect(JSON.parse(body ?? "{}")).toMatchObject({
      endpoint: "http://127.0.0.1:8020/mcp",
      network_mode: "loopback",
      credential_ref: "vault/auramcp#workload",
    });
  });

  it("omits credential_ref for auth_strategy none", async () => {
    let body: string | null = null;
    const client = new ClawClient({
      baseUrl: "http://claw.example",
      fetch: (async (_input, init) => {
        body = typeof init?.body === "string" ? init.body : null;
        return jsonResponse({
          server_id: "local-smoke-mcp",
          desired_state: "disabled",
          latest_revision: 1,
        });
      }) as typeof fetch,
    });
    await createMcpServer(client, {
      server_id: "local-smoke-mcp",
      title: "Local Smoke MCP",
      endpoint: "http://127.0.0.1:48080/mcp",
      auth_strategy: "none",
      allowed_tool_prefixes: ["demo."],
    });
    const payload = JSON.parse(body ?? "{}");
    expect(payload).toMatchObject({
      endpoint: "http://127.0.0.1:48080/mcp",
      network_mode: "loopback",
      auth_strategy: "none",
    });
    expect(payload.credential_ref).toBeUndefined();
  });

  it("registers private endpoints with allowed_cidrs for auth_strategy none", async () => {
    let body: string | null = null;
    const client = new ClawClient({
      baseUrl: "http://claw.example",
      fetch: (async (_input, init) => {
        body = typeof init?.body === "string" ? init.body : null;
        return jsonResponse({
          server_id: "chaintowermcp_runtime_test",
          desired_state: "disabled",
          latest_revision: 1,
        });
      }) as typeof fetch,
    });
    await createMcpServer(client, {
      server_id: "chaintowermcp_runtime_test",
      title: "ChainTowerMCPRuntimeTest",
      endpoint: "http://10.244.16.131:48088/rpc-api/agent-runtime/mcp",
      protocol_revision: "2025-06-18",
      auth_strategy: "none",
      allowed_tool_prefixes: ["price_insight."],
    });
    expect(JSON.parse(body ?? "{}")).toMatchObject({
      endpoint: "http://10.244.16.131:48088/rpc-api/agent-runtime/mcp",
      network_mode: "private",
      auth_strategy: "none",
      allowed_cidrs: ["10.244.16.131/32"],
    });
  });

  it("sends an explicit protocol_revision", async () => {
    let body: string | null = null;
    const client = new ClawClient({
      baseUrl: "http://claw.example",
      fetch: (async (_input, init) => {
        body = typeof init?.body === "string" ? init.body : null;
        return jsonResponse({
          server_id: "chaintower_mcp",
          desired_state: "disabled",
          latest_revision: 1,
        });
      }) as typeof fetch,
    });
    await createMcpServer(client, {
      server_id: "chaintower_mcp",
      title: "ChainTower MCP",
      endpoint: "http://127.0.0.1:48088/rpc-api/agent-runtime/mcp",
      protocol_revision: "2025-06-18",
      auth_strategy: "none",
      allowed_tool_prefixes: ["price_insight."],
    });
    expect(JSON.parse(body ?? "{}").protocol_revision).toBe("2025-06-18");
  });

  it("keeps an explicit network_mode", async () => {
    let body: string | null = null;
    const client = new ClawClient({
      baseUrl: "http://claw.example",
      fetch: (async (_input, init) => {
        body = typeof init?.body === "string" ? init.body : null;
        return jsonResponse({ server_id: "github-mcp", desired_state: "disabled", latest_revision: 1 });
      }) as typeof fetch,
    });
    await createMcpServer(client, {
      server_id: "github-mcp",
      title: "GitHub MCP",
      endpoint: "https://mcp.example/mcp",
      network_mode: "public",
      credential_ref: "vault/github#token",
    });
    expect(JSON.parse(body ?? "{}").network_mode).toBe("public");
  });
});

describe("updateMcpServer", () => {
  it("sends PUT with the current revision", async () => {
    let method: string | undefined;
    let url: string | undefined;
    let body: string | null = null;
    let expectedRevision: string | null = null;
    const client = new ClawClient({
      baseUrl: "http://claw.example",
      fetch: (async (input, init) => {
        method = init?.method;
        url = String(input);
        body = typeof init?.body === "string" ? init.body : null;
        const headers = init?.headers;
        expectedRevision =
          headers instanceof Headers
            ? headers.get("X-Expected-Revision")
            : ((headers as Record<string, string> | undefined)?.["X-Expected-Revision"] ??
              null);
        return jsonResponse({
          server_id: "chaintower_mcp",
          desired_state: "disabled",
          latest_revision: 2,
        });
      }) as typeof fetch,
    });
    await updateMcpServer(
      client,
      "chaintower_mcp",
      {
        title: "ChainTower MCP",
        endpoint: "http://127.0.0.1:48088/rpc-api/agent-runtime/mcp",
        protocol_revision: "2025-06-18",
        auth_strategy: "none",
        allowed_tool_prefixes: ["price_insight."],
      },
      1,
    );
    expect(method).toBe("PUT");
    expect(url).toBe("http://claw.example/v1/admin/mcp-servers/chaintower_mcp");
    expect(expectedRevision).toBe("1");
    expect(JSON.parse(body ?? "{}")).toMatchObject({
      protocol_revision: "2025-06-18",
      auth_strategy: "none",
    });
    expect(JSON.parse(body ?? "{}").server_id).toBeUndefined();
  });
});

describe("saveMcpServer", () => {
  it("updates an existing server instead of posting again", async () => {
    let method: string | undefined;
    const client = new ClawClient({
      baseUrl: "http://claw.example",
      fetch: (async (_input, init) => {
        method = init?.method;
        return jsonResponse({
          server_id: "chaintower_mcp",
          desired_state: "disabled",
          latest_revision: 2,
        });
      }) as typeof fetch,
    });
    await saveMcpServer(
      client,
      {
        server_id: "chaintower_mcp",
        title: "ChainTower MCP",
        endpoint: "http://127.0.0.1:48088/rpc-api/agent-runtime/mcp",
        protocol_revision: "2025-06-18",
        auth_strategy: "none",
        allowed_tool_prefixes: ["price_insight."],
      },
      {
        server_id: "chaintower_mcp",
        desired_state: "disabled",
        latest_revision: 1,
      },
    );
    expect(method).toBe("PUT");
  });

  it("creates when the server_id is new", async () => {
    let method: string | undefined;
    const client = new ClawClient({
      baseUrl: "http://claw.example",
      fetch: (async (_input, init) => {
        method = init?.method;
        return jsonResponse({
          server_id: "new-mcp",
          desired_state: "disabled",
          latest_revision: 1,
        });
      }) as typeof fetch,
    });
    await saveMcpServer(
      client,
      {
        server_id: "new-mcp",
        title: "New MCP",
        endpoint: "http://127.0.0.1:8020/mcp",
        auth_strategy: "none",
        allowed_tool_prefixes: ["demo."],
      },
      undefined,
    );
    expect(method).toBe("POST");
  });

  it("creates when the existing server is retired", async () => {
    let method: string | undefined;
    const client = new ClawClient({
      baseUrl: "http://claw.example",
      fetch: (async (_input, init) => {
        method = init?.method;
        return jsonResponse({
          server_id: "old-mcp",
          desired_state: "disabled",
          latest_revision: 3,
        });
      }) as typeof fetch,
    });
    await saveMcpServer(
      client,
      {
        server_id: "old-mcp",
        title: "Old MCP",
        endpoint: "http://127.0.0.1:8020/mcp",
        auth_strategy: "none",
        allowed_tool_prefixes: ["demo."],
      },
      {
        server_id: "old-mcp",
        desired_state: "retired",
        latest_revision: 2,
      },
    );
    expect(method).toBe("POST");
  });
});

describe("listMcpTools", () => {
  it("reads the catalog tools path for a registered server", async () => {
    let capturedUrl: string | undefined;
    const client = new ClawClient({
      baseUrl: "http://claw.example",
      fetch: (async (input) => {
        capturedUrl = String(input);
        return jsonResponse(
          {
            server_id: "auramcp",
            tools: [{ canonical_name: "auramcp.health.ping", title: "ping" }],
          },
          200,
        );
      }) as typeof fetch,
    });
    const response = await listMcpTools(client, "auramcp");
    expect(capturedUrl).toBe("http://claw.example/v1/admin/mcp-servers/auramcp/tools");
    expect(response.body.tools[0]?.canonical_name).toBe("auramcp.health.ping");
  });
});

describe("mcpLifecycle", () => {
  it("treats HTTP 202 with status failed as an error", async () => {
    const client = new ClawClient({
      baseUrl: "http://claw.example",
      fetch: (async () =>
        jsonResponse({
          operation_id: "op-1",
          server_id: "auramcp",
          operation: "test",
          status: "failed",
          safe_error_code: "mcp_connection_test_failed",
        })) as typeof fetch,
    });
    await expect(mcpLifecycle(client, "auramcp", "test", 1)).rejects.toMatchObject({
      name: "ClawApiError",
      code: "mcp_connection_test_failed",
      message: "MCP test 失败",
      status: 202,
    });
    await expect(mcpLifecycle(client, "auramcp", "test", 1)).rejects.toBeInstanceOf(ClawApiError);
  });

  it("includes result.error_type in the failure message", async () => {
    const client = new ClawClient({
      baseUrl: "http://claw.example",
      fetch: (async () =>
        jsonResponse({
          operation_id: "op-1",
          server_id: "auramcp",
          operation: "test",
          status: "failed",
          safe_error_code: "auraclaw_error",
          result: { error_type: "CredentialAccessError" },
        })) as typeof fetch,
    });
    await expect(mcpLifecycle(client, "auramcp", "test", 1)).rejects.toMatchObject({
      code: "auraclaw_error",
      message: "MCP test 失败 (CredentialAccessError)",
    });
  });

  it("includes result.error_message in the failure message", async () => {
    const client = new ClawClient({
      baseUrl: "http://claw.example",
      fetch: (async () =>
        jsonResponse({
          operation_id: "op-1",
          server_id: "auramcp",
          operation: "test",
          status: "failed",
          safe_error_code: "auraclaw_error",
          result: {
            error_type: "AuraClawError",
            error_message: "internal contract call failed with HTTP 500",
          },
        })) as typeof fetch,
    });
    await expect(mcpLifecycle(client, "auramcp", "test", 1)).rejects.toMatchObject({
      message:
        "MCP test 失败 (AuraClawError: internal contract call failed with HTTP 500)",
    });
  });

  it("returns the operation when status is succeeded", async () => {
    const client = new ClawClient({
      baseUrl: "http://claw.example",
      fetch: (async () =>
        jsonResponse({
          operation_id: "op-2",
          server_id: "auramcp",
          operation: "test",
          status: "succeeded",
        })) as typeof fetch,
    });
    const response = await mcpLifecycle(client, "auramcp", "test", 1);
    expect(response.body.status).toBe("succeeded");
  });
});
