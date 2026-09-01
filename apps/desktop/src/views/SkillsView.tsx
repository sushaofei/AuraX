import {
  changeSkillInstallation,
  changeSkillPublisherStatus,
  getSkill,
  getSkillAdmissionMetrics,
  getSkillManagement,
  getSkillSourceSyncState,
  listSkillAdmissions,
  listSkillCatalog,
  listSkillPublishers,
  listSkillSources,
  normalizeSkillPackageFiles,
  publishSkillFiles,
  publishSkillFilesStaged,
  purgeSkillPackage,
  registerSkillPublisher,
  restoreSkillPublication,
  retireSkillSource,
  revokeSkillPublisherKey,
  revokeSkillPublication,
  rotateSkillPublisherKey,
  saveSkillSource,
  syncSkillSource,
  type ClawClient,
  type SkillCatalogItem,
  type SkillPublisherView,
  type SkillSourceInput,
  type SkillSourceRecord,
} from "@aurax/claw-sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { MarkdownBody } from "../components/MarkdownBody";
import { errorText } from "../lib/errors";

type SkillTab = "catalog" | "sources" | "publishers" | "admissions";

const EMPTY_SOURCE: SkillSourceInput = {
  source_id: "",
  kind: "mcp",
  desired_state: "disabled",
  publisher_allowlist: [],
  credential_ref: null,
  config_metadata: {},
  priority: 0,
};

export function SkillsView({ client }: { client: ClawClient }) {
  const [tab, setTab] = useState<SkillTab>("catalog");
  return (
    <section className="skill-admin">
      <p className="kicker">Governed capability</p>
      <h1>Skill</h1>
      <p className="lede">
        管理 Catalog、租户安装、MCP 来源、Publisher 公钥、签名包发布与 Admission 审计。AuraX 不执行或签名 Skill。
      </p>
      <div className="skill-admin-tabs" role="tablist" aria-label="Skill 管理视图">
        {(["catalog", "sources", "publishers", "admissions"] as const).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            className={`btn ${tab === item ? "amber" : "ghost"}`}
            onClick={() => setTab(item)}
          >
            {item === "catalog" ? "Catalog" : item === "sources" ? "Sources" : item === "publishers" ? "Publishers" : "Admissions"}
          </button>
        ))}
      </div>
      {tab === "catalog" ? <CatalogPanel client={client} /> : null}
      {tab === "sources" ? <SourcesPanel client={client} /> : null}
      {tab === "publishers" ? <PublishersPanel client={client} /> : null}
      {tab === "admissions" ? <AdmissionsPanel client={client} /> : null}
    </section>
  );
}

