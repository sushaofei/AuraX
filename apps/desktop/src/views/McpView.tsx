import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  buildMcpServerConfigPayload,
  deleteMcpServer,
  inferMcpNetworkMode,
  listMcpServers,
  listMcpTools,
  MCP_PROTOCOL_REVISION_DEFAULT,
  MCP_PROTOCOL_REVISION_OPTIONS,
  mcpLifecycle,
  saveMcpServer,
  type ClawClient,
  type McpAuthStrategy,
  type McpLifecycleAction,
  type McpProtocolRevision,
  type McpServerConfigInput,
  type McpServerRecord,
} from "@aurax/claw-sdk";
import { useState } from "react";
import { errorText } from "../lib/errors";

const MCP_ACTION_LABEL: Record<
  Exclude<McpLifecycleAction, "retire" | "delete">,
  string
> = {
  test: "探测",
  enable: "启用",
  disable: "停用",
  reconcile: "同步目录",
};

const MCP_AUTH_LABEL: Record<McpAuthStrategy, string> = {
  workload_trusted_context: "Workload 受信上下文（Bearer + credential_ref）",
  oauth_client_credentials: "OAuth Client Credentials",
  none: "无远端认证（仅 loopback / private）",
};

type McpFormState = {
  server_id: string;
  title: string;
  endpoint: string;
  protocol_revision: McpProtocolRevision;
  auth_strategy: McpAuthStrategy;
  credential_ref: string;
  allowed_tool_prefixes: string;
};

const EMPTY_MCP_FORM: McpFormState = {
  server_id: "",
  title: "",
  endpoint: "",
  protocol_revision: MCP_PROTOCOL_REVISION_DEFAULT,
  auth_strategy: "workload_trusted_context",
  credential_ref: "",
  allowed_tool_prefixes: "",
};

function isMcpAuthStrategy(value: string | undefined): value is McpAuthStrategy {
  return value === "workload_trusted_context" || value === "oauth_client_credentials" || value === "none";
}

function isMcpProtocolRevision(value: string | undefined): value is McpProtocolRevision {
  return MCP_PROTOCOL_REVISION_OPTIONS.some((option) => option.value === value);
}

function formFromServer(server: McpServerRecord): McpFormState {
  const config = server.latest_config;
  const authStrategy = isMcpAuthStrategy(config?.auth_strategy)
    ? config.auth_strategy
    : "workload_trusted_context";
  return {
    server_id: server.server_id,
    title: config?.title ?? "",
    endpoint: config?.endpoint ?? "",
    protocol_revision: isMcpProtocolRevision(config?.protocol_revision)
      ? config.protocol_revision
      : MCP_PROTOCOL_REVISION_DEFAULT,
    auth_strategy: authStrategy,
    credential_ref: config?.credential_ref ?? "",
    allowed_tool_prefixes: (config?.allowed_tool_prefixes ?? []).join(", "),
  };
}

function buildMcpPayload(form: McpFormState, endpoint: string): McpServerConfigInput {
  const allowedToolPrefixes = form.allowed_tool_prefixes
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const base = {
    server_id: form.server_id.trim(),
    title: form.title.trim(),
    endpoint,
    protocol_revision: form.protocol_revision,
    allowed_tool_prefixes: allowedToolPrefixes,
  };
  if (form.auth_strategy === "none") {
    return buildMcpServerConfigPayload({
      ...base,
      auth_strategy: "none",
    });
  }
  return buildMcpServerConfigPayload({
    ...base,
    auth_strategy: "workload_trusted_context",
    credential_ref: form.credential_ref.trim(),
  });
}

