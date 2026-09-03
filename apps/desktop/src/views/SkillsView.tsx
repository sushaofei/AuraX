import {
  changeSkillInstallation,
  changeSkillPublisherStatus,
  getSkill,
  getSkillAdmissionMetrics,
  getSkillManagement,
  listSkillAdmissions,
  listSkillCatalog,
  listSkillPublishers,
  normalizeSkillPackageFiles,
  publishSkillFiles,
  publishSkillFilesStaged,
  purgeSkillPackage,
  registerSkillPublisher,
  restoreSkillPublication,
  revokeSkillPublisherKey,
  revokeSkillPublication,
  rotateSkillPublisherKey,
  type ClawClient,
  type SkillCatalogItem,
  type SkillPublisherView,
} from "@aurax/claw-sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { MarkdownBody } from "../components/MarkdownBody";
import { errorText } from "../lib/errors";

type SkillTab = "catalog" | "publishers" | "admissions";

const SKILL_LABELS: Record<string, string> = {
  active: "已启用", available: "可用", unavailable: "不可用", disabled: "已停用",
  draining: "等待任务结束", uninstalled: "已卸载", revoked: "已撤销", retired: "已退役",
  retained: "已保留", purged: "已清理", suspended: "已暂停", accepted: "已通过",
  rejected: "已拒绝", quarantined: "已隔离", low: "低风险", medium: "中风险", high: "高风险",
  firing: "告警中", ok: "正常", inactive: "未触发", insufficient_data: "样本不足",
  publication_unavailable: "发布不可用", not_installed: "未安装", dependencies_unavailable: "依赖不可用",
  installation_disabled: "不可调用", installation_draining: "停止接收新任务", installation_uninstalled: "不可调用",
};

function SkillBadge({ value }: { value: string }) {
  const tone = ["active", "available", "accepted", "ok", "low"].includes(value) ? "ok"
    : ["revoked", "rejected", "quarantined", "high", "firing"].includes(value) ? "off" : "";
  return <span className={`pill ${tone}`} title={value}>{SKILL_LABELS[value] ?? value}</span>;
}

function SkillSectionTitle({ number, title, description }: { number: string; title: string; description: string }) {
  return <div className="skill-section-title"><span>{number}</span><div><h2>{title}</h2><p>{description}</p></div></div>;
}

export function SkillsView({ client }: { client: ClawClient }) {
  const [tab, setTab] = useState<SkillTab>("catalog");
  return (
    <section className="skill-admin">
      <header className="skill-page-head">
        <p className="kicker">Capabilities</p><h1>Skill 技能库</h1>
        <p>发现与管理受管技能，让每一项能力的来源、状态和版本清晰可见。</p>
      </header>
      <div className="skill-admin-tabs" role="group" aria-label="Skill 管理视图">
        {(["catalog", "publishers", "admissions"] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={tab === item}
            className={tab === item ? "is-active" : ""}
            onClick={() => setTab(item)}
          >
            {item === "catalog" ? "技能目录" : item === "publishers" ? "发布者" : "准入审计"}
          </button>
        ))}
      </div>
      {tab === "catalog" ? <CatalogPanel client={client} /> : null}
      {tab === "publishers" ? <PublishersPanel client={client} /> : null}
      {tab === "admissions" ? <AdmissionsPanel client={client} /> : null}
      <p className="skill-trust-note">AuraX 不执行或签名 Skill。安装、发布和治理均由 AuraClaw 校验；私钥请保留在可信离线环境。</p>
    </section>
  );
}