function CatalogPanel({ client }: { client: ClawClient }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SkillCatalogItem | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [packageFiles, setPackageFiles] = useState<File[]>([]);
  const catalog = useQuery({
    queryKey: ["skill-catalog", client.baseUrl, search],
    queryFn: async () => (await listSkillCatalog(client, { q: search, limit: 200 })).body.items ?? [],
  });
  const detail = useQuery({
    queryKey: ["skill-detail", client.baseUrl, selected?.publisher, selected?.name],
    queryFn: async () => (await getSkill(client, selected!.publisher, selected!.name)).body,
    enabled: selected !== null,
  });
  const management = useQuery({
    queryKey: ["skill-management", client.baseUrl, selected?.publisher, selected?.name],
    queryFn: async () => (await getSkillManagement(client, selected!.publisher, selected!.name)).body,
    enabled: selected !== null,
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["skill-catalog"] });
    void queryClient.invalidateQueries({ queryKey: ["skill-management"] });
    void queryClient.invalidateQueries({ queryKey: ["skills"] });
  };
  const lifecycle = useMutation({
    mutationFn: async (input: { skill: SkillCatalogItem; action: "install" | "enable" | "disable" | "uninstall"; force?: boolean }) => {
      const installation = input.skill.installation;
      if (!installation) throw new Error("后端未返回 Installation；请刷新后重试");
      const needsReason = input.action === "disable" || input.action === "uninstall";
      const reasonCode = needsReason ? window.prompt("请输入治理 reason code", input.action === "disable" ? "user_disabled" : "no_longer_needed")?.trim() : undefined;
      if (needsReason && !reasonCode) throw new Error("该操作需要 reason code");
      const options: { reasonCode?: string; force?: boolean } = {};
      if (reasonCode) options.reasonCode = reasonCode;
      if (input.force) options.force = true;
      return changeSkillInstallation(
        client,
        input.skill,
        input.action,
        installation.revision,
        options,
      );
    },
    onSuccess: refresh,
  });
  const govern = useMutation({
    mutationFn: async (input: { kind: "revoke" | "restore" | "purge"; index: number }) => {
      const version = management.data!.versions[input.index]!;
      const reason = window.prompt("请输入治理 reason code", `operator_${input.kind}`)?.trim();
      if (!reason) throw new Error("该操作需要 reason code");
      if (input.kind === "revoke") {
        const action = window.prompt("运行时动作：continue / pause / cancel", "cancel");
        if (action !== "continue" && action !== "pause" && action !== "cancel") throw new Error("撤销动作无效");
        return revokeSkillPublication(client, version.publication, reason, action);
      }
      if (input.kind === "restore") return restoreSkillPublication(client, version.publication, reason);
      if (!version.package) throw new Error("Package 状态不可用");
      if (!window.confirm(`确认永久清理 ${version.package.publisher}/${version.package.name}@${version.package.version}？`)) throw new Error("已取消");
      return purgeSkillPackage(client, version.package, reason);
    },
    onSuccess: refresh,
  });
  const publish = useMutation({
    mutationFn: async () => {
      if (!sourceId.trim() || packageFiles.length === 0) throw new Error("请选择来源和已签名包文件");
      const selectedFiles = normalizeSkillPackageFiles(
        packageFiles.map((file) => [file.webkitRelativePath || file.name, file] as const),
      );
      const files: Record<string, string> = {};
      for (const [path, file] of Object.entries(selectedFiles)) files[path] = await fileBase64(file);
      const encodedBytes = Object.values(files).reduce((total, value) => total + value.length, 0);
      return encodedBytes > 8 * 1024 * 1024
        ? publishSkillFilesStaged(client, sourceId.trim(), files)
        : publishSkillFiles(client, sourceId.trim(), files);
    },
    onSuccess: () => {
      setPackageFiles([]);
      refresh();
    },
  });

  return (
    <div className="skill-admin-grid">
      <div>
        <div className="card stack skill-toolbar">
          <label>搜索 Catalog<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="publisher、名称或描述" /></label>
          <details>
            <summary>发布已签名 Skill 包（小包）</summary>
            <div className="stack form-block">
              <label>Source ID<input value={sourceId} onChange={(event) => setSourceId(event.target.value)} placeholder="sks_..." /></label>
              <label>包目录<input type="file" multiple {...({ webkitdirectory: "" } as Record<string, string>)} onChange={(event) => setPackageFiles(Array.from(event.target.files ?? []))} /></label>
              <p className="mono">私钥不得进入 AuraX。请先离线签名；大包由 AuraClaw 代理写入对象存储，最终签名、digest 与内容策略也由 AuraClaw 校验。</p>
              <button className="btn amber" type="button" disabled={publish.isPending} onClick={() => publish.mutate()}>发布</button>
            </div>
          </details>
          {publish.error ? (
            <p className="error">
              {errorText(publish.error, {
                redactedForbiddenMessage:
                  "Skill 发布被策略拒绝；请在 Admissions 查看拒绝阶段和错误码。",
              })}
            </p>
          ) : null}
        </div>
        <div className="list skill-list">
          {(catalog.data ?? []).map((skill) => (
            <button className="item" type="button" key={`${skill.publisher}/${skill.name}`} onClick={() => setSelected(skill)}>
              <span><strong>{skill.publisher}/{skill.name}</strong><span className="mono">@{skill.latest_version ?? skill.version} · {skill.risk_level}</span></span>
              <span className={`pill ${skill.availability === "available" ? "ok" : "off"}`}>{skill.availability ?? skill.status}</span>
            </button>
          ))}
        </div>
        {catalog.error ? <p className="error">{errorText(catalog.error)}</p> : null}
        {catalog.data?.length === 0 ? <p className="empty">没有匹配的 Skill。</p> : null}
      </div>
      <aside>
        {!selected ? <div className="card empty">选择一个 Skill 查看治理详情。</div> : null}
        {selected ? (
          <div className="card stack">
            <div className="row"><h2>{selected.publisher}/{selected.name}</h2><span className="pill">{selected.risk_level}</span></div>
            <p>{selected.description}</p>
            <div className="row">
              {selected.installation?.status === "active" ? <button className="btn ghost" type="button" onClick={() => lifecycle.mutate({ skill: selected, action: "disable" })}>停用</button> : null}
              {selected.installation?.status === "disabled" ? <button className="btn amber" type="button" onClick={() => lifecycle.mutate({ skill: selected, action: "enable" })}>启用</button> : null}
              {selected.installation?.status === "uninstalled" ? <button className="btn amber" type="button" onClick={() => lifecycle.mutate({ skill: selected, action: "install" })}>重新安装</button> : null}
              {selected.installation && !["draining", "uninstalled"].includes(selected.installation.status) ? <button className="btn danger ghost" type="button" onClick={() => lifecycle.mutate({ skill: selected, action: "uninstall" })}>卸载（draining）</button> : null}
              {selected.installation && !["draining", "uninstalled"].includes(selected.installation.status) ? <button className="btn danger" type="button" onClick={() => window.confirm("Force 会取消使用此 Skill 的运行，确认继续？") && lifecycle.mutate({ skill: selected, action: "uninstall", force: true })}>强制卸载</button> : null}
            </div>
            {lifecycle.error ? <p className="error">{errorText(lifecycle.error)}</p> : null}
            <dl className="detail-list"><dt>Digest</dt><dd className="mono">{selected.package_digest}</dd><dt>Installation</dt><dd>{selected.installation?.status ?? "not installed"} / rev {selected.installation?.revision ?? "-"}</dd></dl>
            {management.data?.versions.map((version, index) => (
              <div className="governance-row" key={version.publication.version}>
                <div><strong>@{version.publication.version}</strong> <span className="pill">{version.publication.status}</span>{version.package ? <span className="pill">{version.package.retention_status}</span> : null}</div>
                <div className="row">
                  {version.publication.status === "retired" ? <button className="btn ghost" type="button" onClick={() => govern.mutate({ kind: "restore", index })}>恢复</button> : null}
                  {version.publication.status !== "revoked" ? <button className="btn danger ghost" type="button" onClick={() => govern.mutate({ kind: "revoke", index })}>撤销</button> : null}
                  {version.publication.status === "revoked" && version.package?.retention_status !== "purged" ? <button className="btn danger" type="button" onClick={() => govern.mutate({ kind: "purge", index })}>Purge</button> : null}
                </div>
              </div>
            ))}
            {govern.error ? <p className="error">{errorText(govern.error)}</p> : null}
            {detail.data?.skill_markdown ? <MarkdownBody text={detail.data.skill_markdown} /> : <p className="empty">没有 SKILL.md</p>}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function SourcesPanel({ client }: { client: ClawClient }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<SkillSourceRecord | null>(null);
  const [form, setForm] = useState<SkillSourceInput>(EMPTY_SOURCE);
  const [metadataText, setMetadataText] = useState("{}");
  const sources = useQuery({ queryKey: ["skill-sources", client.baseUrl], queryFn: async () => (await listSkillSources(client)).body.sources });
  const syncState = useQuery({ queryKey: ["skill-source-sync", client.baseUrl, editing?.source_id], queryFn: async () => (await getSkillSourceSyncState(client, editing!.source_id)).body.sync_state, enabled: editing !== null });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["skill-sources"] });
  const save = useMutation({ mutationFn: () => {
    const metadata = JSON.parse(metadataText) as Record<string, unknown>;
    if (hasSensitiveMetadataKey(metadata)) throw new Error("config_metadata 不得包含 Secret；请使用 credential_ref");
    return saveSkillSource(client, { ...form, config_metadata: metadata }, editing);
  }, onSuccess: () => { setEditing(null); setForm(EMPTY_SOURCE); setMetadataText("{}"); refresh(); } });
  const sync = useMutation({ mutationFn: (source: SkillSourceRecord) => syncSkillSource(client, source.source_id), onSuccess: () => { refresh(); void queryClient.invalidateQueries({ queryKey: ["skill-source-sync"] }); } });
  const retire = useMutation({ mutationFn: async (source: SkillSourceRecord) => { const reason = window.prompt("退役 reason code", "source_retired")?.trim(); if (!reason) throw new Error("需要 reason code"); return retireSkillSource(client, source, reason); }, onSuccess: refresh });
  const select = (source: SkillSourceRecord) => { setEditing(source); setMetadataText(JSON.stringify(source.config_metadata, null, 2)); setForm({ source_id: source.source_id, kind: "mcp", desired_state: source.desired_state === "enabled" ? "enabled" : "disabled", publisher_allowlist: source.publisher_allowlist, credential_ref: source.credential_ref, config_metadata: source.config_metadata, priority: source.priority }); };
  return <div className="skill-admin-grid"><div className="list">{(sources.data ?? []).map((source) => <div className="card" key={source.source_id}><div className="row"><button className="btn ghost" type="button" onClick={() => select(source)}>{source.source_id}</button><span className="pill">{source.desired_state}</span><span className="mono">priority {source.priority} · rev {source.revision}</span><button className="btn ghost" type="button" disabled={source.desired_state !== "enabled" || sync.isPending} onClick={() => sync.mutate(source)}>同步</button><button className="btn danger ghost" type="button" onClick={() => retire.mutate(source)}>退役</button></div><p className="mono">Publisher allowlist: {source.publisher_allowlist.join(", ") || "—"} · credential_ref: {source.credential_ref || "—"}</p></div>)}</div><aside className="card stack"><h2>{editing ? "编辑 Source" : "创建 Source"}</h2><label>Source ID<input disabled={editing !== null} value={form.source_id} onChange={(e) => setForm({ ...form, source_id: e.target.value })} /></label><label>Desired state<select value={form.desired_state} onChange={(e) => setForm({ ...form, desired_state: e.target.value as "enabled" | "disabled" })}><option value="disabled">disabled</option><option value="enabled">enabled</option></select></label><label>Publisher allowlist<input value={form.publisher_allowlist.join(",")} onChange={(e) => setForm({ ...form, publisher_allowlist: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) })} /></label><label>Credential reference<input value={form.credential_ref ?? ""} onChange={(e) => setForm({ ...form, credential_ref: e.target.value || null })} /></label><label>Priority<input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} /></label><label>Config metadata JSON<textarea value={metadataText} onChange={(e) => setMetadataText(e.target.value)} /></label>{syncState.data ? <p className="mono">generation {syncState.data.generation} · failures {syncState.data.consecutive_failures} · {syncState.data.safe_error_code ?? "healthy"}</p> : null}<div className="row"><button className="btn amber" type="button" onClick={() => save.mutate()} disabled={save.isPending}>保存</button>{editing ? <button className="btn ghost" type="button" onClick={() => { setEditing(null); setForm(EMPTY_SOURCE); setMetadataText("{}"); }}>取消</button> : null}</div>{save.error || sync.error || retire.error ? <p className="error">{errorText(save.error ?? sync.error ?? retire.error)}</p> : null}</aside></div>;
}

