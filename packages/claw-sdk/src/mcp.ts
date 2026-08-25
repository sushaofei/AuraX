import type { ClawClient } from "./client.js";
import { ClawApiError, newIdempotencyKey } from "./errors.js";
import type {
  McpLifecycleAction,
  McpOperationRecord,
  McpServerRecord,
  McpToolList,
} from "./types.js";

export function listMcpServers(client: ClawClient) {
  return client.request<{ servers: McpServerRecord[] }>("GET", "/v1/admin/mcp-servers");
}

export function getMcpServer(client: ClawClient, serverId: string) {
  return client.request<McpServerRecord>("GET", `/v1/admin/mcp-servers/${serverId}`);
}

export function listMcpTools(client: ClawClient, serverId: string) {
  return client.request<McpToolList>("GET", `/v1/admin/mcp-servers/${serverId}/tools`);
}

export type McpNetworkMode = "public" | "private" | "loopback";

export type McpAuthStrategy =
  | "workload_trusted_context"
  | "oauth_client_credentials"
  | "none";

export type McpServerConfigInput = {
  server_id: string;
  title: string;
  endpoint: string;
  network_mode?: McpNetworkMode;
  protocol_revision?: string;
  auth_strategy?: McpAuthStrategy;
  credential_ref?: string | null;
  allowed_tool_prefixes?: string[];
};

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** AuraClaw treats loopback as the Credential Proxy namespace, not the AuraX Mac. */
export function inferMcpNetworkMode(endpoint: string): Exclude<McpNetworkMode, "private"> {
  try {
    const hostname = new URL(endpoint.trim()).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return LOOPBACK_HOSTS.has(hostname) ? "loopback" : "public";
  } catch {
    return "public";
  }
}

export function createMcpServer(
  client: ClawClient,
  config: McpServerConfigInput,
  idempotencyKey = newIdempotencyKey("mcp-create"),
) {
  return client.request<McpServerRecord>("POST", "/v1/admin/mcp-servers", {
    json: {
      ...config,
      network_mode: config.network_mode ?? inferMcpNetworkMode(config.endpoint),
    },
    idempotencyKey,
    expectedRevision: 0,
  });
}

export function updateMcpServer(
  client: ClawClient,
  serverId: string,
  config: Record<string, unknown>,
  expectedRevision: number,
  idempotencyKey = newIdempotencyKey("mcp-update"),
) {
  return client.request<McpServerRecord>("PUT", `/v1/admin/mcp-servers/${serverId}`, {
    json: config,
    idempotencyKey,
    expectedRevision,
  });
}

export async function mcpLifecycle(
  client: ClawClient,
  serverId: string,
  action: McpLifecycleAction,
  expectedRevision: number,
  idempotencyKey = newIdempotencyKey(`mcp-${action}`),
) {
  const response = await client.request<McpOperationRecord>(
    "POST",
    `/v1/admin/mcp-servers/${serverId}:${action}`,
    { idempotencyKey, expectedRevision },
  );
  if (response.body.status === "failed") {
    const errorType = response.body.result?.error_type;
    const errorMessage = response.body.result?.error_message;
    const parts = [
      typeof errorType === "string" ? errorType : null,
      typeof errorMessage === "string" ? errorMessage : null,
    ].filter((part): part is string => part != null && part.length > 0);
    const suffix = parts.length > 0 ? ` (${parts.join(": ")})` : "";
    throw new ClawApiError(
      response.status,
      response.body.safe_error_code ?? "mcp_lifecycle_failed",
      `MCP ${action} 失败${suffix}`,
      response.body.safe_error_code ?? null,
    );
  }
  return response;
}

export function getMcpOperation(client: ClawClient, operationId: string) {
  return client.request<Record<string, unknown>>(
    "GET",
    `/v1/admin/mcp-operations/${operationId}`,
  );
}