export function McpView({ client }: { client: ClawClient }) {
  const queryClient = useQueryClient();
  const [showRetired, setShowRetired] = useState(false);
  const servers = useQuery({
    queryKey: ["mcp", client.baseUrl],
    queryFn: async () => (await listMcpServers(client)).body.servers,
  });
  const [form, setForm] = useState<McpFormState>(EMPTY_MCP_FORM);
  const endpoint = form.endpoint.trim();
  const serverId = form.server_id.trim();
  const existingServer =
    serverId.length > 0
      ? (servers.data ?? []).find((server) => server.server_id === serverId)
      : undefined;
  const willUpdate =
    existingServer != null && existingServer.desired_state !== "retired";
  const networkMode = endpoint ? inferMcpNetworkMode(endpoint) : null;
  const protocolHint =
    MCP_PROTOCOL_REVISION_OPTIONS.find((option) => option.value === form.protocol_revision)
      ?.hint ?? "";
  const nonePublicConflict =
    form.auth_strategy === "none" && networkMode === "public";
  const save = useMutation({
    mutationFn: async () => {
      if (form.auth_strategy === "workload_trusted_context" && !form.credential_ref.trim()) {
        throw new Error("workload_trusted_context 必须填写 credential_ref，不要贴明文 Secret");
      }
      if (nonePublicConflict) {
        throw new Error("auth_strategy none 不能用于 public endpoint，请改用 loopback 地址");
      }
      if (!serverId) {
        throw new Error("server_id 不能为空");
      }
      await saveMcpServer(client, buildMcpPayload(form, endpoint), existingServer);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["mcp"] });
    },
  });
  const act = useMutation({
    mutationFn: async (input: { server: McpServerRecord; action: Exclude<McpLifecycleAction, "retire" | "delete"> }) => {
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
  const deleteServer = useMutation({
    mutationFn: async (server: McpServerRecord) => {
      await deleteMcpServer(client, server.server_id, server.latest_revision);
      return server.server_id;
    },
    onSuccess: (deletedId) => {
      if (form.server_id.trim() === deletedId) {
        setForm(EMPTY_MCP_FORM);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["mcp"] });
    },
  });
  const allServers = servers.data ?? [];
  const visibleServers = showRetired
    ? allServers
    : allServers.filter((server) => server.desired_state !== "retired");
  const retiredCount = allServers.filter((server) => server.desired_state === "retired").length;
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
              : networkMode === "private"
                ? "将以 private 登记（内网地址，可配合无远端认证）"
                : "将以 public 登记（需 HTTPS 公网地址）"}
          </p>
        ) : null}
        <label className="stack" style={{ gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>MCP Protocol Version</span>
          <select
            aria-label="MCP Protocol Version"
            value={form.protocol_revision}
            onChange={(event) =>
              setForm({
                ...form,
                protocol_revision: event.target.value as McpProtocolRevision,
              })
            }
          >
            {MCP_PROTOCOL_REVISION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {protocolHint ? <p className="mono">{protocolHint}</p> : null}
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
        {willUpdate ? (
          <p className="mono">
            检测到 {serverId} 已登记（rev {existingServer?.latest_revision}），提交将写入 rev{" "}
            {(existingServer?.latest_revision ?? 0) + 1}，不会新建 server_id。
          </p>
        ) : null}
        <button
          className="btn"
          type="button"
          disabled={nonePublicConflict}
          onClick={() => save.mutate()}
        >
          {willUpdate ? "更新配置" : "登记"}
        </button>
        {save.error ? <p className="error">{errorText(save.error)}</p> : null}
      </div>
      {retiredCount > 0 ? (
        <div className="row" style={{ marginTop: 16 }}>
          <button
            className="btn ghost"
            type="button"
            aria-pressed={showRetired}
            onClick={() => setShowRetired((current) => !current)}
          >
            {showRetired ? "隐藏已删除" : `显示已删除（${retiredCount}）`}
          </button>
        </div>
      ) : null}
      <div className="list" style={{ marginTop: 16 }}>
        {servers.error ? <p className="error">{errorText(servers.error)}</p> : null}
        {visibleServers.map((server) => (
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
              {server.latest_config?.protocol_revision
                ? ` · ${server.latest_config.protocol_revision}`
                : ""}
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
            {server.catalog_publication ? (
              <div className="row">
                <span
                  className={`pill ${
                    server.catalog_publication.stale ||
                    server.catalog_publication.status === "quarantined"
                      ? "off"
                      : "ok"
                  }`}
                >
                  Catalog {server.catalog_publication.status ?? "unknown"}
                </span>
                <span className="mono">
                  generation {server.catalog_publication.active_generation ?? "—"}
                  {server.catalog_publication.stale ? " · stale" : ""}
                </span>
              </div>
            ) : null}
            {server.catalog_publication?.last_sync_error ? (
              <p className="error">{server.catalog_publication.last_sync_error}</p>
            ) : null}
            <McpServerActions
              client={client}
              server={server}
              busy={act.isPending}
              deleteBusy={
                deleteServer.isPending && deleteServer.variables?.server_id === server.server_id
              }
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
              onDelete={() => deleteServer.mutate(server)}
              onEdit={() => setForm(formFromServer(server))}
            />
            {server.desired_state === "retired" ? (
              <p className="mono">已软删除。可重新登记恢复，或点「永久删除」从登记册移除。</p>
            ) : null}
          </div>
        ))}
        {allServers.length === 0 ? <p className="empty">还没有登记 MCP Server。</p> : null}
        {allServers.length > 0 && visibleServers.length === 0 ? (
          <p className="empty">没有活跃的 MCP Server。点「显示已删除」查看已移除项。</p>
        ) : null}
        {act.error ? <p className="error">{errorText(act.error)}</p> : null}
        {deleteServer.error ? <p className="error">{errorText(deleteServer.error)}</p> : null}
      </div>
    </section>
  );
}

function McpServerActions({
  client,
  server,
  busy,
  deleteBusy,
  pendingAction,
  lastAction,
  onAction,
  onDelete,
  onEdit,
}: {
  client: ClawClient;
  server: McpServerRecord;
  busy: boolean;
  deleteBusy: boolean;
  pendingAction: Exclude<McpLifecycleAction, "retire" | "delete"> | null;
  lastAction: Exclude<McpLifecycleAction, "retire" | "delete"> | null;
  onAction: (action: Exclude<McpLifecycleAction, "retire" | "delete">) => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const tools = useQuery({
    queryKey: ["mcp-tools", client.baseUrl, server.server_id],
    queryFn: async () => (await listMcpTools(client, server.server_id)).body.tools,
    enabled: open,
  });
  return (
    <>
      <div className="row">
        {(["test", "enable", "disable", "reconcile"] as const).map((action) => (
          <button
            key={action}
            className="btn ghost"
            type="button"
            disabled={busy || deleteBusy || server.desired_state === "retired"}
            onClick={() => onAction(action)}
          >
            {pendingAction === action ? "…" : MCP_ACTION_LABEL[action]}
          </button>
        ))}
        <button
          className="btn ghost"
          type="button"
          disabled={busy || deleteBusy || server.desired_state === "retired"}
          onClick={onEdit}
        >
          填入表单
        </button>
        <button
          className="btn ghost"
          type="button"
          aria-expanded={open}
          disabled={server.desired_state === "retired"}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? "收起工具" : "工具"}
        </button>
        {server.desired_state !== "retired" && !confirmDelete ? (
          <button
            className="btn danger ghost"
            type="button"
            disabled={busy || deleteBusy}
            onClick={() => setConfirmDelete(true)}
          >
            删除
          </button>
        ) : null}
        {server.desired_state === "retired" && !confirmDelete ? (
          <button
            className="btn danger ghost"
            type="button"
            disabled={busy || deleteBusy}
            onClick={() => setConfirmDelete(true)}
          >
            永久删除
          </button>
        ) : null}
        {confirmDelete ? (
          <>
            <span className="mono">
              {server.desired_state === "retired"
                ? `确认永久删除 ${server.server_id}？此操作不可恢复。`
                : `确认删除 ${server.server_id}？将从登记册永久移除。`}
            </span>
            <button
              className="btn danger"
              type="button"
              disabled={deleteBusy}
              onClick={() => {
                onDelete();
                setConfirmDelete(false);
              }}
            >
              {deleteBusy ? "…" : server.desired_state === "retired" ? "确认永久删除" : "确认删除"}
            </button>
            <button
              className="btn ghost"
              type="button"
              disabled={deleteBusy}
              onClick={() => setConfirmDelete(false)}
            >
              取消
            </button>
          </>
        ) : null}
      </div>
      {lastAction ? <p className="mono">{MCP_ACTION_LABEL[lastAction]}成功</p> : null}
      {open ? (
        <div className="tool-panel">
          {tools.isPending ? <p className="mono">正在读取目录…</p> : null}
          {tools.error ? <p className="error">{errorText(tools.error)}</p> : null}
          {tools.data && tools.data.length === 0 ? (
            <p className="mono">目录为空。启用后点同步目录，才会把 tools 写入 Catalog。</p>
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