function PublishersPanel({ client }: { client: ClawClient }) {
  const queryClient = useQueryClient();
  const [publisher, setPublisher] = useState(""); const [displayName, setDisplayName] = useState(""); const [keyId, setKeyId] = useState(""); const [publicKey, setPublicKey] = useState(""); const [selected, setSelected] = useState<SkillPublisherView | null>(null);
  const publishers = useQuery({ queryKey: ["skill-publishers", client.baseUrl], queryFn: async () => (await listSkillPublishers(client)).body.publishers });
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["skill-publishers"] }); setSelected(null); };
  const register = useMutation({ mutationFn: () => registerSkillPublisher(client, publisher.trim(), displayName.trim()), onSuccess: () => { setPublisher(""); setDisplayName(""); refresh(); } });
  const rotate = useMutation({ mutationFn: () => rotateSkillPublisherKey(client, selected!, keyId.trim(), publicKey.trim()), onSuccess: () => { setKeyId(""); setPublicKey(""); refresh(); } });
  const revokeKey = useMutation({ mutationFn: async (key: SkillPublisherView["keys"][number]) => { const reason = window.prompt("Key revoke reason code", "publisher_key_compromised")?.trim(); if (!reason) throw new Error("需要 reason code"); const action = window.prompt("运行时动作：pause / cancel", "cancel"); if (action !== "pause" && action !== "cancel") throw new Error("撤销动作无效"); if (!window.confirm(`撤销公钥 ${key.key_id}？`)) throw new Error("已取消"); return revokeSkillPublisherKey(client, selected!, key, reason, action); }, onSuccess: refresh });
  const status = useMutation({ mutationFn: async (action: "suspend" | "resume" | "revoke") => { const reason = window.prompt("Publisher reason code", `publisher_${action}`)?.trim(); if (!reason) throw new Error("需要 reason code"); if (action === "revoke" && !window.confirm("Publisher revoke 不可逆，确认继续？")) throw new Error("已取消"); return changeSkillPublisherStatus(client, selected!, action, reason); }, onSuccess: refresh });
  return <div className="skill-admin-grid"><div className="list">{(publishers.data ?? []).map((view) => <button type="button" className="item" key={view.publisher.publisher} onClick={() => setSelected(view)}><span><strong>{view.publisher.display_name}</strong><span className="mono">{view.publisher.publisher} · {view.keys.length} keys</span></span><span className={`pill ${view.publisher.status === "active" ? "ok" : "off"}`}>{view.publisher.status}</span></button>)}</div><aside className="card stack">{selected ? <><h2>{selected.publisher.publisher}</h2><p>Revision {selected.publisher.revision}</p><div className="row">{selected.publisher.status === "active" ? <button className="btn ghost" type="button" onClick={() => status.mutate("suspend")}>Suspend</button> : null}{selected.publisher.status === "suspended" ? <button className="btn amber" type="button" onClick={() => status.mutate("resume")}>Resume</button> : null}{selected.publisher.status !== "revoked" ? <button className="btn danger" type="button" onClick={() => status.mutate("revoke")}>Revoke</button> : null}</div><h3>轮换公钥</h3><label>Key ID<input value={keyId} onChange={(e) => setKeyId(e.target.value)} /></label><label>Ed25519 public key<input value={publicKey} onChange={(e) => setPublicKey(e.target.value)} /></label><button className="btn amber" type="button" onClick={() => rotate.mutate()}>登记公钥</button>{selected.keys.map((key) => <div className="row" key={key.key_id}><span className="mono">{key.key_id} · {key.status} · rev {key.revision}</span>{key.status !== "revoked" ? <button className="btn danger ghost" type="button" onClick={() => revokeKey.mutate(key)}>撤销 Key</button> : null}</div>)}</> : <><h2>注册 Publisher</h2><label>Publisher<input value={publisher} onChange={(e) => setPublisher(e.target.value)} /></label><label>Display name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label><button className="btn amber" type="button" onClick={() => register.mutate()}>注册</button><p className="mono">AuraX 只登记公钥；私钥和签名操作必须留在可信离线环境。</p></>}{register.error || rotate.error || revokeKey.error || status.error ? <p className="error">{errorText(register.error ?? rotate.error ?? revokeKey.error ?? status.error)}</p> : null}</aside></div>;
}

