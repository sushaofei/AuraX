import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { evaluationConsistency, evaluationStats, evaluationStatus, getEvaluations, type ClawClient, type EvaluationRun } from "@aurax/claw-sdk";
import { errorText, isNotFound } from "../lib/errors";
import "./EvaluationsView.css";

const benchmarkName = (name: string) => ({ "tau-bench": "τ-bench", appworld: "AppWorld" } as Record<string, string>)[name] ?? name;
function RunCard({ run }: { run: EvaluationRun }) {
  const stats = evaluationStats(run), c = run.config;
  const timed = run.attempts.map((a) => a.elapsed_seconds).filter((s): s is number => s !== null);
  const mean = timed.length ? `${(timed.reduce((a, b) => a + b, 0) / timed.length).toFixed(1)} 秒` : "未知";
  return <article className="evaluation-card">
    <div className="evaluation-card-head"><h2>{benchmarkName(c.benchmark)}</h2><span className="evaluation-tag">{run.protocol ? "E3 受控基线" : "开发联调"} · {c.split}{c.domain ? ` / ${c.domain}` : ""}</span></div>
    <p className="helper">{run.validation_scope === "fixture" ? "模拟夹具验证 · 不计正式成绩" : "官方 SDK 评分"} · {stats.complete ? "所选样本已跑完" : `样本未跑完，缺 ${stats.missing} 次`}</p>
    {run.scoring_basis === "post-close-official" ? <p className="evaluation-notice">按关闭环境后的官方评分裁决。与运行中读数不同的 {run.scoring_adjustments} 次判定已更正，原始记录保留。</p> : null}
    <div className="evaluation-metrics">
      <div><span>成功率</span><strong>{stats.rate === null ? "—" : `${(stats.rate * 100).toFixed(run.protocol ? 1 : 0)}%`}</strong><small>{stats.success} / {stats.expected} 次计划尝试成功</small></div>
      <div><span>平均耗时</span><strong>{mean}</strong><small>已记录 {timed.length} / {run.attempts.length} 次尝试</small></div>
      <div><span>任务失败 / 执行异常</span><strong>{stats.failures} / {stats.errors}</strong><small>预算耗尽计入任务失败；超时计入异常</small></div>
    </div>
    {run.protocol ? <div className="evaluation-repeat">
      <p><b>保留样本 · 每题 3 次独立尝试</b></p>
      <p className="helper">同一任务 k 次都成功的估计（不是 pass@k）。模型快照未锁定，暂无配对模型对照。</p>
      {stats.complete ? <p>{evaluationConsistency(run).map(({ k, value }) => <span key={k}>pass^{k} <b>{(value * 100).toFixed(1)}%</b>{" · "}</span>)}</p> : <p>重复尝试未跑齐，暂不提供一致性指标。</p>}
      {c.benchmark === "appworld" ? run.official_metrics ? <>
        <p><b>官方独立复评 · 所选完整场景子集</b></p>
        <p className="helper">TGC 为任务目标完成率，SGC 为场景内全部任务完成率；与上方 Agent 严格成功率分开。</p>
        <ul>{run.official_metrics.map((m) => <li key={m.trial}>第 {m.trial + 1} 次：TGC {(m.task_goal_completion * 100).toFixed(1)}% / SGC {(m.scenario_goal_completion * 100).toFixed(1)}%<br /><small>{m.tasks} 题 / {m.scenarios} 个完整场景</small></li>)}</ul>
      </> : <p>尚无可验证的官方场景复评，不展示 SGC。</p> : null}
    </div> : null}
    <p><b>{c.model}</b><br /><span className="helper">模型别名，未锁定不可变快照 · 总费用未知</span></p>
    <p className="helper">{run.task_ids.length} 个任务 × {run.trials} 次 · 已记录 {run.attempts.length} 次尝试</p>
    <details><summary>查看样本与评测配置</summary>
      <ul className="evaluation-attempts">{run.attempts.map((a) => <li key={`${a.task_id}-${a.trial}`}>
        <div><code>{a.task_id}</code> · 第 {a.trial + 1} 次 <b>{evaluationStatus(a.status, a.success)}</b></div>
        <span>运行时奖励 {a.official_reward ?? "未知"}{a.independent_reward === null ? "" : ` / 独立复评 ${a.independent_reward}`} · {a.elapsed_seconds === null ? "耗时未知" : `${a.elapsed_seconds.toFixed(1)} 秒`} · 模型 {a.model_calls ?? "未知"} / 工具 {a.tool_calls ?? "未知"} 次</span>
        {a.episode_success !== null && a.episode_success !== a.success ? <span>运行中判定：{a.episode_success ? "成功" : "未成功"} → 官方终态：{a.success ? "成功" : "未通过"}</span> : null}
      </li>)}</ul>
      <dl className="evaluation-config">
        <dt>报告编号</dt><dd>{run.run_id}</dd>
        <dt>最终评分提交</dt><dd>{run.verifier_revision ?? "未记录"}</dd>
        <dt>执行配置</dt><dd>{run.harness_profile}</dd>
        <dt>Harness 提交</dt><dd>{c.harness_revision}</dd>
        <dt>上游版本</dt><dd>{run.upstream_revision ?? "未记录"}</dd>
        <dt>数据指纹</dt><dd>{c.dataset_revision}</dd>
        <dt>数据校验</dt><dd>{run.attempts.every((a) => a.dataset_revision_verified) && run.attempts.length > 0 ? "已记录样本均已校验" : "存在未校验样本"}</dd>
        <dt>预算</dt><dd>{c.max_actions} 次动作 · {c.max_output_tokens} 输出 token · 每轮 {c.per_turn_output_tokens} · {c.timeout_seconds} 秒</dd>
        <dt>随机种子</dt><dd>{c.seed}</dd>
        <dt>用户模拟器</dt><dd>{c.user_model ? `${c.user_model} / ${c.user_provider}` : "不适用"}</dd>
      </dl>
    </details>
  </article>;
}
export function EvaluationsView({ client }: { client: ClawClient }) {
  const [filter, setFilter] = useState("all");
  const report = useQuery({ queryKey: ["evaluations", client.baseUrl, client.identity.tenantId, client.identity.deptId, client.identity.userId],
    queryFn: () => getEvaluations(client), retry: false });
  const runs = report.data?.runs ?? [];
  return <section className="evaluations">
    <p className="kicker">Evaluations</p>
    <div className="page-head"><h1>评测</h1><button className="btn ghost" type="button" disabled={report.isFetching} onClick={() => void report.refetch()}>{report.isFetching ? "刷新中…" : "刷新报告"}</button></div>
    <p className="lede">从真实运行结果了解 Agent 的任务完成情况。</p>
    <p className="evaluation-notice">当前展示开发集样本结果，不代表完整基准成绩或模型排名。E2 联调与 E3 受控基线独立展示，不合并不同配置；场景指标仅限所选完整场景子集，三次重复不代表稳定性保证。</p>
    {report.isPending ? <p role="status">正在加载评测报告…</p> : null}
    {report.isError ? <p role="alert">{isNotFound(report.error) ? "当前环境尚未接入评测报告。请联系管理员导入已有结果。" : `无法加载评测报告：${errorText(report.error)}`}{report.data ? " 当前保留上次加载的数据。" : ""}</p> : null}
    {report.data ? <>
      <div className="evaluation-toolbar"><label>基准 <select aria-label="基准" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">全部</option>{[...new Set(runs.map((r) => r.config.benchmark))].map((b) => <option key={b} value={b}>{benchmarkName(b)}</option>)}</select></label><span className="helper">报告导入时间：{new Date(report.data.exported_at).toLocaleString("zh-CN")}</span></div>
      {runs.length === 0 ? <p role="status">暂无已发布的评测结果。</p> : null}
      <div className="evaluation-grid">{runs.filter((r) => filter === "all" || r.config.benchmark === filter).map((run) => <RunCard key={run.run_id} run={run} />)}</div>
    </> : null}
  </section>;
}
