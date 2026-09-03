import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import {
  buildMcpServerConfigPayload,
  deleteMcpServer,
  inferMcpNetworkMode,
  listMcpCapabilities,
  listMcpServers,
  MCP_PROTOCOL_REVISION_DEFAULT,
  MCP_PROTOCOL_REVISION_OPTIONS,
  mcpLifecycle,
  mcpCatalogStatusLabel,
  mcpCatalogErrorMessage,
  saveMcpServer,
  testMcpCapability,
  type ClawClient,
  type McpAuthStrategy,
  type McpCapability,
  type McpCapabilityKind,
  type McpCapabilityTestResult,
  type McpLifecycleAction,
  type McpProtocolRevision,
  type McpServerConfigInput,
  type McpServerRecord,
} from "@aurax/claw-sdk";
import { useState } from "react";
import { errorText } from "../lib/errors";

type LifecycleAction = Exclude<McpLifecycleAction, "retire" | "delete">;
type LifecycleVariables = { server: McpServerRecord; action: LifecycleAction };
type LifecycleMutation = UseMutationResult<LifecycleAction, Error, LifecycleVariables>;

const MCP_ACTION_LABEL: Record<LifecycleAction, string> = {
  test: "探测连接",
  enable: "启用",
  disable: "停用",
  reconcile: "同步目录",
};

const MCP_AUTH_LABEL: Record<McpAuthStrategy, string> = {
  workload_trusted_context: "Workload 受信上下文",
  oauth_client_credentials: "OAuth Client Credentials",
  none: "无远端认证",
};

type McpFormState = {
  server_id: string;
  title: string;
  endpoint: string;
  protocol_revision: McpProtocolRevision;
  auth_strategy: McpAuthStrategy;
  credential_ref: string;
};

type EditorState = { kind: "create" } | { kind: "edit"; serverId: string } | null;

const EMPTY_MCP_FORM: McpFormState = {
  server_id: "",
  title: "",
  endpoint: "",
  protocol_revision: MCP_PROTOCOL_REVISION_DEFAULT,
  auth_strategy: "workload_trusted_context",
  credential_ref: "",
};

function isMcpAuthStrategy(value: string | undefined): value is McpAuthStrategy {
  return value === "workload_trusted_context" || value === "oauth_client_credentials" || value === "none";
}

function isMcpProtocolRevision(value: string | undefined): value is McpProtocolRevision {
  return MCP_PROTOCOL_REVISION_OPTIONS.some((option) => option.value === value);
}

function formFromServer(server: McpServerRecord): McpFormState {
  const config = server.latest_config;
  return {
    server_id: server.server_id,
    title: config?.title ?? "",
    endpoint: config?.endpoint ?? "",
    protocol_revision: isMcpProtocolRevision(config?.protocol_revision)
      ? config.protocol_revision
      : MCP_PROTOCOL_REVISION_DEFAULT,
    auth_strategy: isMcpAuthStrategy(config?.auth_strategy)
      ? config.auth_strategy
      : "workload_trusted_context",
    credential_ref: config?.credential_ref ?? "",
  };
}

function buildMcpPayload(form: McpFormState, endpoint: string): McpServerConfigInput {
  const base = {
    server_id: form.server_id.trim(),
    title: form.title.trim(),
    endpoint,
    protocol_revision: form.protocol_revision,
  };
  return buildMcpServerConfigPayload(
    form.auth_strategy === "none"
      ? { ...base, auth_strategy: "none" }
      : {
          ...base,
          auth_strategy: "workload_trusted_context",
          credential_ref: form.credential_ref.trim(),
        },
  );
}

