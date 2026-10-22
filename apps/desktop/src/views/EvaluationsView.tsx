import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { evaluationConsistency, evaluationStats, evaluationStatus, getEvaluations, type ClawClient, type EvaluationRun } from "@aurax/claw-sdk";
import { errorText, isNotFound } from "../lib/errors";
import "./EvaluationsView.css";

const benchmarkName = (name: string) => ({ "tau-bench": "τ-bench", appworld: "AppWorld" } as Record<string, string>)[name] ?? name;
const benchmarkDescription = (name: string) => ({
  "tau-bench": "通过多轮用户对话与工具调用，评估任务完成、业务规则遵循及重复执行的一致性。",
  appworld: "在多应用交互环境中，通过编程与 API 调用完成任务，评估跨应用操作与任务目标完成情况。",
} as Record<string, string>)[name];
const benchmarkUrl = (name: string) => ({
  "tau-bench": "https://github.com/sierra-research/tau-bench",
  appworld: "https://github.com/StonyBrookNLP/appworld",
} as Record<string, string>)[name];
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
function RunCard({ run }: { run: EvaluationRun }) {
  const stats = evaluationStats(run), c = run.config;
  const timed = run.attempts.map((a) => a.elapsed_seconds).filter((s): s is number => s !== null);
  const mean = timed.length ? `${(timed.reduce((a, b) => a + b, 0) / timed.length).toFixed(1)} s` : "—";
  return <article className="evaluation-card">
    <header className="evaluation-card-head">
      <div><h2>{benchmarkName(c.benchmark)}</h2>{benchmarkDescription(c.benchmark) ? <p>{benchmarkDescription(c.benchmark)}</p> : null}{benchmarkUrl(c.benchmark) ? <a className="evaluation-source" href={benchmarkUrl(c.benchmark)} target="_blank" rel="noopener noreferrer" aria-label={`${benchmarkName(c.benchmark)} 官方文档（新窗口）`}>官方文档 <span aria-hidden="true">↗</span></a> : null}{run.validation_scope === "fixture" ? <p>测试数据 · 不计基准成绩</p> : null}</div>
      <span className={`evaluation-status${stats.complete ? "" : " pending"}`}>{stats.complete ? "已完成" : `未完成 · 缺 ${stats.missing} 次`}</span>
    </header>
    <div className="evaluation-metrics">
      <div className="evaluation-primary"><span>任务成功率</span><strong>{stats.rate === null ? "—" : percent(stats.rate)}</strong><small>{stats.success} / {stats.expected} 次尝试成功</small></div>
      <div><span>样本规模</span><strong>{run.task_ids.length}<em>题</em></strong><small>每题 {run.trials} 次 · 共 {stats.expected} 次计划尝试</small></div>
      <div><span>平均耗时</span><strong>{mean}</strong><small>{timed.length} 次有效耗时记录</small></div>
      <div><span>失败 / 异常</span><strong>{stats.failures}<em>/</em>{stats.errors}</strong><small>预算耗尽计失败，超时计异常</small></div>
    </div>
    <dl className="evaluation-conditions"><div><dt>模型</dt><dd>{c.model}</dd></div><div><dt>执行上限</dt><dd>{c.max_actions} 次动作 · {c.timeout_seconds} s</dd></div><div><dt>评分依据</dt><dd>{run.validation_scope === "fixture" ? "测试数据" : run.scoring_basis === "post-close-official" ? "官方终态复评" : "官方 SDK"}</dd></div></dl>
    {run.protocol ? <section className="evaluation-consistency" aria-label="重复评测一致性">
      <h3>重复评测一致性</h3><p className="evaluation-caption">pass^k：同一任务 k 次均成功的估计值。</p>
      {stats.complete ? <dl>{evaluationConsistency(run).map(({ k, value }) => <div key={k}><dt>pass^{k}</dt><dd>{percent(value)}</dd></div>)}</dl> : <p className="evaluation-caption">尝试记录不完整，暂不计算。</p>}
    </section> : null}
    {run.official_metrics ? <section className="evaluation-scenes"><h3>场景评测</h3><p className="evaluation-caption">所选完整场景子集。TGC：任务目标完成率；SGC：场景内全部任务完成率。</p><div className="evaluation-table-wrap"><table><thead><tr><th>轮次</th><th>任务 / 场景</th><th>TGC</th><th>SGC</th></tr></thead><tbody>{run.official_metrics.map((m) => <tr key={m.trial}><td>{m.trial + 1}</td><td>{m.tasks} / {m.scenarios}</td><td>{percent(m.task_goal_completion)}</td><td>{percent(m.scenario_goal_completion)}</td></tr>)}</tbody></table></div></section> : null}
    <p className="evaluation-limits">开发集子集 · 模型快照未锁定 · 无配对模型对照 · 费用未记录</p>
    {run.scoring_basis === "post-close-official" ? <details className="evaluation-revision"><summary>评分修订 · {run.scoring_adjustments} 次判定更正</summary><p>最终成绩采用关闭环境后的官方复评。{run.scoring_adjustments} 次判定与运行中读数不同，原始判定及奖励保留在样本明细中。</p></details> : null}
    <details className="evaluation-samples"><summary>样本明细 <span>{run.attempts.length} 次尝试</span></summary>
      <div className="evaluation-table-wrap"><table><thead><tr><th>任务 / 轮次</th><th>结果</th><th>耗时</th><th>模型 / 工具调用</th><th>运行奖励 / 复评奖励</th></tr></thead><tbody>{run.attempts.map((a) => <tr key={`${a.task_id}-${a.trial}`}>
        <th scope="row"><code>{a.task_id}</code><small>第 {a.trial + 1} 轮</small></th>
        <td>{evaluationStatus(a.status, a.success)}{a.episode_success !== null && a.episode_success !== a.success ? <small>原始判定：{a.episode_success ? "成功" : "未成功"} → {a.success ? "成功" : "未通过"}</small> : null}</td>
        <td>{a.elapsed_seconds === null ? "—" : `${a.elapsed_seconds.toFixed(1)} s`}</td><td>{a.model_calls ?? "—"} / {a.tool_calls ?? "—"}</td><td>{a.official_reward ?? "—"} / {a.independent_reward ?? "—"}</td>
      </tr>)}</tbody></table></div>
    </details>
    <details className="evaluation-provenance"><summary>评测配置与版本</summary><dl className="evaluation-config">
      <dt>报告编号</dt><dd>{run.run_id}</dd><dt>评测协议</dt><dd>{run.protocol ?? "单次评测"}</dd>
      <dt>数据集</dt><dd>{c.split}{c.domain ? ` / ${c.domain}` : ""}</dd><dt>样本范围</dt><dd>{run.protocol ? "保留样本" : "单次评测"}</dd>
      <dt>执行配置</dt><dd>{run.harness_profile}</dd><dt>执行器版本</dt><dd>{c.harness_revision}</dd>
      <dt>评分器版本</dt><dd>{run.verifier_revision ?? "未记录"}</dd><dt>基准版本</dt><dd>{run.upstream_revision ?? "未记录"}</dd>
      <dt>数据指纹</dt><dd>{c.dataset_revision}</dd><dt>数据校验</dt><dd>{run.attempts.length > 0 && run.attempts.every((a) => a.dataset_revision_verified) ? "已记录样本全部通过" : "存在未校验样本"}</dd>
      <dt>输出预算</dt><dd>{c.max_output_tokens} tokens · 每轮 {c.per_turn_output_tokens} tokens</dd><dt>随机种子</dt><dd>{c.seed}</dd>
      <dt>用户模拟器</dt><dd>{c.user_model ? `${c.user_model} / ${c.user_provider}` : "不适用"}</dd>
    </dl></details>
  </article>;
}
export function EvaluationsView({ client }: { client: ClawClient }) {
  const [filter, setFilter] = useState("all");
  const report = useQuery({ queryKey: ["evaluations", client.baseUrl, client.identity.tenantId, client.identity.deptId, client.identity.userId],
    queryFn: () => getEvaluations(client), retry: false });
  const runs = report.data?.runs ?? [];
  // Protocol runs are the primary cohort; earlier single-attempt runs remain accessible as history.
  const primary = runs.filter((r) => r.protocol || !runs.some((other) => other.protocol && other.config.benchmark === r.config.benchmark));
  const history = runs.filter((r) => !primary.includes(r));
  const matches = (run: EvaluationRun) => filter === "all" || run.config.benchmark === filter;
  return <section className="evaluations">
    <div className="page-head"><div><h1>评测</h1><p className="evaluation-subtitle">基准成绩、执行条件与评分记录</p></div><button className="btn ghost" type="button" disabled={report.isFetching} onClick={() => void report.refetch()}>{report.isFetching ? "刷新中…" : "刷新报告"}</button></div>
    {report.isPending ? <p role="status">正在加载评测报告…</p> : null}
    {report.isError ? <p role="alert">{isNotFound(report.error) ? "尚未发布评测报告。" : `无法加载评测报告：${errorText(report.error)}`}{report.data ? " 当前显示上次加载的数据。" : ""}</p> : null}
    {report.data ? <>
      <div className="evaluation-toolbar"><label>基准 <select aria-label="基准" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">全部</option>{[...new Set(runs.map((r) => r.config.benchmark))].map((b) => <option key={b} value={b}>{benchmarkName(b)}</option>)}</select></label><span>报告发布于 {new Date(report.data.exported_at).toLocaleString("zh-CN", { hour12: false })}</span></div>
      {runs.length === 0 ? <p role="status">暂无已发布的评测结果。</p> : null}
      <div className="evaluation-grid">{primary.filter(matches).map((run) => <RunCard key={run.run_id} run={run} />)}</div>
      {history.some(matches) ? <details className="evaluation-history"><summary>历史运行 <span>{history.filter(matches).length} 份报告</span></summary><div className="evaluation-grid">{history.filter(matches).map((run) => <RunCard key={run.run_id} run={run} />)}</div></details> : null}
      {runs.length > 0 ? <p className="evaluation-footnote">各运行按独立配置统计；子集结果不用于完整基准排名。</p> : null}
    </> : null}
  </section>;
}
