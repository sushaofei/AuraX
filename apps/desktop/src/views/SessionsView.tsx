import { useInfiniteQuery } from "@tanstack/react-query";
import { listTasks, type ClawClient } from "@aurax/claw-sdk";
import { useState } from "react";
import { getSessionOrigin, type SessionOrigin } from "../cache";
import { errorText } from "../lib/errors";
import "./SessionsView.css";
import {
  HISTORY_STATUS_FILTERS, historyOrigin, historyStatusLabel, matchesHistoryStatus,
  type HistoryOrigin, type HistoryStatusFilter,
} from "../lib/session-history";

const TYPE_TABS: { id: "all" | HistoryOrigin; label: string }[] = [
  { id: "all", label: "全部" }, { id: "chat", label: "对话" },
  { id: "task", label: "任务" }, { id: "unknown", label: "未分类" },
];
const ORIGIN_LABELS = { chat: "对话", task: "任务", unknown: "未分类" };

function shortId(id: string): string {
  return id.length <= 18 ? id : id.slice(0, 10) + "…" + id.slice(-4);
}

function formatProjectedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

export function SessionsView({ client, onOpen }: {
  client: ClawClient;
  onOpen: (sessionId: string, target: SessionOrigin) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<HistoryStatusFilter>("all");
  const [typeTab, setTypeTab] = useState<"all" | HistoryOrigin>("all");
  const list = useInfiniteQuery({
    queryKey: ["tasks", client.baseUrl, client.identity.tenantId, client.identity.deptId, client.identity.userId],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => (await listTasks(client, {
      kind: "chat", limit: 50, ...(pageParam ? { cursor: pageParam } : {}),
    })).body,
    getNextPageParam: (lastPage) => lastPage.next_cursor || undefined,
  });
  const allTasks = [...new Map((list.data?.pages.flatMap((page) => page.tasks) ?? [])
    .map((task) => [task.session_id, task])).values()];
  const unknownCount = allTasks.filter((item) => historyOrigin(getSessionOrigin(item.session_id)) === "unknown").length;
  const tasks = allTasks.filter((item) => matchesHistoryStatus(item, statusFilter)
    && (typeTab === "all" || historyOrigin(getSessionOrigin(item.session_id)) === typeTab));
  const resetFilters = () => { setTypeTab("all"); setStatusFilter("all"); };

  return <section className="archive">
    <p className="kicker">Archive</p>
    <div className="page-head"><h1>历史</h1><button className="btn ghost" type="button" disabled={list.isFetching} onClick={() => void list.refetch()}>刷新历史</button></div>
    <p className="lede">显示当前租户的交互主会话。按最近一轮的运行结果筛选；会话是否关闭单独展示。</p>
    <p className="helper">租户 {client.identity.tenantId} · 已加载 {allTasks.length} 条 · 当前显示 {tasks.length} 条{list.hasNextPage ? "（还有更多历史）" : ""}</p>
    <div className="chip-row filters" role="tablist" aria-label="按类型筛选">
      {TYPE_TABS.map((item) => <button key={item.id} type="button" className="skill-chip" role="tab" aria-selected={typeTab === item.id} aria-pressed={typeTab === item.id} onClick={() => setTypeTab(item.id)}>{item.label}</button>)}
    </div>
    <div className="chip-row filters" role="tablist" aria-label="按状态筛选">
      {HISTORY_STATUS_FILTERS.map((item) => <button key={item.id} type="button" className="skill-chip" role="tab" aria-selected={statusFilter === item.id} aria-pressed={statusFilter === item.id} onClick={() => setStatusFilter(item.id)}>{item.label}</button>)}
    </div>
    {unknownCount > 0 ? <div className="history-notice" role="status">
      <p>{unknownCount} 条记录没有本机类型标记，已保留在“全部”和“未分类”中。换浏览器或清除缓存不会删除服务端历史；当前接口无法还原它们最初来自对话页还是任务页。未分类记录默认以对话视图查看。</p>
      {typeTab !== "all" && typeTab !== "unknown" ? <button className="btn ghost" type="button" onClick={() => { setTypeTab("unknown"); setStatusFilter("all"); }}>查看未分类记录</button> : null}
    </div> : null}
    {list.isPending ? <p role="status" className="empty">正在加载历史…</p> : null}
    {list.error ? <p className="error" role="alert">{errorText(list.error)}</p> : null}
    <div className="list">
      {tasks.map((item) => {
        const origin = historyOrigin(getSessionOrigin(item.session_id));
        const run = item.run_status ?? item.status;
        return <button key={item.session_id} className="item" type="button" onClick={() => onOpen(item.session_id, origin === "task" ? "task" : "chat")}>
          <div><div className="item-title">{item.goal}</div>
            <div className="mono" title={item.session_id}>{shortId(item.session_id)} · {ORIGIN_LABELS[origin]} · 会话：{historyStatusLabel(item.status)} · {formatProjectedAt(item.projected_at)}</div>
          </div>
          <span className={"pill " + (run === "completed" ? "ok" : run === "failed" ? "off" : "")} title={"Run: " + (item.run_status ?? "无") + "; Session: " + item.status}>{item.run_status ? "运行：" + historyStatusLabel(run) : "会话：" + historyStatusLabel(item.status)}</span>
        </button>;
      })}
    </div>
    {!list.isPending && !list.error && tasks.length === 0 ? <div className="empty">
      <p>{allTasks.length ? "当前筛选没有匹配记录，历史数据仍在。" : "当前租户暂无交互主会话历史。请核对测试身份。"}</p>
      {typeTab !== "all" || statusFilter !== "all" ? <button className="btn ghost" type="button" onClick={resetFilters}>清除筛选</button> : null}
    </div> : null}
    {list.hasNextPage ? <div className="form-block"><button className="btn ghost" type="button" disabled={list.isFetching} onClick={() => void list.fetchNextPage()}>{list.isFetchingNextPage ? "正在加载…" : "加载更多历史"}</button><p className="helper">筛选仅作用于已加载记录；可继续加载更早的历史。</p></div> : null}
  </section>;
}