function serverSearchText(server: McpServerRecord): string {
  return [
    server.server_id,
    server.latest_config?.title,
    server.latest_config?.endpoint,
    server.latest_config?.network_mode,
    server.desired_state,
    server.runtime?.observed_state,
    server.catalog_publication?.status,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLocaleLowerCase();
}

function statusLabel(server: McpServerRecord): string {
  if (server.desired_state === "retired") return "已删除";
  if (server.runtime?.safe_error_code) return "异常";
  if (server.desired_state === "enabled") return "已启用";
  return "已停用";
}

export function McpView({ client }: { client: ClawClient }) {
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<EditorState>(null);
  const [query, setQuery] = useState("");
  const [showRetired, setShowRetired] = useState(false);
  const [form, setForm] = useState<McpFormState>(EMPTY_MCP_FORM);
  const servers = useQuery({
    queryKey: ["mcp", client.baseUrl],
    queryFn: async () => (await listMcpServers(client)).body.servers,
  });
  const allServers = servers.data ?? [];
  const editingServer =
    editor?.kind === "edit"
      ? allServers.find((server) => server.server_id === editor.serverId)
      : undefined;
  const endpoint = form.endpoint.trim();
  const serverId = form.server_id.trim();
  const networkMode = endpoint ? inferMcpNetworkMode(endpoint) : null;
  const protocolHint =
    MCP_PROTOCOL_REVISION_OPTIONS.find((option) => option.value === form.protocol_revision)?.hint ?? "";
  const nonePublicConflict = form.auth_strategy === "none" && networkMode === "public";

  const save = useMutation<void, Error>({
    mutationFn: async () => {
      if (form.auth_strategy === "workload_trusted_context" && !form.credential_ref.trim()) {
        throw new Error("Workload 受信上下文必须填写 credential_ref，不要粘贴明文 Secret");
      }
      if (nonePublicConflict) {
        throw new Error("无远端认证不能用于 public endpoint，请改用 loopback 或 private 地址");
      }
      if (!serverId) throw new Error("server_id 不能为空");
      if (!form.title.trim()) throw new Error("名称不能为空");
      if (!endpoint) throw new Error("Endpoint 不能为空");
      await saveMcpServer(client, buildMcpPayload(form, endpoint), editingServer);
    },
    onSuccess: () => {
      setEditor(null);
      setForm(EMPTY_MCP_FORM);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["mcp"] }),
  });
  const act = useMutation<LifecycleAction, Error, LifecycleVariables>({
    mutationFn: async (input) => {
      await mcpLifecycle(client, input.server.server_id, input.action, input.server.latest_revision);
      return input.action;
    },
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["mcp"] });
      if (variables?.action === "reconcile") {
        void queryClient.invalidateQueries({
          queryKey: ["mcp-capabilities", client.baseUrl, variables.server.server_id],
        });
      }
    },
  });
  const deleteServer = useMutation<void, Error, McpServerRecord>({
    mutationFn: async (server) => {
      await deleteMcpServer(client, server.server_id, server.latest_revision);
    },
    onSuccess: () => {
      setEditor(null);
      setForm(EMPTY_MCP_FORM);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["mcp"] }),
  });

  const openCreate = () => {
    setForm(EMPTY_MCP_FORM);
    setEditor({ kind: "create" });
  };
  const openServer = (server: McpServerRecord) => {
    setForm(formFromServer(server));
    setEditor({ kind: "edit", serverId: server.server_id });
  };
  const closeEditor = () => {
    setEditor(null);
    setForm(EMPTY_MCP_FORM);
    save.reset();
  };

  const retiredCount = allServers.filter((server) => server.desired_state === "retired").length;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleServers = allServers.filter(
    (server) =>
      (showRetired || server.desired_state !== "retired") &&
      (!normalizedQuery || serverSearchText(server).includes(normalizedQuery)),
  );

  if (editor) {
    return (
      <McpEditor
        client={client}
        form={form}
        server={editingServer}
        networkMode={networkMode}
        protocolHint={protocolHint}
        nonePublicConflict={nonePublicConflict}
        saving={save.isPending}
        saveError={save.error}
        lifecycle={act}
        deleting={deleteServer.isPending}
        deleteError={deleteServer.error}
        onBack={closeEditor}
        onChange={setForm}
        onSave={() => save.mutate()}
        onAction={(server, action) => act.mutate({ server, action })}
        onDelete={(server) => deleteServer.mutate(server)}
      />
    );
  }

  return (
    <section className="mcp-admin">
      <header className="mcp-page-head">
        <div>
          <p className="kicker">Connections</p>
          <h1>MCP 服务器</h1>
          <p>管理 AuraClaw 可调用的受管工具连接。</p>
        </div>
        <label className="mcp-search">
          <span aria-hidden="true">⌕</span>
          <span className="sr-only">搜索 MCP 服务器</span>
          <input
            type="search"
            placeholder="搜索 MCP 服务器"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </header>

      <div className="mcp-list-heading">
        <div>
          <h2>服务器</h2>
          <span>{visibleServers.length} 个可见 · {allServers.length} 个已登记</span>
        </div>
        <button className="btn mcp-add" type="button" onClick={openCreate}>
          <span aria-hidden="true">＋</span> 添加服务器
        </button>
      </div>

      {servers.isPending ? <p className="empty">正在读取服务器…</p> : null}
      {servers.error ? <p className="error">{errorText(servers.error)}</p> : null}
      <div className="mcp-server-list" aria-label="MCP 服务器列表">
        {visibleServers.map((server) => {
          const enabled = server.desired_state === "enabled";
          const retired = server.desired_state === "retired";
          const pending = act.isPending && act.variables?.server.server_id === server.server_id;
          return (
            <article className="mcp-server-row" key={server.server_id}>
              <button className="mcp-server-summary" type="button" onClick={() => openServer(server)}>
                <span className="mcp-server-mark" aria-hidden="true">
                  {(server.latest_config?.title ?? server.server_id).slice(0, 1).toUpperCase()}
                </span>
                <span className="mcp-server-copy">
                  <strong>{server.latest_config?.title ?? server.server_id}</strong>
                  <span className="mono">
                    {server.server_id}
                    {server.latest_config?.endpoint ? ` · ${server.latest_config.endpoint}` : ""}
                  </span>
                  {server.catalog_publication?.last_sync_error ? (
                    <span className="mcp-inline-error" title={`诊断代码：${server.catalog_publication.last_sync_error}`}>
                      {mcpCatalogErrorMessage(server.catalog_publication.last_sync_error)}
                    </span>
                  ) : null}
                </span>
              </button>
              <div className="mcp-row-state">
                <span className={`mcp-status ${enabled ? "ok" : ""}${server.runtime?.safe_error_code ? " error" : ""}`}>
                  <i aria-hidden="true" /> {statusLabel(server)}
                </span>
                {server.catalog_publication ? (
                  <span className={`mcp-catalog ${server.catalog_publication.stale || server.catalog_publication.status === "quarantined" ? "warn" : ""}`}>
                    能力目录{mcpCatalogStatusLabel(server.catalog_publication.status)}
                    {server.catalog_publication.active_generation != null
                      ? ` · 第 ${server.catalog_publication.active_generation} 代`
                      : ""}
                    {server.catalog_publication.stale ? " · 尚未更新（保留上次目录）" : ""}
                  </span>
                ) : null}
              </div>
              <div className="mcp-row-actions">
                <button
                  className="mcp-icon-button"
                  type="button"
                  aria-label={`配置 ${server.latest_config?.title ?? server.server_id}`}
                  title="查看与配置"
                  onClick={() => openServer(server)}
                >
                  ⚙
                </button>
                {!retired ? (
                  <button
                    className="mcp-switch"
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={`${enabled ? "停用" : "启用"} ${server.latest_config?.title ?? server.server_id}`}
                    disabled={act.isPending || deleteServer.isPending}
                    onClick={() => act.mutate({ server, action: enabled ? "disable" : "enable" })}
                  >
                    <span />
                  </button>
                ) : null}
                {pending ? <span className="mono">处理中…</span> : null}
              </div>
            </article>
          );
        })}
      </div>
      {!servers.isPending && allServers.length === 0 ? (
        <div className="mcp-empty">
          <span aria-hidden="true">⌘</span>
          <h2>还没有 MCP 服务器</h2>
          <p>添加一个受管连接，让 AuraClaw 可以发现并调用它提供的工具。</p>
          <button className="btn" type="button" onClick={openCreate}>添加服务器</button>
        </div>
      ) : null}
      {!servers.isPending && allServers.length > 0 && visibleServers.length === 0 ? (
        <p className="empty">没有符合当前筛选条件的服务器。</p>
      ) : null}
      {retiredCount > 0 ? (
        <button
          className="mcp-retired-toggle"
          type="button"
          aria-pressed={showRetired}
          onClick={() => setShowRetired((current) => !current)}
        >
          {showRetired ? "隐藏已删除服务器" : `显示已删除服务器（${retiredCount}）`}
        </button>
      ) : null}
      {act.error ? <p className="error">{errorText(act.error)}</p> : null}
    </section>
  );
}

