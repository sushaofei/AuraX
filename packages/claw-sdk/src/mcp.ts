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

export type McpProtocolRevision = "2026-07-28" | "2025-11-25" | "2025-06-18";

export const MCP_PROTOCOL_REVISION_DEFAULT: McpProtocolRevision = "2026-07-28";

export const MCP_PROTOCOL_REVISION_OPTIONS: ReadonlyArray<{
  value: McpProtocolRevision;
  label: string;
  hint: string;
}> = [
  {
    value: "2026-07-28",
    label: "2026-07-28（现代，server/discover）",
    hint: "AuraMCP 等新 Server；对账先发 server/discover。",
  },
  {
    value: "2025-11-25",
    label: "2025-11-25（legacy initialize）",
    hint: "仍使用 initialize 握手的 legacy Server。",
  },
  {
    value: "2025-06-18",
    label: "2025-06-18（Java MCP）",
    hint: "chaintower Java MCP Server（Spring AI）；不支持 server/discover。",
  },
];

export type McpServerConfigInput = {
  server_id: string;
  title: string;
  endpoint: string;
  network_mode?: McpNetworkMode;
  protocol_revision?: McpProtocolRevision;
  auth_strategy?: McpAuthStrategy;
  credential_ref?: string | null;
  allowed_tool_prefixes?: string[];
};

export type McpServerConfigUpdate = Omit<McpServerConfigInput, "server_id">;

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

export function buildMcpServerConfigPayload(
  config: McpServerConfigInput,
): McpServerConfigInput & { network_mode: McpNetworkMode } {
  return {
    ...config,
    network_mode: config.network_mode ?? inferMcpNetworkMode(config.endpoint),
  };
}

export function createMcpServer(
  client: ClawClient,
  config: McpServerConfigInput,
  idempotencyKey = newIdempotencyKey("mcp-create"),
) {
  return client.request<McpServerRecord>("POST", "/v1/admin/mcp-servers", {
    json: buildMcpServerConfigPayload(config),
    idempotencyKey,
    expectedRevision: 0,
  });
}

export function updateMcpServer(
  client: ClawClient,
  serverId: string,
  config: McpServerConfigUpdate,
  expectedRevision: number,
  idempotencyKey = newIdempotencyKey("mcp-update"),
) {
  const { server_id: _serverId, ...json } = buildMcpServerConfigPayload({
    server_id: serverId,
    ...config,
  });
  return client.request<McpServerRecord>("PUT", `/v1/admin/mcp-servers/${serverId}`, {
    json,
    idempotencyKey,
    expectedRevision,
  });
}

/** Create a new server, or append a revision when server_id already exists. */
export function saveMcpServer(
  client: ClawClient,
  config: McpServerConfigInput,
  existing: McpServerRecord | null | undefined,
) {
  const serverId = config.server_id.trim();
  if (
    existing &&
    existing.server_id === serverId &&
    existing.desired_state !== "retired"
  ) {
    const { server_id: _serverId, ...update } = buildMcpServerConfigPayload(config);
    return updateMcpServer(client, serverId, update, existing.latest_revision);
  }
  return createMcpServer(client, config);
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
