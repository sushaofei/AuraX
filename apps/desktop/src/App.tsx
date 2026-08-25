import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ClawApiError,
  ClawClient,
  MOCK_IDENTITY,
  cancelTask,
  createMcpServer,
  createTask,
  inferMcpNetworkMode,
  followUp,
  getSkill,
  getTask,
  getTranscript,
  listMcpServers,
  listMcpTools,
  listSkills,
  listTasks,
  mcpLifecycle,
  openTaskStream,
  readSse,
  respondToApproval,
  toggleSkill,
  type McpLifecycleAction,
  type McpServerRecord,
  type SkillSummary,
  type TaskView,
  type TranscriptMessage,
} from "@aurax/claw-sdk";
import { useEffect, useMemo, useState } from "react";
import { loadBaseUrl, saveBaseUrl } from "./connection";

type View = "chat" | "sessions" | "mcp" | "skills" | "settings";

function errorText(error: unknown): string {
  if (error instanceof ClawApiError) {
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : "未知错误";
}

const MCP_ACTION_LABEL: Record<McpLifecycleAction, string> = {
  test: "探测",
  enable: "启用",
  disable: "停用",
  reconcile: "对账",
  retire: "退役",
};

export function App() {
  const [view, setView] = useState<View>("chat");
  const [baseUrl, setBaseUrl] = useState(loadBaseUrl);
  const client = useMemo(() => new ClawClient({ baseUrl }), [baseUrl]);
  const [sessionId, setSessionId] = useState<string | null>(null);

  return (
    <div className="shell">
      <aside className="rail">
        <p className="brand">AuraX</p>
        <p className="brand-sub">AuraClaw 工作台</p>
        <nav>
          {(
            [
              ["chat", "对话"],
              ["sessions", "历史"],
              ["mcp", "MCP"],
              ["skills", "Skill"],
              ["settings", "连接"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => setView(id)}
              type="button"
            >
              {label}
            </button>
          ))}
        </nav>
        <p className="meta">
          {MOCK_IDENTITY.tenantId}
          <br />
          {MOCK_IDENTITY.deptId} / {MOCK_IDENTITY.userId}
          <br />
          关窗不会取消任务
        </p>
      </aside>
      <main className="stage">
        {view === "chat" ? (
          <ChatView client={client} sessionId={sessionId} onSession={setSessionId} />
        ) : null}
        {view === "sessions" ? (
          <SessionsView
            client={client}
            onOpen={(id) => {
              setSessionId(id);
              setView("chat");
            }}
          />
        ) : null}
        {view === "mcp" ? <McpView client={client} /> : null}
        {view === "skills" ? <SkillsView client={client} /> : null}
        {view === "settings" ? (
          <SettingsView
            baseUrl={baseUrl}
            onSave={(url) => {
              saveBaseUrl(url);
              setBaseUrl(url);
            }}
          />
        ) : null}
      </main>
    </div>
  );
}

function ChatView({
  client,
  sessionId,
  onSession,
}: {
  client: ClawClient;
  sessionId: string | null;
  onSession: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [streamNote, setStreamNote] = useState("");

  const task = useQuery({
    queryKey: ["task", client.baseUrl, sessionId],
    queryFn: async () => (await getTask(client, sessionId!)).body,
    enabled: Boolean(sessionId),
    refetchInterval: (query) => {
      const status = query.state.data?.run_status;
      return status && ["completed", "failed", "cancelled"].includes(status) ? false : 2500;
    },
  });
  const transcript = useQuery({
    queryKey: ["transcript", client.baseUrl, sessionId],
    queryFn: async () => (await getTranscript(client, sessionId!)).body,
    enabled: Boolean(sessionId),
    refetchInterval: 2000,
  });

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    const abort = new AbortController();
    let lastId: string | undefined;
    void (async () => {
      try {
        const stream = await openTaskStream(
          client,
          sessionId,
          lastId ? { lastEventId: lastId, signal: abort.signal } : { signal: abort.signal },
        );
        for await (const event of readSse(stream)) {
          lastId = event.id ?? lastId;
          if (event.event) {
            setStreamNote(event.event);
          }
          await queryClient.invalidateQueries({ queryKey: ["transcript"] });
          await queryClient.invalidateQueries({ queryKey: ["task"] });
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          setStreamNote(errorText(error));
        }
      }
    })();
    return () => abort.abort();
  }, [client, sessionId, queryClient, task.data?.run_id]);

  const send = useMutation({
    mutationFn: async (text: string) => {
      if (!sessionId) {
        const created = await createTask(client, { goal: text, source: "chat" });
        onSession(created.body.session_id);
        return created.body;
      }
      const current = task.data ?? (await getTask(client, sessionId)).body;
      if (current.status === "waiting_for_human") {
        throw new Error("当前等待人审，不能当普通追问发送");
      }
      return (await followUp(
        client,
        sessionId,
        text,
        current.projection_version,
        current.status,
      )).body;
    },
    onSuccess: () => {
      setDraft("");
      void queryClient.invalidateQueries();
    },
  });

  const cancel = useMutation({
    mutationFn: async () => {
      if (!sessionId || !task.data) {
        return;
      }
      await cancelTask(client, sessionId, task.data.projection_version);
    },
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const approve = useMutation({
    mutationFn: async (decision: "approved" | "rejected") => {
      const pending = transcript.data?.pending_approval;
      if (!sessionId || !pending || !task.data) {
        return;
      }
      await respondToApproval(
        client,
        sessionId,
        pending.approval_id,
        decision,
        task.data.projection_version,
      );
    },
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const messages: TranscriptMessage[] = transcript.data?.messages ?? [];

  return (
    <section>
      <p className="kicker">Live bench</p>
      <h1>对话</h1>
      <p className="lede">
        发送即创建 AuraClaw Session。流式只用于展示，最终以 transcript / result 为准。关闭窗口不会取消任务。
      </p>
      {sessionId ? (
        <p className="mono">
          {sessionId} · {task.data?.status ?? "…"} / {task.data?.run_status ?? "…"}
          {streamNote ? ` · ${streamNote}` : ""}
        </p>
      ) : (
        <p className="empty">还没有 Session。输入目标后开始一轮对话。</p>
      )}
      <div className="transcript">
        {messages.map((message, index) => (
          <div
            key={message.event_id ?? `${message.role}-${index}`}
            className={`bubble ${message.role === "user" ? "user" : "assistant"}`}
          >
            {message.content}
          </div>
        ))}
      </div>
      {transcript.data?.pending_approval ? (
        <div className="card">
          <strong>待人审</strong>
          <p>{transcript.data.pending_approval.reason}</p>
          <p className="mono">{transcript.data.pending_approval.tool_name}</p>
          <div className="row">
            <button className="btn amber" type="button" onClick={() => approve.mutate("approved")}>
              批准
            </button>
            <button className="btn danger" type="button" onClick={() => approve.mutate("rejected")}>
              拒绝
            </button>
          </div>
        </div>
      ) : null}
      <div className="stack">
        <textarea
          value={draft}
          placeholder="要 AuraClaw 做什么？"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && draft.trim()) {
              send.mutate(draft.trim());
            }
          }}
        />
        <div className="row">
          <button
            className="btn"
            type="button"
            disabled={!draft.trim() || send.isPending}
            onClick={() => send.mutate(draft.trim())}
          >
            {sessionId ? "追问" : "开始"}
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={!sessionId || cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            取消当前 Run
          </button>
        </div>
        {send.error ? <p className="error">{errorText(send.error)}</p> : null}
      </div>
    </section>
  );
}

function SessionsView({
  client,
  onOpen,
}: {
  client: ClawClient;
  onOpen: (sessionId: string) => void;
}) {
  const list = useQuery({
    queryKey: ["tasks", client.baseUrl],
    queryFn: async () => (await listTasks(client, { kind: "chat", limit: 50 })).body,
  });
  return (
    <section>
      <p className="kicker">Archive</p>
      <h1>历史</h1>
      <p className="lede">只显示 source=chat 的 Root Session。权威在 AuraClaw，本机不做事实源。</p>
      {list.error ? <p className="error">{errorText(list.error)}</p> : null}
      <div className="list">
        {(list.data?.tasks ?? []).map((item: TaskView) => (
          <button
            key={item.session_id}
            className="item"
            type="button"
            onClick={() => onOpen(item.session_id)}
          >
            <div>
              <div>{item.goal}</div>
              <div className="mono">
                {item.session_id} · {item.status} · {item.projected_at}
              </div>
            </div>
            <span className="pill">{item.run_status ?? item.status}</span>
          </button>
        ))}
      </div>
      {list.data && list.data.tasks.length === 0 ? (
        <p className="empty">还没有对话 Session。</p>
      ) : null}
    </section>
  );
}

function McpView({ client }: { client: ClawClient }) {
  const queryClient = useQueryClient();
  const servers = useQuery({
    queryKey: ["mcp", client.baseUrl],
    queryFn: async () => (await listMcpServers(client)).body.servers,
  });
  const [form, setForm] = useState({
    server_id: "",
    title: "",
    endpoint: "",
    credential_ref: "",
    allowed_tool_prefixes: "",
  });
  const create = useMutation({
    mutationFn: async () => {
      if (!form.credential_ref.trim()) {
        throw new Error("workload_trusted_context 必须填写 credential_ref，不要贴明文 Secret");
      }
      const endpoint = form.endpoint.trim();
      await createMcpServer(client, {
        server_id: form.server_id.trim(),
        title: form.title.trim(),
        endpoint,
        network_mode: inferMcpNetworkMode(endpoint),
        auth_strategy: "workload_trusted_context",
        credential_ref: form.credential_ref.trim(),
        allowed_tool_prefixes: form.allowed_tool_prefixes
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean),
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["mcp"] });
    },
  });
  const act = useMutation({
    mutationFn: async (input: {
      server: McpServerRecord;
      action: McpLifecycleAction;
    }) => {
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
        只登记 AuraClaw 受管 Server。凭证填 credential_ref，不要贴明文 Secret。loopback 相对的是
        Credential Proxy，不是这台 Mac。
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
        {form.endpoint.trim() ? (
          <p className="mono">
            {inferMcpNetworkMode(form.endpoint) === "loopback"
              ? "将以 loopback 登记（相对 Credential Proxy，不是这台 Mac）"
              : "将以 public 登记（需 HTTPS 公网地址）"}
          </p>
        ) : null}
        <input
          placeholder="credential_ref（必填引用，不是明文）"
          value={form.credential_ref}
          onChange={(event) => setForm({ ...form, credential_ref: event.target.value })}
        />
        <input
          placeholder="allowed_tool_prefixes，逗号分隔"
          value={form.allowed_tool_prefixes}
          onChange={(event) => setForm({ ...form, allowed_tool_prefixes: event.target.value })}
        />
        <button className="btn" type="button" onClick={() => create.mutate()}>
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
              <span className={`pill ${server.desired_state === "enabled" ? "ok" : server.desired_state === "retired" ? "off" : ""}`}>
                {server.desired_state}
              </span>
            </div>
            <p className="mono">
              {server.server_id} · observed {server.runtime?.observed_state ?? "—"} · rev{" "}
              {server.latest_revision}
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
                  {tool.title && tool.title !== tool.canonical_name ? (
                    <p>{tool.title}</p>
                  ) : null}
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

function SkillsView({ client }: { client: ClawClient }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<{ publisher: string; name: string } | null>(null);
  const skills = useQuery({
    queryKey: ["skills", client.baseUrl],
    queryFn: async () => (await listSkills(client)).body.skills,
  });
  const detail = useQuery({
    queryKey: ["skill", client.baseUrl, selected],
    queryFn: async () => (await getSkill(client, selected!.publisher, selected!.name)).body,
    enabled: Boolean(selected),
  });
  const toggle = useMutation({
    mutationFn: async (input: { skill: SkillSummary; action: "enable" | "disable" }) => {
      await toggleSkill(client, input.skill.publisher, input.skill.name, input.action);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["skills"] });
      void queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
  return (
    <section>
      <p className="kicker">Catalog</p>
      <h1>Skill</h1>
      <p className="lede">只读目录与租户启停。没有发布入口，也不会在本机执行 Skill。</p>
      <div className="list">
        {(skills.data ?? []).map((skill) => (
          <div key={`${skill.publisher}/${skill.name}`} className="card">
            <div className="row">
              <button className="btn ghost" type="button" onClick={() => setSelected(skill)}>
                {skill.publisher}/{skill.name}
              </button>
              <span className={`pill ${skill.status === "active" ? "ok" : "off"}`}>
                {skill.status}
              </span>
              <button
                className="btn ghost"
                type="button"
                onClick={() =>
                  toggle.mutate({
                    skill,
                    action: skill.status === "active" ? "disable" : "enable",
                  })
                }
              >
                {skill.status === "active" ? "停用" : "启用"}
              </button>
            </div>
            <p>{skill.description}</p>
          </div>
        ))}
      </div>
      {detail.data ? (
        <article className="card" style={{ marginTop: 16 }}>
          <h2>
            {detail.data.publisher}/{detail.data.name}@{detail.data.version}
          </h2>
          <pre className="mono">{detail.data.skill_markdown}</pre>
        </article>
      ) : null}
    </section>
  );
}

function SettingsView({
  baseUrl,
  onSave,
}: {
  baseUrl: string;
  onSave: (url: string) => void;
}) {
  const [draft, setDraft] = useState(baseUrl);
  return (
    <section>
      <p className="kicker">Uplink</p>
      <h1>连接</h1>
      <p className="lede">
        v1 只允许改 AuraClaw base URL。开发时留空会走 Vite 同源代理。身份固定为 platform / local-org /
        local-user，界面不能切换账号。
      </p>
      <div className="card stack">
        <label>
          AuraClaw URL
          <input
            value={draft}
            placeholder="开发环境留空 = 代理到 http://127.0.0.1:8080"
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <button className="btn" type="button" onClick={() => onSave(draft.trim())}>
          保存
        </button>
        <p className="mono">
          X-Tenant-ID: {MOCK_IDENTITY.tenantId}
          <br />
          X-Dept-ID: {MOCK_IDENTITY.deptId}
          <br />
          X-Actor-ID: {MOCK_IDENTITY.userId}
        </p>
      </div>
    </section>
  );
}