function AdmissionsPanel({ client }: { client: ClawClient }) {
  const [outcome, setOutcome] = useState("");
  const [cursor, setCursor] = useState<string | undefined>();
  const [history, setHistory] = useState<Array<string | undefined>>([]);
  const admissions = useQuery({ queryKey: ["skill-admissions", client.baseUrl, outcome, cursor], queryFn: async () => (await listSkillAdmissions(client, { ...(outcome ? { outcome } : {}), ...(cursor ? { cursor } : {}), limit: 100 })).body });
  const metrics = useQuery({ queryKey: ["skill-admission-metrics", client.baseUrl], queryFn: async () => (await getSkillAdmissionMetrics(client)).body });
  const alert = metrics.data?.alerts[0]; const counts = useMemo(() => metrics.data?.metrics.filter((metric) => metric.name === "skill.admission.count") ?? [], [metrics.data]);
  return <div className="stack"><div className="metric-grid"><div className="card"><strong>Quarantine ratio</strong><p className="metric-value">{alert ? `${(alert.value * 100).toFixed(1)}%` : "—"}</p><span className={`pill ${alert?.status === "firing" ? "off" : "ok"}`}>{alert?.status ?? "loading"}</span></div>{counts.map((metric) => <div className="card" key={JSON.stringify(metric.labels)}><strong>{metric.labels.outcome}</strong><p className="metric-value">{metric.value}</p><span className="mono">policy {metric.labels.content_policy_version}</span></div>)}</div><label>Outcome filter<select value={outcome} onChange={(e) => { setOutcome(e.target.value); setCursor(undefined); setHistory([]); }}><option value="">全部</option><option value="accepted">accepted</option><option value="rejected">rejected</option><option value="quarantined">quarantined</option></select></label><div className="list">{(admissions.data?.admissions ?? []).map((record) => <div className="card" key={record.admission_id}><div className="row"><span className={`pill ${record.outcome === "accepted" ? "ok" : "off"}`}>{record.outcome}</span><strong>{record.stage}</strong><span className="mono">{record.occurred_at}</span></div><p className="mono">{record.safe_error_code ?? "no error"} · policy {record.content_policy_version ?? "—"} · {record.duration_ms} ms</p></div>)}</div><div className="row"><button className="btn ghost" type="button" disabled={history.length === 0} onClick={() => { const previous = history.at(-1); setHistory((items) => items.slice(0, -1)); setCursor(previous); }}>上一页</button><button className="btn ghost" type="button" disabled={!admissions.data?.next_cursor} onClick={() => { setHistory((items) => [...items, cursor]); setCursor(admissions.data?.next_cursor ?? undefined); }}>下一页</button></div>{admissions.error || metrics.error ? <p className="error">{errorText(admissions.error ?? metrics.error)}</p> : null}</div>;
}

async function fileBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function hasSensitiveMetadataKey(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) =>
    /(secret|token|password|api[_-]?key|credential|private[_-]?key)/i.test(key)
      || hasSensitiveMetadataKey(child),
  );
}