function CatalogPanel({ client }: { client: ClawClient }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedIdentity, setSelectedIdentity] = useState<Pick<SkillCatalogItem, "publisher" | "name"> | null>(null);
  const [packageFiles, setPackageFiles] = useState<File[]>([]);
  const [showPublish, setShowPublish] = useState(false);
  const [filter, setFilter] = useState("all");
  const catalog = useQuery({
    queryKey: ["skill-catalog", client.baseUrl, search],
    queryFn: async () => (await listSkillCatalog(client, { q: search, limit: 200 })).body.items ?? [],
  });
  const selected = useMemo(
    () =>
      selectedIdentity
        ? (catalog.data ?? []).find(
            (skill) =>
              skill.publisher === selectedIdentity.publisher &&
              skill.name === selectedIdentity.name,
          ) ?? null
        : null,
    [catalog.data, selectedIdentity],
  );
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
    onSuccess: (response) => {
      queryClient.setQueriesData<SkillCatalogItem[]>(
        { queryKey: ["skill-catalog"] },
        (items) =>
          items?.map((item) =>
            item.publisher === response.body.installation.publisher &&
            item.name === response.body.installation.name
              ? { ...item, installation: response.body.installation }
              : item,
          ),
      );
      refresh();
    },
  });
  const requestUninstall = (skill: SkillCatalogItem) => {
    const draining = skill.installation?.status === "draining";
    const mode = window.prompt(
      draining
        ? "当前 Skill 正在等待现有任务完成。输入 force 可取消现有任务并完成卸载。"
        : "卸载方式：输入 graceful 等待现有任务完成，或输入 force 取消现有任务。",
      draining ? "force" : "graceful",
    )?.trim().toLowerCase();
    if (!mode) return;
    if (mode !== "graceful" && mode !== "force") {
      window.alert("卸载方式必须是 graceful 或 force");
      return;
    }
    if (draining && mode !== "force") {
      window.alert("当前正在 draining；如需立即完成卸载，请选择 force");
      return;
    }
    lifecycle.mutate({ skill, action: "uninstall", force: mode === "force" });
  };
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
      if (packageFiles.length === 0) throw new Error("请选择已签名包文件");
      const selectedFiles = normalizeSkillPackageFiles(
        packageFiles.map((file) => [file.webkitRelativePath || file.name, file] as const),
      );
      const files: Record<string, string> = {};
      for (const [path, file] of Object.entries(selectedFiles)) files[path] = await fileBase64(file);
      const encodedBytes = Object.values(files).reduce((total, value) => total + value.length, 0);
      return encodedBytes > 8 * 1024 * 1024
        ? publishSkillFilesStaged(client, files)
        : publishSkillFiles(client, files);
    },
    onSuccess: () => {
      setPackageFiles([]);
      refresh();
    },
  });

  const visibleSkills = (catalog.data ?? []).filter((skill) => filter === "all" || skill.installation?.status === filter);
  const groups = new Map<string, SkillCatalogItem[]>();
  for (const skill of visibleSkills) groups.set(skill.publisher, [...(groups.get(skill.publisher) ?? []), skill]);

  return (
    <div className="skill-workspace">
      {!selected ? <>
        <div className="skill-toolbar-row">
          <div><h2>技能目录 <span className="skill-count">{visibleSkills.length}</span></h2><p>按发布者分组，查看技能说明与租户安装状态。</p></div>
          <button className="btn amber" type="button" aria-expanded={showPublish} onClick={() => setShowPublish(!showPublish)}>{showPublish ? "收起发布" : "＋ 发布 Skill"}</button>
        </div>
        {showPublish ? <section className="skill-surface stack">
            <SkillSectionTitle number="＋" title="发布已签名 Skill 包" description="选择完整包目录，系统会根据大小自动选择上传方式。" />
            <div className="stack form-block">
              <label>包目录<input type="file" multiple {...({ webkitdirectory: "" } as Record<string, string>)} onChange={(event) => setPackageFiles(Array.from(event.target.files ?? []))} /></label>
              <p className="skill-muted">私钥不得进入 AuraX。请先离线签名；签名、摘要与内容策略由 AuraClaw 校验。</p>
              <div className="row"><span className="skill-muted">已选择 {packageFiles.length} 个文件</span><button className="btn amber" type="button" disabled={publish.isPending || !packageFiles.length} onClick={() => publish.mutate()}>{publish.isPending ? "正在发布…" : "确认发布"}</button></div>
              {publish.isSuccess ? <p role="status">已发布，技能目录已刷新。</p> : null}
            </div>
          {publish.error ? (
            <p className="error">
              {errorText(publish.error, {
                redactedForbiddenMessage:
                  "Skill 发布被策略拒绝；请在 Admissions 查看拒绝阶段和错误码。",
              })}
            </p>
          ) : null}
        </section> : null}
        <div className="skill-filter-row">
          <input aria-label="搜索 Skill" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索名称、描述或发布者" type="search" />
          <select aria-label="安装状态" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">全部安装状态</option><option value="active">已启用</option><option value="disabled">已停用</option><option value="draining">等待任务结束</option><option value="uninstalled">已卸载</option></select>
        </div>
        {Array.from(groups, ([publisher, skills]) => <section className="skill-group" key={publisher}>
          <h3>{publisher}<span>{skills.length} 个技能</span></h3>
          <div className="skill-row-list">{skills.map((skill) => <button className="skill-catalog-row" type="button" key={skill.name} onClick={() => setSelectedIdentity({ publisher: skill.publisher, name: skill.name })}>
            <span className="skill-avatar" aria-hidden="true">{skill.name.slice(0, 1).toUpperCase()}</span>
            <span className="skill-row-copy"><strong>{skill.name}</strong><span className="skill-identity">{skill.publisher}/{skill.name} · v{skill.latest_version ?? skill.version}</span><span>{skill.description || "暂无技能描述"}</span></span>
            <span className="skill-row-tags"><SkillBadge value={skill.availability ?? skill.status} /><SkillBadge value={skill.installation?.status ?? "未安装"} /><SkillBadge value={skill.risk_level} /></span><span className="skill-chevron" aria-hidden="true">›</span>
          </button>)}</div>
        </section>)}
        {catalog.error ? <p className="error">{errorText(catalog.error)}</p> : null}
        {catalog.isPending ? <p className="skill-empty" role="status">正在加载技能目录…</p> : !catalog.error && !visibleSkills.length ? <div className="skill-empty"><strong>{search || filter !== "all" ? "没有匹配的 Skill" : "技能库还没有内容"}</strong><p>{search || filter !== "all" ? "试试其他关键词，或切换安装状态。" : "发布一个已签名的 Skill 包，开始管理你的技能。"}</p></div> : null}
      </> : null}
        {selected ? (
          <>
          <button className="btn ghost skill-back" type="button" onClick={() => setSelectedIdentity(null)}>← 返回技能目录</button>
          <div className="skill-detail-head"><span className="skill-avatar" aria-hidden="true">{selected.name.slice(0, 1).toUpperCase()}</span><div><p className="skill-muted">{selected.publisher} / Skill</p><h2>{selected.name}</h2><p>{selected.description}</p></div></div>
          <div className="skill-detail-layout"><div className="stack">
            <section className="skill-surface"><SkillSectionTitle number="01" title="技能说明" description="来自签名包中的 SKILL.md，了解技能的用途和使用方式。" />
              {detail.isPending ? <p role="status">正在加载说明…</p> : detail.error ? <p className="error">{errorText(detail.error)}</p> : detail.data?.skill_markdown ? <MarkdownBody text={detail.data.skill_markdown} /> : <p className="skill-muted">此技能未提供 SKILL.md。</p>}
            </section>
            <section className="skill-surface"><SkillSectionTitle number="02" title="能力依赖" description="技能声明的 Tool、Resource 与其他 Skill 依赖。" />
              {([['Tool', detail.data?.required_tools ?? selected.required_tools], ['Resource', detail.data?.required_resources ?? selected.required_resources], ['Skill', detail.data?.required_skills ?? selected.required_skills]] as const).map(([name, dependencies]) => <details className="skill-dependency" key={name}><summary>{name}<span className="skill-count">{dependencies.length}</span></summary>{dependencies.length ? dependencies.map((dependency, index) => <pre key={index}>{typeof dependency === "string" ? dependency : JSON.stringify(dependency, null, 2)}</pre>) : <p className="skill-muted">未声明 {name} 依赖。</p>}</details>)}
            </section>
            <section className="skill-surface"><SkillSectionTitle number="03" title="版本与治理" description="发布状态与租户安装相互独立。撤销与永久清理会再次确认。" />
            {management.isPending ? <p role="status">正在加载版本…</p> : management.error ? <p className="error">{errorText(management.error)}</p> : !management.data?.versions.length ? <p className="skill-muted">暂无版本记录。</p> : null}
            {management.data?.versions.map((version, index) => (
              <div className="governance-row" key={version.publication.version}>
                <div className="stack"><div className="row"><strong>v{version.publication.version}</strong><SkillBadge value={version.publication.status} />{version.package ? <SkillBadge value={version.package.retention_status} /> : null}{version.package?.legal_hold ? <span className="pill">保全中</span> : null}</div><span className="skill-muted">更新于 {version.publication.updated_at}</span></div>
                <div className="row">
                  {version.publication.status === "retired" ? <button disabled={govern.isPending} className="btn ghost" type="button" onClick={() => govern.mutate({ kind: "restore", index })}>恢复</button> : null}
                  {version.publication.status !== "revoked" ? <button disabled={govern.isPending} className="btn danger ghost" type="button" onClick={() => govern.mutate({ kind: "revoke", index })}>撤销</button> : null}
                  {version.publication.status === "revoked" && selected.installation?.status === "uninstalled" && version.package && version.package.retention_status !== "purged" && !version.package.legal_hold ? <button disabled={govern.isPending} className="btn danger" type="button" onClick={() => govern.mutate({ kind: "purge", index })}>永久清理</button> : null}
                </div>
              </div>
            ))}
            {govern.error ? <p className="error">{errorText(govern.error, { redactedForbiddenMessage: "Skill 治理操作被后端拒绝；请检查生命周期状态或服务认证日志。" })}</p> : null}
            </section>
          </div><aside className="skill-surface skill-summary stack">
            <p className="kicker">Overview</p><h2>安装与状态</h2>
            <div className="row"><SkillBadge value={selected.availability ?? selected.status} /><SkillBadge value={selected.risk_level} /></div>
            <dl className="detail-list"><dt>发布者</dt><dd>{selected.publisher}</dd><dt>最新版本</dt><dd>v{selected.latest_version ?? selected.version}</dd><dt>租户安装</dt><dd><SkillBadge value={selected.installation?.status ?? "未安装"} /></dd><dt>修订版本</dt><dd>{selected.installation?.revision ?? "—"}</dd><dt>升级策略</dt><dd>{selected.installation ? selected.installation.auto_upgrade ? "自动升级" : "固定版本" : "—"}</dd><dt>版本约束</dt><dd>{selected.installation?.version_constraint ?? "—"}</dd></dl>
            {selected.installation?.status === "draining" ? <p className="skill-notice">正在等待现有任务完成。再次卸载可选择强制取消任务。</p> : null}
            <fieldset className="skill-actions" disabled={lifecycle.isPending}>
              {selected.installation?.status === "active" ? <button className="btn ghost" type="button" onClick={() => lifecycle.mutate({ skill: selected, action: "disable" })}>停用</button> : null}
              {selected.installation?.status === "disabled" ? <button className="btn amber" type="button" onClick={() => lifecycle.mutate({ skill: selected, action: "enable" })}>启用</button> : null}
              {selected.installation?.status === "uninstalled" ? <button className="btn amber" type="button" onClick={() => lifecycle.mutate({ skill: selected, action: "install" })}>重新安装</button> : null}
              {selected.installation && selected.installation.status !== "uninstalled" ? <button className="btn danger" type="button" onClick={() => requestUninstall(selected)}>卸载</button> : null}
            </fieldset>
            {lifecycle.error ? <p className="error">{errorText(lifecycle.error)}</p> : null}
            <details className="skill-technical"><summary>技术信息</summary><p className="skill-muted">包摘要</p><code>{selected.package_digest}</code><p>{selected.installation?.status ?? "not installed"} / rev {selected.installation?.revision ?? "-"}</p></details>
          </aside></div></>
        ) : null}
    </div>
  );
}

