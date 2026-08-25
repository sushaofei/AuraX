import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createMcpServer,
  inferMcpNetworkMode,
  listMcpServers,
  listMcpTools,
  mcpLifecycle,
  type ClawClient,
  type McpAuthStrategy,
  type McpLifecycleAction,
  type McpServerRecord,
} from "@aurax/claw-sdk";
import { useState } from "react";
import { errorText } from "../lib/errors";

const MCP_ACTION_LABEL: Record<McpLifecycleAction, string> = {
  test: "探测",
  enable: "启用",
  disable: "停用",
  reconcile: "对账",
  retire: "退役",
};

const MCP_AUTH_LABEL: Record<McpAuthStrategy, string> = {
  workload_trusted_context: "Workload 受信上下文（Bearer + credential_ref）",
  oauth_client_credentials: "OAuth Client Credentials",
  none: "无远端认证（仅 loopback / private）",
};

export function McpView({ client }: { client: ClawClient }) {
  const queryClient = useQueryClient();
  const servers = useQuery({
    queryKey: ["mcp", client.baseUrl],
    queryFn: async () => (await listMcpServers(client)).body.servers,
  });
  const [form, setForm] = useState({
    server_id: "",
    title: "",
    endpoint: "",
    auth_strategy: "workload_trusted_context" as McpAuthStrategy,
    credential_ref: "",
    allowed_tool_prefixes: "",
  });
  const endpoint = form.endpoint.trim();
  const networkMode = endpoint ? inferMcpNetworkMode(endpoint) : null;
  const nonePublicConflict =
    form.auth_strategy === "none" && networkMode === "public";
  const create = useMutation({
    mutationFn: async () => {
      if (form.auth_strategy === "workload_trusted_context" && !form.credential_ref.trim()) {
        throw new Error("workload_trusted_context 必须填写 credential_ref，不要贴明文 Secret");
      }
      if (nonePublicConflict) {
        throw new Error("auth_strategy none 不能用于 public endpoint，请改用 loopback 地址");
      }
      const allowedToolPrefixes = form.allowed_tool_prefixes
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      const payload =
        form.auth_strategy === "none"
          ? {
              server_id: form.server_id.trim(),
              title: form.title.trim(),
              endpoint,
              network_mode: inferMcpNetworkMode(endpoint),
              auth_strategy: "none" as const,
              allowed_tool_prefixes: allowedToolPrefixes,
            }
          : {
              server_id: form.server_id.trim(),
              title: form.title.trim(),
              endpoint,
              network_mode: inferMcpNetworkMode(endpoint),
              auth_strategy: "workload_trusted_context" as const,
              credential_ref: form.credential_ref.trim(),
              allowed_tool_prefixes: allowedToolPrefixes,
            };
      await createMcpServer(client, payload);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["mcp"] });
    },
  });
  const act = useMutation({
    mutationFn: async (input: { server: McpServerRecord; action: McpLifecycleAction }) => {
      await mcpLifecycle(client, input.server.server_id, input.action, input.server.latest_revision);
      return input.action;
    },
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["mcp"] });
      if (variables?.action === "reconcile") {
        void queryClient.invalidateQueries({
          queryKey: ["mcp-tools", client.baseUrl, variables.server.server_id],
        });
      }
    },
  });
  return (
    <section>
      <p className="kicker">Hands registry</p>
      <h1>MCP</h1>
      <p className="lede">
        只登记 AuraClaw 受管 Server。受管 Server 填 credential_ref，不要贴明文 Secret。本地无认证
        Server 选「无远端认证」且 endpoint 须为 loopback。loopback 相对的是 Credential Proxy，不是这台
        Mac。
      </p>
      <div className="card stack">
        <div className="row">
          <input
            placeholder="server_id"
            value={form.server_id}
            onChange={(event) => setForm({ ...form, server_id: event.target.value })}
          />
          <input
            placeholder="title"
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
        </div>
        <input
          placeholder="http://127.0.0.1:8020/mcp 或 https://mcp.example/mcp"
          value={form.endpoint}
          onChange={(event) => setForm({ ...form, endpoint: event.target.value })}
        />
        {networkMode ? (
          <p className="mono">
            {networkMode === "loopback"
              ? "将以 loopback 登记（相对 Credential Proxy，不是这台 Mac）"
              : "将以 public 登记（需 HTTPS 公网地址）"}
          </p>
        ) : null}
        <label className="stack" style={{ gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>认证方式</span>
          <select
            aria-label="认证方式"
            value={form.auth_strategy}
            onChange={(event) =>
              setForm({
                ...form,
                auth_strategy: event.target.value as McpAuthStrategy,
              })
            }
          >
            <option value="workload_trusted_context">
              {MCP_AUTH_LABEL.workload_trusted_context}
            </option>
            <option value="none">{MCP_AUTH_LABEL.none}</option>
          </select>
        </label>
        {form.auth_strategy === "none" ? (
          <p className="mono">
            不向远端 MCP 发送 Authorization Bearer。仍经 AuraClaw Policy 与 Credential Proxy Egress。
          </p>
        ) : null}
        {nonePublicConflict ? (
          <p className="error">无远端认证不能用于 public endpoint，请把地址改成 loopback。</p>
        ) : null}
        {form.auth_strategy === "workload_trusted_context" ? (
          <input
            placeholder="credential_ref（必填引用，不是明文）"
            value={form.credential_ref}
            onChange={(event) => setForm({ ...form, credential_ref: event.target.value })}
          />
        ) : null}
        <input
          placeholder="allowed_tool_prefixes，逗号分隔"
          value={form.allowed_tool_prefixes}
          onChange={(event) => setForm({ ...form, allowed_tool_prefixes: event.target.value })}
        />
        <button
          className="btn"
          type="button"
          disabled={nonePublicConflict}
          onClick={() => create.mutate()}
        >
          登记
        </button>
        {create.error ? <p className="error">{errorText(create.error)}</p> : null}
      </div>
      <div className="list" style={{ marginTop: 16 }}>
        {servers.error ? <p className="error">{errorText(servers.error)}</p> : null}
        {(servers.data ?? []).map((server) => (
          <div key={server.server_id} className="card">
            <div className="row">
              <strong>{server.latest_config?.title ?? server.server_id}</strong>
              <span
                className={`pill ${server.desired_state === "enabled" ? "ok" : server.desired_state === "retired" ? "off" : ""}`}
              >
                {server.desired_state}
              </span>
            </div>
            <p className="mono">
              {server.server_id} · observed {server.runtime?.observed_state ?? "—"} · rev{" "}
              {server.latest_revision}
              {server.latest_config?.auth_strategy
                ? ` · ${server.latest_config.auth_strategy}`
                : ""}
              {server.latest_config?.network_mode
                ? ` · ${server.latest_config.network_mode}`
                : ""}
              {server.runtime?.last_test_at
                ? ` · 探测 ${new Date(server.runtime.last_test_at).toLocaleString()}`
                : ""}
            </p>
            {server.runtime?.safe_error_code ? (
              <p className="error">{server.runtime.safe_error_code}</p>
            ) : null}
            <McpServerActions
              client={client}
              server={server}
              busy={act.isPending}
              pendingAction={
                act.isPending && act.variables?.server.server_id === server.server_id
                  ? act.variables.action
                  : null
              }
              lastAction={
                act.isSuccess && act.variables?.server.server_id === server.server_id
                  ? act.data
                  : null
              }
              onAction={(action) => act.mutate({ server, action })}
            />
            {server.desired_state === "retired" ? (
              <p className="mono">已退役。用同一 server_id 再点登记即可恢复。</p>
            ) : null}
          </div>
        ))}
        {servers.data?.length === 0 ? <p className="empty">还没有登记 MCP Server。</p> : null}
        {act.error ? <p className="error">{errorText(act.error)}</p> : null}
      </div>
    </section>
  );
}

function McpServerActions({
  client,
  server,
  busy,
  pendingAction,
  lastAction,
  onAction,
}: {
  client: ClawClient;
  server: McpServerRecord;
  busy: boolean;
  pendingAction: McpLifecycleAction | null;
  lastAction: McpLifecycleAction | null;
  onAction: (action: McpLifecycleAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const tools = useQuery({
    queryKey: ["mcp-tools", client.baseUrl, server.server_id],
    queryFn: async () => (await listMcpTools(client, server.server_id)).body.tools,
    enabled: open,
  });
  return (
    <>
      <div className="row">
        {(["test", "enable", "disable", "reconcile", "retire"] as const).map((action) => (
          <button
            key={action}
            className="btn ghost"
            type="button"
            disabled={busy || (server.desired_state === "retired" && action !== "retire")}
            onClick={() => onAction(action)}
          >
            {pendingAction === action ? "…" : MCP_ACTION_LABEL[action]}
          </button>
        ))}
        <button
          className="btn ghost"
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? "收起工具" : "工具"}
        </button>
      </div>
      {lastAction ? <p className="mono">{MCP_ACTION_LABEL[lastAction]}成功</p> : null}
      {open ? (
        <div className="tool-panel">
          {tools.isPending ? <p className="mono">正在读取目录…</p> : null}
          {tools.error ? <p className="error">{errorText(tools.error)}</p> : null}
          {tools.data && tools.data.length === 0 ? (
            <p className="mono">目录为空。启用后点对账，才会把 tools 写入 Catalog。</p>
          ) : null}
          {tools.data && tools.data.length > 0 ? (
            <ul className="tool-list">
              {tools.data.map((tool) => (
                <li key={tool.capability_id || tool.canonical_name}>
                  <div className="row">
                    <strong>{tool.canonical_name}</strong>
                    <span className={`pill${tool.status === "active" ? " ok" : ""}`}>
                      {tool.status}
                    </span>
                  </div>
                  {tool.title && tool.title !== tool.canonical_name ? <p>{tool.title}</p> : null}
                  {tool.description ? <p>{tool.description}</p> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
