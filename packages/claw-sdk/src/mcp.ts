import type { ClawClient } from "./client.js";
import { ClawApiError, newIdempotencyKey } from "./errors.js";
import type {
  McpLifecycleAction,
  McpCapability,
  McpCapabilityList,
  McpCapabilityTestResult,
  McpOperationRecord,
  McpServerRecord,
  McpToolList,
} from "./types.js";

export function listMcpServers(client: ClawClient) {
  return client.request<{ servers: McpServerRecord[] }>("GET", "/v1/admin/mcp-servers");
}

export function mcpCatalogStatusLabel(status: string | null | undefined): string {
  const labels: Record<string, string> = {
    active: "可用", degraded: "同步异常", quarantined: "已隔离", retired: "已下线",
  };
  return labels[status ?? ""] ?? "状态未知";
}

export function mcpCatalogErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    ValueError: "能力目录校验失败，请查看同步诊断；不一定是历史数据问题。",
    CapabilityDescriptorDepthError: "能力 Schema 嵌套过深，超过目录安全限制。",
    CapabilityDescriptorSizeError: "能力描述过大，超过目录安全限制。",
    CapabilitySchemaDriftError: "能力定义已变更但版本未更新，请升级 MCP 能力版本后重新同步。",
    CapabilityAllowlistError: "发现的能力均不符合允许前缀，请检查服务器的能力白名单。",
    TimeoutError: "能力目录同步超时，请检查 MCP 服务和网络后重试。",
    PolicyDeniedError: "安全策略拒绝了目录访问，请检查权限和网络策略。",
    transport_unavailable: "MCP 连接不可用，请检查服务器是否已启用。",
  };
  return messages[code] ?? "能力目录同步失败，请检查 MCP 服务与同步诊断后重试。";
}

export function getMcpServer(client: ClawClient, serverId: string) {
  return client.request<McpServerRecord>("GET", `/v1/admin/mcp-servers/${serverId}`);
}

export function listMcpTools(client: ClawClient, serverId: string) {
  return client.request<McpToolList>("GET", `/v1/admin/mcp-servers/${serverId}/tools`);
}

export async function listMcpCapabilities(client: ClawClient, serverId: string) {
  try {
    return await client.request<McpCapabilityList>(
      "GET",
      `/v1/admin/mcp-servers/${serverId}/capabilities`,
    );
  } catch (error) {
    if (!(error instanceof ClawApiError) || error.status !== 404) {
      throw error;
    }
    const legacy = await listMcpTools(client, serverId);
    const capabilities: McpCapability[] = legacy.body.tools.map((tool) => ({
      ...tool,
      capability_id: tool.capability_id || `legacy-tool:${serverId}:${tool.canonical_name}`,
      kind: "tool",
      title: tool.title || tool.canonical_name,
      description: tool.description || "",
      version: tool.version || "0.0.0",
      status: tool.status || "active",
      tags: tool.tags ?? [],
      read_only: tool.read_only ?? tool.permission === "read-only",
      enabled: tool.enabled ?? tool.status === "active",
    }));
    return {
      status: legacy.status,
      headers: legacy.headers,
      body: {
        server_id: legacy.body.server_id,
        capabilities,
        legacy_tools_fallback: true,
      },
    };
  }
}

export function testMcpCapability(
  client: ClawClient,
  serverId: string,
  capabilityId: string,
  input: Record<string, unknown>,
  expectedOutput?: unknown,
) {
  return client.request<McpCapabilityTestResult>(
    "POST",
    `/v1/admin/mcp-servers/${encodeURIComponent(serverId)}/capabilities/${encodeURIComponent(capabilityId)}:test`,
    {
      json: {
        input,
        ...(expectedOutput === undefined ? {} : { expected_output: expectedOutput }),
      },
    },
  );
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
  allowed_cidrs?: string[];
};

export type McpServerConfigUpdate = Omit<McpServerConfigInput, "server_id">;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function parseIpv4(hostname: string): [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) {
    return null;
  }
  const octets = match.slice(1).map(Number) as [number, number, number, number];
  return octets.some((octet) => octet > 255) ? null : octets;
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = parseIpv4(hostname);
  if (!octets) {
    return false;
  }
  const [first, second] = octets;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

function endpointHostname(endpoint: string): string | null {
  try {
    return new URL(endpoint.trim()).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return null;
  }
}

/** AuraClaw treats loopback as the Credential Proxy namespace, not the AuraX Mac. */
export function inferMcpNetworkMode(endpoint: string): McpNetworkMode {
  const hostname = endpointHostname(endpoint);
  if (!hostname) {
    return "public";
  }
  if (LOOPBACK_HOSTS.has(hostname)) {
    return "loopback";
  }
  if (isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) {
    return "private";
  }
  return "public";
}

export function inferMcpAllowedCidrs(
  endpoint: string,
  networkMode: McpNetworkMode = inferMcpNetworkMode(endpoint),
): string[] {
  if (networkMode !== "private") {
    return [];
  }
  const hostname = endpointHostname(endpoint);
  if (!hostname || (!isPrivateIpv4(hostname) && !isPrivateIpv6(hostname))) {
    return [];
  }
  return [`${hostname}/32`];
}

export function buildMcpServerConfigPayload(
  config: McpServerConfigInput,
): McpServerConfigInput & { network_mode: McpNetworkMode } {
  const network_mode = config.network_mode ?? inferMcpNetworkMode(config.endpoint);
  const allowed_cidrs =
    config.allowed_cidrs ?? inferMcpAllowedCidrs(config.endpoint, network_mode);
  return {
    ...config,
    network_mode,
    ...(allowed_cidrs.length > 0 ? { allowed_cidrs } : {}),
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

/** Retire (soft-delete) an MCP server from the Hands registry. */
export function retireMcpServer(
  client: ClawClient,
  serverId: string,
  expectedRevision: number,
  idempotencyKey = newIdempotencyKey("mcp-retire"),
) {
  return mcpLifecycle(client, serverId, "retire", expectedRevision, idempotencyKey);
}

/** Hard-delete an MCP server registration from the Hands registry. */
export function deleteMcpServer(
  client: ClawClient,
  serverId: string,
  expectedRevision: number,
  idempotencyKey = newIdempotencyKey("mcp-delete"),
) {
  return mcpLifecycle(client, serverId, "delete", expectedRevision, idempotencyKey);
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
    "/v1/admin/mcp-servers/lifecycle",
    {
      json: {
        server_id: serverId,
        operation: action,
      },
      idempotencyKey,
      expectedRevision,
    },
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
