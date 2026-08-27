import { useQuery } from "@tanstack/react-query";
import { listTasks, type ClawClient, type TaskView } from "@aurax/claw-sdk";
import { useState } from "react";
import { getSessionOrigin, type SessionOrigin } from "../cache";
import { errorText } from "../lib/errors";

const STATUS_FILTERS: { id: string; label: string; match: (status: string) => boolean }[] = [
  { id: "all", label: "全部", match: () => true },
  {
    id: "live",
    label: "进行中",
    match: (status) =>
      ["created", "ready", "pending", "runnable", "running"].includes(status),
  },
  { id: "hitl", label: "待人审", match: (status) => status === "waiting_for_human" },
  {
    id: "paused",
    label: "可继续",
    match: (status) => status === "paused" || status === "retry_wait",
  },
  { id: "done", label: "已完成", match: (status) => status === "completed" },
  {
    id: "failed",
    label: "失败",
    match: (status) => status === "failed" || status === "cancelled",
  },
  { id: "closed", label: "已关闭", match: (status) => status === "closed" },
];

const TYPE_TABS: { id: "all" | SessionOrigin; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "chat", label: "对话" },
  { id: "task", label: "任务" },
];

function shortId(id: string): string {
  if (id.length <= 18) {
    return id;
  }
  return `${id.slice(0, 10)}…${id.slice(-4)}`;
}

function formatProjectedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function matchesTypeTab(sessionId: string, tab: "all" | SessionOrigin): boolean {
  if (tab === "all") {
    return true;
  }
  const origin = getSessionOrigin(sessionId);
  if (tab === "chat") {
    return origin === "chat" || origin === null;
  }
  return origin === "task";
}

export function SessionsView({
  client,
  onOpen,
}: {
  client: ClawClient;
  onOpen: (sessionId: string, target: SessionOrigin) => void;
}) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeTab, setTypeTab] = useState<"all" | SessionOrigin>("all");
  const list = useQuery({
    queryKey: ["tasks", client.baseUrl],
    queryFn: async () => (await listTasks(client, { kind: "chat", limit: 50 })).body,
  });
  const statusMatcher =
    STATUS_FILTERS.find((item) => item.id === statusFilter)?.match ?? (() => true);
  const tasks = (list.data?.tasks ?? []).filter(
    (item) => statusMatcher(item.status) && matchesTypeTab(item.session_id, typeTab),
  );

  return (
    <section className="archive">
      <p className="kicker">Archive</p>
      <h1>历史</h1>
      <p className="lede">
        只显示 source=chat 的 Root Session。类型由本机创建来源标记；权威在 AuraClaw。
      </p>
      <div className="chip-row filters" role="tablist" aria-label="按类型筛选">
        {TYPE_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="skill-chip"
            role="tab"
            aria-selected={typeTab === item.id}
            aria-pressed={typeTab === item.id}
            onClick={() => setTypeTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="chip-row filters" role="tablist" aria-label="按状态筛选">
        {STATUS_FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="skill-chip"
            role="tab"
            aria-selected={statusFilter === item.id}
            aria-pressed={statusFilter === item.id}
            onClick={() => setStatusFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {list.error ? <p className="error">{errorText(list.error)}</p> : null}
      <div className="list">
        {tasks.map((item: TaskView) => {
          const origin = getSessionOrigin(item.session_id);
          const target: SessionOrigin = origin === "task" ? "task" : "chat";
          return (
            <button
              key={item.session_id}
              className="item"
              type="button"
              onClick={() => onOpen(item.session_id, target)}
            >
              <div>
                <div className="item-title">{item.goal}</div>
                <div className="mono" title={item.session_id}>
                  {shortId(item.session_id)} · {origin ?? "对话"} · {item.status} ·{" "}
                  {formatProjectedAt(item.projected_at)}
                </div>
              </div>
              <span className="pill">{item.run_status ?? item.status}</span>
            </button>
          );
        })}
      </div>
      {list.data && tasks.length === 0 ? (
        <p className="empty">没有符合筛选的 Session。</p>
      ) : null}
    </section>
  );
}