function PublishersPanel({ client }: { client: ClawClient }) {
  const queryClient = useQueryClient();
  const [publisher, setPublisher] = useState(""); const [displayName, setDisplayName] = useState(""); const [keyId, setKeyId] = useState(""); const [publicKey, setPublicKey] = useState(""); const [selected, setSelected] = useState<SkillPublisherView | null>(null);
  const [creating, setCreating] = useState(false);
  const publishers = useQuery({ queryKey: ["skill-publishers", client.baseUrl], queryFn: async () => (await listSkillPublishers(client)).body.publishers });
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["skill-publishers"] }); setSelected(null); };
  const register = useMutation({ mutationFn: () => registerSkillPublisher(client, publisher.trim(), displayName.trim()), onSuccess: () => { setPublisher(""); setDisplayName(""); refresh(); } });
  const rotate = useMutation({ mutationFn: () => rotateSkillPublisherKey(client, selected!, keyId.trim(), publicKey.trim()), onSuccess: () => { setKeyId(""); setPublicKey(""); refresh(); } });
  const revokeKey = useMutation({ mutationFn: async (key: SkillPublisherView["keys"][number]) => { const reason = window.prompt("Key revoke reason code", "publisher_key_compromised")?.trim(); if (!reason) throw new Error("需要 reason code"); const action = window.prompt("运行时动作：pause / cancel", "cancel"); if (action !== "pause" && action !== "cancel") throw new Error("撤销动作无效"); if (!window.confirm(`撤销公钥 ${key.key_id}？`)) throw new Error("已取消"); return revokeSkillPublisherKey(client, selected!, key, reason, action); }, onSuccess: refresh });
  const status = useMutation({ mutationFn: async (action: "suspend" | "resume" | "revoke") => { const reason = window.prompt("Publisher reason code", `publisher_${action}`)?.trim(); if (!reason) throw new Error("需要 reason code"); if (action === "revoke" && !window.confirm("Publisher revoke 不可逆，确认继续？")) throw new Error("已取消"); return changeSkillPublisherStatus(client, selected!, action, reason); }, onSuccess: refresh });
  const busy = register.isPending || rotate.isPending || revokeKey.isPending || status.isPending;
  return <div className="skill-workspace">
    {selected || creating ? <button className="btn ghost skill-back" type="button" onClick={() => { setSelected(null); setCreating(false); }}>← 返回发布者列表</button> : null}
    {!selected && !creating ? <>
      <div className="skill-toolbar-row"><div><h2>受信发布者 <span className="skill-count">{publishers.data?.length ?? 0}</span></h2><p>管理技能来源、签名公钥与发布权限。</p></div><button className="btn amber" type="button" onClick={() => setCreating(true)}>＋ 注册发布者</button></div>
      <div className="skill-row-list">{(publishers.data ?? []).map((view) => <button type="button" className="skill-catalog-row" key={view.publisher.publisher} onClick={() => { setSelected(view); setKeyId(""); setPublicKey(""); }}><span className="skill-avatar" aria-hidden="true">{view.publisher.display_name.slice(0, 1).toUpperCase()}</span><span className="skill-row-copy"><strong>{view.publisher.display_name}</strong><span>{view.publisher.publisher} · {view.keys.length} 个公钥</span></span><SkillBadge value={view.publisher.status} /><span className="skill-chevron" aria-hidden="true">›</span></button>)}</div>
      {publishers.isPending ? <p className="skill-empty" role="status">正在加载发布者…</p> : !publishers.error && !publishers.data?.length ? <div className="skill-empty"><strong>尚未登记发布者</strong><p>先注册发布者，再登记用于验证技能签名的公钥。</p></div> : null}
    </> : null}
    {creating && !selected ? <form className="skill-surface skill-publisher-form stack" onSubmit={(event) => { event.preventDefault(); register.mutate(undefined, { onSuccess: () => setCreating(false) }); }}>
      <SkillSectionTitle number="01" title="注册发布者" description="使用稳定的发布者标识关联技能与签名公钥。" />
      <label>发布者标识<input required value={publisher} onChange={(e) => setPublisher(e.target.value)} placeholder="例如 acme" /></label><label>显示名称<input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="例如 Acme 团队" /></label>
      <div className="row"><button className="btn amber" disabled={busy || !publisher.trim() || !displayName.trim()} type="submit">{register.isPending ? "正在注册…" : "注册发布者"}</button></div>
    </form> : null}
    {selected ? <div className="skill-detail-layout"><div className="stack">
      <section className="skill-surface"><SkillSectionTitle number="01" title="签名公钥" description="公钥用于验证发布包的真实性；撤销操作会影响关联技能。" />
      {!selected.keys.length ? <p className="skill-muted">尚未登记公钥。</p> : null}
      {selected.keys.map((key) => <div className="governance-row" key={key.key_id}><div className="stack"><strong>{key.key_id}</strong><span className="skill-muted">{key.algorithm} · 修订 {key.revision}</span><SkillBadge value={key.status} /></div>{key.status !== "revoked" ? <button disabled={busy} className="btn danger ghost" type="button" onClick={() => revokeKey.mutate(key)}>撤销公钥</button> : null}</div>)}
      </section>
      {selected.publisher.status !== "revoked" ? <form className="skill-surface stack" onSubmit={(event) => { event.preventDefault(); rotate.mutate(); }}><SkillSectionTitle number="02" title="登记 / 轮换公钥" description="仅登记 Ed25519 公钥。请勿粘贴私钥或其他凭证。" /><label>公钥标识<input required value={keyId} onChange={(e) => setKeyId(e.target.value)} placeholder="例如 signing-key-v2" /></label><label>Ed25519 公钥<textarea required rows={3} value={publicKey} onChange={(e) => setPublicKey(e.target.value)} placeholder="粘贴公钥" /></label><div className="row"><button className="btn amber" disabled={busy || !keyId.trim() || !publicKey.trim()} type="submit">登记公钥</button></div></form> : null}
    </div><aside className="skill-surface skill-summary stack"><p className="kicker">Publisher</p><h2>{selected.publisher.display_name}</h2><p className="skill-muted">{selected.publisher.publisher}</p><SkillBadge value={selected.publisher.status} /><dl className="detail-list"><dt>修订版本</dt><dd>{selected.publisher.revision}</dd><dt>公钥数量</dt><dd>{selected.keys.length}</dd></dl><fieldset disabled={busy} className="skill-actions">{selected.publisher.status === "active" ? <button className="btn ghost" type="button" onClick={() => status.mutate("suspend")}>暂停发布者</button> : null}{selected.publisher.status === "suspended" ? <button className="btn amber" type="button" onClick={() => status.mutate("resume")}>恢复发布者</button> : null}{selected.publisher.status !== "revoked" ? <button className="btn danger" type="button" onClick={() => status.mutate("revoke")}>撤销发布者</button> : null}</fieldset><p className="skill-muted">撤销发布者不可逆，操作前将再次确认。</p></aside></div> : null}
    {publishers.error || register.error || rotate.error || revokeKey.error || status.error ? <p className="error" role="alert">{errorText(publishers.error ?? register.error ?? rotate.error ?? revokeKey.error ?? status.error)}</p> : null}
  </div>;
}