function McpEditor({
  client,
  form,
  server,
  networkMode,
  protocolHint,
  nonePublicConflict,
  saving,
  saveError,
  lifecycle,
  deleting,
  deleteError,
  onBack,
  onChange,
  onSave,
  onAction,
  onDelete,
}: {
  client: ClawClient;
  form: McpFormState;
  server: McpServerRecord | undefined;
  networkMode: ReturnType<typeof inferMcpNetworkMode> | null;
  protocolHint: string;
  nonePublicConflict: boolean;
  saving: boolean;
  saveError: Error | null;
  lifecycle: LifecycleMutation;
  deleting: boolean;
  deleteError: Error | null;
  onBack: () => void;
  onChange: (form: McpFormState) => void;
  onSave: () => void;
  onAction: (server: McpServerRecord, action: LifecycleAction) => void;
  onDelete: (server: McpServerRecord) => void;
}) {
  return (
    <section className="mcp-admin mcp-editor">
      <button className="mcp-back" type="button" onClick={onBack}>← 返回服务器</button>
      <header className="mcp-editor-head">
        <div>
          <p className="kicker">{server ? "Server settings" : "New connection"}</p>
          <h1>{server ? `配置 ${server.latest_config?.title ?? server.server_id}` : "连接至自定义 MCP"}</h1>
          <p>连接由 AuraClaw Credential Proxy 发起。只填写凭据引用，不要在这里粘贴 Token 或 Secret。</p>
        </div>
        {server ? <span className={`pill ${server.desired_state === "enabled" ? "ok" : "off"}`}>{statusLabel(server)}</span> : null}
      </header>

      <div className="mcp-editor-layout">
        <div className="mcp-form-stack">
          <section className="mcp-form-section">
            <div className="mcp-section-title">
              <span>01</span>
              <div><h2>基本信息</h2><p>用于识别这个 Server，不会暴露给模型作为凭据。</p></div>
            </div>
            <div className="mcp-field-grid two">
              <label className="mcp-field">
                <span>名称</span>
                <input
                  aria-label="名称"
                  placeholder="例如：GitHub Tools"
                  value={form.title}
                  onChange={(event) => onChange({ ...form, title: event.target.value })}
                />
              </label>
              <label className="mcp-field">
                <span>Server ID</span>
                <input
                  aria-label="Server ID"
                  placeholder="github-tools"
                  value={form.server_id}
                  disabled={Boolean(server)}
                  onChange={(event) => onChange({ ...form, server_id: event.target.value })}
                />
                <small>{server ? "Server ID 是稳定标识，编辑时不可修改。" : "建议使用小写字母、数字和连字符。"}</small>
              </label>
            </div>
            <div className="mcp-transport-row">
              <span>连接类型</span>
              <div><button type="button" aria-pressed="true">Streamable HTTP</button></div>
              <small>AuraX 当前通过 AuraClaw 管理 HTTP MCP Server。</small>
            </div>
          </section>

          <section className="mcp-form-section">
            <div className="mcp-section-title">
              <span>02</span>
              <div><h2>连接</h2><p>Endpoint 相对 Credential Proxy 的网络环境解析。</p></div>
            </div>
            <label className="mcp-field">
              <span>Endpoint</span>
              <input
                aria-label="Endpoint"
                placeholder="http://127.0.0.1:8020/mcp 或 https://mcp.example/mcp"
                value={form.endpoint}
                onChange={(event) => onChange({ ...form, endpoint: event.target.value })}
              />
            </label>
            {networkMode ? (
              <div className={`mcp-network-hint ${networkMode}`}>
                <strong>{networkMode}</strong>
                <span>
                  {networkMode === "loopback"
                    ? "地址指向 Credential Proxy 所在环境，不是当前这台 Mac。"
                    : networkMode === "private"
                      ? "内网地址将自动生成对应的 Egress CIDR。"
                      : "公网地址必须使用 HTTPS，并配置受信认证。"}
                </span>
              </div>
            ) : null}
            <label className="mcp-field">
              <span>MCP Protocol Version</span>
              <select
                aria-label="MCP Protocol Version"
                value={form.protocol_revision}
                onChange={(event) => onChange({ ...form, protocol_revision: event.target.value as McpProtocolRevision })}
              >
                {MCP_PROTOCOL_REVISION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <small>{protocolHint}</small>
            </label>
          </section>

          <section className="mcp-form-section">
            <div className="mcp-section-title">
              <span>03</span>
              <div><h2>安全与能力范围</h2><p>认证由 Credential Proxy 解析，AuraX 只保存引用。</p></div>
            </div>
            <label className="mcp-field">
              <span>认证方式</span>
              <select
                aria-label="认证方式"
                value={form.auth_strategy}
                onChange={(event) => onChange({ ...form, auth_strategy: event.target.value as McpAuthStrategy })}
              >
                <option value="workload_trusted_context">{MCP_AUTH_LABEL.workload_trusted_context}</option>
                <option value="none">{MCP_AUTH_LABEL.none}</option>
              </select>
            </label>
            {form.auth_strategy === "workload_trusted_context" ? (
              <label className="mcp-field">
                <span>Credential reference</span>
                <input
                  aria-label="Credential reference"
                  placeholder="credential_ref（必填引用，不是明文）"
                  value={form.credential_ref}
                  onChange={(event) => onChange({ ...form, credential_ref: event.target.value })}
                />
                <small>示例：vault://team/mcp/github。请勿输入访问令牌。</small>
              </label>
            ) : (
              <div className="mcp-security-note">不会向远端发送 Authorization Bearer，仍受 AuraClaw Policy 与 Egress 控制。</div>
            )}
            {nonePublicConflict ? <p className="error">无远端认证不能用于 public endpoint。</p> : null}
          </section>

          {server ? (
            <McpServerOperations
              client={client}
              server={server}
              lifecycle={lifecycle}
              deleting={deleting}
              onAction={onAction}
              onDelete={onDelete}
            />
          ) : null}
        </div>

        <aside className="mcp-editor-summary">
          <p className="kicker">Summary</p>
          <h2>{form.title.trim() || "未命名服务器"}</h2>
          <dl>
            <div><dt>Server ID</dt><dd>{form.server_id.trim() || "—"}</dd></div>
            <div><dt>网络</dt><dd>{networkMode ?? "—"}</dd></div>
            <div><dt>认证</dt><dd>{MCP_AUTH_LABEL[form.auth_strategy]}</dd></div>
            <div><dt>协议</dt><dd>{form.protocol_revision}</dd></div>
            {server ? <div><dt>Revision</dt><dd>{server.latest_revision}</dd></div> : null}
          </dl>
          <div className="mcp-summary-callout">
            <strong>凭据安全</strong>
            <p>AuraX 不保存明文 Secret。连接测试和工具调用均由 AuraClaw 执行。</p>
          </div>
        </aside>
      </div>

      <footer className="mcp-editor-footer">
        <button className="btn ghost" type="button" onClick={onBack}>取消</button>
        <button className="btn" type="button" disabled={saving || nonePublicConflict} onClick={onSave}>
          {saving ? "保存中…" : server ? "保存更改" : "添加服务器"}
        </button>
      </footer>
      {saveError ? <p className="error mcp-editor-error">{errorText(saveError)}</p> : null}
      {deleteError ? <p className="error mcp-editor-error">{errorText(deleteError)}</p> : null}
    </section>
  );
}

function McpServerOperations({
  client,
  server,
  lifecycle,
  deleting,
  onAction,
  onDelete,
}: {
  client: ClawClient;
  server: McpServerRecord;
  lifecycle: LifecycleMutation;
  deleting: boolean;
  onAction: (server: McpServerRecord, action: LifecycleAction) => void;
  onDelete: (server: McpServerRecord) => void;
}) {
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const capabilities = useQuery({
    queryKey: ["mcp-capabilities", client.baseUrl, server.server_id],
    queryFn: async () =>
      (await listMcpCapabilities(client, server.server_id)).body,
    enabled: capabilitiesOpen,
  });
  const pendingAction =
    lifecycle.isPending && lifecycle.variables?.server.server_id === server.server_id
      ? lifecycle.variables.action
      : null;
  const retired = server.desired_state === "retired";
  return (
    <section className="mcp-form-section mcp-operations">
      <div className="mcp-section-title">
        <span>04</span>
        <div><h2>运行与目录</h2><p>探测连接、刷新 Catalog，并查看 Tool、Resource 与 Prompt。</p></div>
      </div>
      <div className="mcp-operation-grid">
        {(["test", server.desired_state === "enabled" ? "disable" : "enable", "reconcile"] as const).map((action) => (
          <button
            className="mcp-operation-button"
            type="button"
            key={action}
            disabled={lifecycle.isPending || deleting || retired}
            onClick={() => onAction(server, action)}
          >
            <span aria-hidden="true">{action === "test" ? "◉" : action === "reconcile" ? "↻" : "◐"}</span>
            <strong>{pendingAction === action ? "处理中…" : MCP_ACTION_LABEL[action]}</strong>
          </button>
        ))}
        <button className="mcp-operation-button" type="button" disabled={retired} onClick={() => setCapabilitiesOpen((open) => !open)}>
          <span aria-hidden="true">⌘</span><strong>{capabilitiesOpen ? "收起能力" : "查看能力"}</strong>
        </button>
      </div>
      {lifecycle.error ? <p className="error">{errorText(lifecycle.error)}</p> : null}
      {capabilitiesOpen ? (
        <CapabilityCatalog
          capabilities={capabilities.data?.capabilities ?? []}
          legacyFallback={capabilities.data?.legacy_tools_fallback === true}
          loading={capabilities.isPending}
          error={capabilities.error}
          checking={lifecycle.isPending}
          onHealthCheck={async (capability) => {
            await lifecycle.mutateAsync({ server, action: "test" });
            const refreshed = await capabilities.refetch();
            const current = refreshed.data?.capabilities.find(
              (item) => item.capability_id === capability.capability_id,
            );
            if (!current || current.status !== "active" || current.enabled === false) {
              throw new Error("连接可达，但能力未处于 active Catalog");
            }
            if (
              current.kind === "tool" &&
              (!current.input_schema || !current.output_schema)
            ) {
              throw new Error("能力可发现，但 Tool Schema 不完整");
            }
          }}
          onCapabilityTest={async (capability, input, expectedOutput) =>
            (
              await testMcpCapability(
                client,
                server.server_id,
                capability.capability_id,
                input,
                expectedOutput,
              )
            ).body
          }
        />
      ) : null}
      <div className="mcp-danger-zone">
        <div><strong>删除服务器</strong><p>{retired ? "此登记已删除，可从登记册永久清理。" : "删除后 AuraClaw 将不能再调用该服务器。"}</p></div>
        {!confirmDelete ? (
          <button className="btn danger ghost" type="button" disabled={deleting} onClick={() => setConfirmDelete(true)}>
            {retired ? "永久删除" : "删除服务器"}
          </button>
        ) : (
          <div className="row">
            <button className="btn danger" type="button" disabled={deleting} onClick={() => onDelete(server)}>{deleting ? "删除中…" : "确认删除"}</button>
            <button className="btn ghost" type="button" disabled={deleting} onClick={() => setConfirmDelete(false)}>取消</button>
          </div>
        )}
      </div>
    </section>
  );
}

const CAPABILITY_KIND_ORDER: McpCapabilityKind[] = [
  "tool",
  "resource",
  "resource_template",
  "prompt",
];

function capabilityKindLabel(kind: McpCapabilityKind): string {
  if (kind === "tool") return "Tool";
  if (kind === "prompt") return "Prompt";
  return "Resource";
}

function capabilityPrefix(capability: McpCapability): string {
  const locator = capability.uri ?? capability.uri_template;
  if (locator?.includes(":")) return locator.split(":", 1)[0] || "其他";
  return capability.canonical_name.split(/[./:]/, 1)[0] || "其他";
}

type HealthState = {
  status: "checking" | "healthy" | "failed";
  detail: string;
};

function CapabilityCatalog({
  capabilities,
  legacyFallback,
  loading,
  error,
  checking,
  onHealthCheck,
  onCapabilityTest,
}: {
  capabilities: McpCapability[];
  legacyFallback: boolean;
  loading: boolean;
  error: Error | null;
  checking: boolean;
  onHealthCheck: (capability: McpCapability) => Promise<void>;
  onCapabilityTest: (
    capability: McpCapability,
    input: Record<string, unknown>,
    expectedOutput?: unknown,
  ) => Promise<McpCapabilityTestResult>;
}) {
  const [filter, setFilter] = useState<"all" | "tool" | "resource" | "prompt">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [health, setHealth] = useState<Record<string, HealthState>>({});
  const normalizedKind = (kind: McpCapabilityKind) =>
    kind === "resource_template" ? "resource" : kind;
  const filtered = capabilities.filter(
    (capability) => filter === "all" || normalizedKind(capability.kind) === filter,
  );
  const kindGroups = CAPABILITY_KIND_ORDER.reduce<Array<{
    kind: "tool" | "resource" | "prompt";
    capabilities: McpCapability[];
  }>>((groups, kind) => {
    const normalized = normalizedKind(kind);
    const matches = filtered.filter(
      (capability) => normalizedKind(capability.kind) === normalized,
    );
    if (
      matches.length > 0 &&
      !groups.some((group) => group.kind === normalized)
    ) {
      groups.push({ kind: normalized, capabilities: matches });
    }
    return groups;
  }, []);

  const runHealthCheck = async (capability: McpCapability) => {
    setHealth((current) => ({
      ...current,
      [capability.capability_id]: {
        status: "checking",
        detail: "正在探测连接并校验 Catalog…",
      },
    }));
    try {
      await onHealthCheck(capability);
      setHealth((current) => ({
        ...current,
        [capability.capability_id]: {
          status: "healthy",
          detail: `连接、目录与 Schema 正常 · ${new Date().toLocaleTimeString()}`,
        },
      }));
    } catch (healthError) {
      setHealth((current) => ({
        ...current,
        [capability.capability_id]: {
          status: "failed",
          detail: errorText(healthError),
        },
      }));
    }
  };

  return (
    <div className="mcp-capability-panel">
      <header className="mcp-capability-head">
        <div>
          <strong>能力目录</strong>
          <p>按能力类型与一级前缀分组。支持目录检查与只读能力输入调用。</p>
        </div>
        <span>{capabilities.length} 个能力</span>
      </header>
      <div className="mcp-capability-tabs" role="tablist" aria-label="能力类型">
        {(["all", "tool", "resource", "prompt"] as const).map((kind) => {
          const count =
            kind === "all"
              ? capabilities.length
              : capabilities.filter(
                  (capability) => normalizedKind(capability.kind) === kind,
                ).length;
          return (
            <button
              key={kind}
              type="button"
              role="tab"
              aria-selected={filter === kind}
              onClick={() => setFilter(kind)}
            >
              {kind === "all" ? "全部" : capabilityKindLabel(kind)} <span>{count}</span>
            </button>
          );
        })}
      </div>
      {legacyFallback ? (
        <div className="mcp-capability-compat" role="status">
          当前 AuraClaw 尚未提供完整能力接口，已自动回退到旧版 Tool 目录。
          升级后将自动显示 Resource、Prompt 与完整 Schema。
        </div>
      ) : null}
      {loading ? <p className="mono">正在读取能力目录…</p> : null}
      {error ? <p className="error">{errorText(error)}</p> : null}
      {!loading && !error && filtered.length === 0 ? (
        <p className="empty">这个分组中还没有已对账的能力。</p>
      ) : null}
      <div className="mcp-capability-kinds">
        {kindGroups.map((kindGroup) => {
          const prefixes = new Map<string, McpCapability[]>();
          for (const capability of kindGroup.capabilities) {
            const prefix = capabilityPrefix(capability);
            prefixes.set(prefix, [...(prefixes.get(prefix) ?? []), capability]);
          }
          return (
            <section className="mcp-capability-kind" key={kindGroup.kind}>
              <div className="mcp-capability-kind-title">
                <h3>{capabilityKindLabel(kindGroup.kind)}</h3>
                <span>{kindGroup.capabilities.length}</span>
              </div>
              {[...prefixes.entries()].map(([prefix, items]) => (
                <div className="mcp-prefix-group" key={prefix}>
                  <div className="mcp-prefix-title">
                    <span className="mono">{prefix}</span>
                    <i>{items.length}</i>
                  </div>
                  <div className="mcp-capability-list">
                    {items.map((capability) => {
                      const isExpanded = expanded === capability.capability_id;
                      const healthState = health[capability.capability_id];
                      return (
                        <article className="mcp-capability-card" key={capability.capability_id}>
                          <button
                            className="mcp-capability-summary"
                            type="button"
                            aria-expanded={isExpanded}
                            onClick={() =>
                              setExpanded(isExpanded ? null : capability.capability_id)
                            }
                          >
                            <span>
                              <strong>{capability.title || capability.canonical_name}</strong>
                              <small className="mono">{capability.canonical_name}</small>
                            </span>
                            <span className="mcp-capability-tags">
                              <i className={capability.read_only ? "readonly" : "approval"}>
                                {capability.read_only ? "只读" : capability.permission ?? "需审批"}
                              </i>
                              <i className={capability.enabled !== false && capability.status === "active" ? "active" : "inactive"}>
                                {capability.enabled !== false && capability.status === "active" ? "已开启" : capability.status}
                              </i>
                              {capability.risk_level ? <i>{capability.risk_level}</i> : null}
                              <b aria-hidden="true">{isExpanded ? "−" : "＋"}</b>
                            </span>
                          </button>
                          {isExpanded ? (
                            <div className="mcp-capability-detail">
                              {capability.description ? <p>{capability.description}</p> : null}
                              <dl>
                                <div><dt>类型</dt><dd>{capabilityKindLabel(capability.kind)}</dd></div>
                                <div><dt>版本</dt><dd>{capability.version}</dd></div>
                                {capability.uri ? <div><dt>URI</dt><dd>{capability.uri}</dd></div> : null}
                                {capability.uri_template ? <div><dt>URI 模板</dt><dd>{capability.uri_template}</dd></div> : null}
                                {capability.mime_type ? <div><dt>MIME</dt><dd>{capability.mime_type}</dd></div> : null}
                              </dl>
                              <CapabilitySchema capability={capability} />
                              <div className="mcp-health-row">
                                <div>
                                  <strong>无副作用模拟检查</strong>
                                  <p>检查 Server 连通性、Catalog 可发现性与 Schema 完整性。</p>
                                </div>
                                <button
                                  className="btn ghost"
                                  type="button"
                                  disabled={checking || healthState?.status === "checking"}
                                  onClick={() => void runHealthCheck(capability)}
                                >
                                  {healthState?.status === "checking" ? "检查中…" : "模拟检查"}
                                </button>
                              </div>
                              {healthState ? (
                                <p className={`mcp-health-result ${healthState.status}`}>
                                  {healthState.detail}
                                </p>
                              ) : null}
                              <CapabilityInvocation
                                capability={capability}
                                disabled={legacyFallback}
                                onInvoke={onCapabilityTest}
                              />
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function CapabilitySchema({ capability }: { capability: McpCapability }) {
  if (capability.kind === "tool") {
    return (
      <div className="mcp-schema-grid">
        <details>
          <summary>Input Schema</summary>
          <pre>{JSON.stringify(capability.input_schema ?? {}, null, 2)}</pre>
        </details>
        <details>
          <summary>Output Schema</summary>
          <pre>{JSON.stringify(capability.output_schema ?? {}, null, 2)}</pre>
        </details>
      </div>
    );
  }
  if (capability.kind === "prompt") {
    return (
      <details className="mcp-schema-single">
        <summary>Prompt 参数 Schema</summary>
        <pre>{JSON.stringify(capability.arguments ?? [], null, 2)}</pre>
      </details>
    );
  }
  return (
    <details className="mcp-schema-single">
      <summary>Resource 描述</summary>
      <pre>{JSON.stringify({
        uri: capability.uri,
        uri_template: capability.uri_template,
        mime_type: capability.mime_type,
        size: capability.size,
      }, null, 2)}</pre>
    </details>
  );
}

function sampleFromSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return null;
  const value = schema as Record<string, unknown>;
  if ("default" in value) return value.default;
  if ("example" in value) return value.example;
  if (Array.isArray(value.enum) && value.enum.length > 0) return value.enum[0];
  if (value.type === "object") {
    const properties = value.properties;
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) return {};
    const required = new Set(Array.isArray(value.required) ? value.required.map(String) : []);
    const entries = Object.entries(properties as Record<string, unknown>);
    const selected = required.size > 0 ? entries.filter(([key]) => required.has(key)) : entries;
    return Object.fromEntries(selected.map(([key, child]) => [key, sampleFromSchema(child)]));
  }
  if (value.type === "array") return [];
  if (value.type === "boolean") return false;
  if (value.type === "integer" || value.type === "number") return 0;
  return "";
}

function sampleCapabilityInput(capability: McpCapability): Record<string, unknown> {
  if (capability.kind === "tool") {
    const sample = sampleFromSchema(capability.input_schema);
    return sample && typeof sample === "object" && !Array.isArray(sample)
      ? sample as Record<string, unknown>
      : {};
  }
  if (capability.kind === "prompt") {
    return Object.fromEntries((capability.arguments ?? []).map((argument) => [argument.name, ""]));
  }
  if (capability.uri) return {};
  return { uri: capability.uri_template ?? "" };
}

function CapabilityInvocation({
  capability,
  disabled,
  onInvoke,
}: {
  capability: McpCapability;
  disabled: boolean;
  onInvoke: (
    capability: McpCapability,
    input: Record<string, unknown>,
    expectedOutput?: unknown,
  ) => Promise<McpCapabilityTestResult>;
}) {
  const [inputText, setInputText] = useState(() =>
    JSON.stringify(sampleCapabilityInput(capability), null, 2),
  );
  const [expectedText, setExpectedText] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<McpCapabilityTestResult | null>(null);
  const [invokeError, setInvokeError] = useState<string | null>(null);
  const writeTool = capability.kind === "tool" && !capability.read_only;

  const invoke = async () => {
    setInvokeError(null);
    setResult(null);
    try {
      const parsedInput: unknown = JSON.parse(inputText || "{}");
      if (!parsedInput || typeof parsedInput !== "object" || Array.isArray(parsedInput)) {
        throw new Error("模拟 Input 必须是 JSON 对象");
      }
      const expectedOutput: unknown = expectedText.trim()
        ? JSON.parse(expectedText)
        : undefined;
      setRunning(true);
      setResult(await onInvoke(
        capability,
        parsedInput as Record<string, unknown>,
        expectedOutput,
      ));
    } catch (error) {
      setInvokeError(errorText(error));
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="mcp-invocation-test">
      <div className="mcp-invocation-head">
        <div>
          <strong>模拟 Input 调用</strong>
          <p>真实调用只读能力，并用 Output Schema 与可选期望子集检查结果。</p>
        </div>
        <button
          className="btn"
          type="button"
          disabled={disabled || writeTool || running}
          onClick={() => void invoke()}
        >
          {running ? "调用中…" : "运行测试"}
        </button>
      </div>
      {writeTool ? (
        <p className="mcp-test-guard">写操作能力不会从管理页执行，请通过正式审批链路验证。</p>
      ) : disabled ? (
        <p className="mcp-test-guard">当前为旧版能力目录，升级 AuraClaw 后可执行输入调用。</p>
      ) : (
        <div className="mcp-test-inputs">
          <label>
            <span>模拟 Input</span>
            <textarea aria-label={`${capability.title} 模拟 Input`} value={inputText} onChange={(event) => setInputText(event.target.value)} />
          </label>
          <label>
            <span>期望 Output（可选 JSON 子集）</span>
            <textarea aria-label={`${capability.title} 期望 Output`} placeholder={'例如：{\n  "status": "ok"\n}'} value={expectedText} onChange={(event) => setExpectedText(event.target.value)} />
          </label>
        </div>
      )}
      {invokeError ? <p className="mcp-health-result failed">{invokeError}</p> : null}
      {result ? (
        <div className={`mcp-test-result ${result.status}`} role="status">
          <div>
            <strong>{result.status === "passed" ? "测试通过" : "测试未通过"}</strong>
            <span>{result.duration_ms} ms</span>
            {result.schema_valid !== null ? <i>Schema {result.schema_valid ? "通过" : "失败"}</i> : null}
            {result.expectation_matched !== null ? <i>期望 {result.expectation_matched ? "匹配" : "不匹配"}</i> : null}
          </div>
          {result.error ? <p>{result.error}</p> : null}
          <details open>
            <summary>实际 Output</summary>
            <pre>{JSON.stringify(result.output, null, 2)}</pre>
          </details>
        </div>
      ) : null}
    </section>
  );
}