function AdmissionsPanel({ client }: { client: ClawClient }) {
  const [outcome, setOutcome] = useState("");
  const [cursor, setCursor] = useState<string | undefined>();
  const [history, setHistory] = useState<Array<string | undefined>>([]);
  const admissions = useQuery({ queryKey: ["skill-admissions", client.baseUrl, outcome, cursor], queryFn: async () => (await listSkillAdmissions(client, { ...(outcome ? { outcome } : {}), ...(cursor ? { cursor } : {}), limit: 100 })).body });
  const metrics = useQuery({ queryKey: ["skill-admission-metrics", client.baseUrl], queryFn: async () => (await getSkillAdmissionMetrics(client)).body });
  const alert = metrics.data?.alerts[0]; const counts = useMemo(() => metrics.data?.metrics.filter((metric) => metric.name === "skill.admission.count") ?? [], [metrics.data]);
  return <div className="skill-workspace stack">
    <div className="skill-toolbar-row"><div><h2>准入审计</h2><p>追踪技能包的校验结果、隔离情况与策略诊断。{metrics.data ? `统计窗口：最近 ${metrics.data.window.hours} 小时。` : ""}</p></div></div>
    <div className="metric-grid"><div className="skill-surface"><span className="skill-muted">隔离比例</span><p className="metric-value">{alert ? `${(alert.value * 100).toFixed(1)}%` : "—"}</p>{alert ? <SkillBadge value={alert.status} /> : <span className="skill-muted">暂无指标</span>}</div>{counts.map((metric) => <div className="skill-surface" key={JSON.stringify(metric.labels)}><span className="skill-muted">{SKILL_LABELS[metric.labels.outcome ?? ""] ?? metric.labels.outcome}</span><p className="metric-value">{metric.value}</p><span className="skill-muted">策略 {metric.labels.content_policy_version}</span></div>)}</div>
    <div className="skill-toolbar-row"><h3>校验记录</h3><select aria-label="校验结果" value={outcome} onChange={(e) => { setOutcome(e.target.value); setCursor(undefined); setHistory([]); }}><option value="">全部结果</option><option value="accepted">已通过</option><option value="rejected">已拒绝</option><option value="quarantined">已隔离</option></select></div>
    <div className="skill-row-list">{(admissions.data?.admissions ?? []).map((record) => <details className="skill-audit-record" key={record.admission_id}><summary><SkillBadge value={record.outcome} /><strong>{record.stage}</strong><span className="skill-muted">{record.occurred_at}</span><span className="skill-muted">{record.duration_ms} ms</span></summary><dl className="detail-list"><dt>记录 ID</dt><dd>{record.admission_id}</dd><dt>诊断码</dt><dd>{record.safe_error_code ?? "无错误"}</dd><dt>内容策略</dt><dd>{record.content_policy_version ?? "—"}</dd></dl></details>)}</div>
    {admissions.isPending ? <p className="skill-empty" role="status">正在加载审计记录…</p> : !admissions.error && !admissions.data?.admissions.length ? <div className="skill-empty"><strong>暂无{outcome ? SKILL_LABELS[outcome] : "准入"}记录</strong><p>技能包提交校验后，结果会显示在这里。</p></div> : null}
    <div className="row"><button className="btn ghost" type="button" disabled={history.length === 0 || admissions.isFetching} onClick={() => { const previous = history.at(-1); setHistory((items) => items.slice(0, -1)); setCursor(previous); }}>上一页</button><span className="skill-muted">第 {history.length + 1} 页</span><button className="btn ghost" type="button" disabled={!admissions.data?.next_cursor || admissions.isFetching} onClick={() => { setHistory((items) => [...items, cursor]); setCursor(admissions.data?.next_cursor ?? undefined); }}>下一页</button></div>{admissions.error || metrics.error ? <p className="error">{errorText(admissions.error ?? metrics.error)}</p> : null}
  </div>;
}

async function fileBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
