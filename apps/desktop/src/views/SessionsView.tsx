import { useQuery } from "@tanstack/react-query";
import { listTasks, type ClawClient, type TaskView } from "@aurax/claw-sdk";
import { useState } from "react";
import { errorText } from "../lib/errors";

const FILTERS: { id: string; label: string; match: (status: string) => boolean }[] = [
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

export function SessionsView({
  client,
  onOpen,
}: {
  client: ClawClient;
  onOpen: (sessionId: string) => void;
}) {
  const [filter, setFilter] = useState("all");
  const list = useQuery({
    queryKey: ["tasks", client.baseUrl],
    queryFn: async () => (await listTasks(client, { kind: "chat", limit: 50 })).body,
  });
  const matcher = FILTERS.find((item) => item.id === filter)?.match ?? (() => true);
  const tasks = (list.data?.tasks ?? []).filter((item) => matcher(item.status));

  return (
    <section className="archive">
      <p className="kicker">Archive</p>
      <h1>历史</h1>
      <p className="lede">只显示 source=chat 的 Root Session。权威在 AuraClaw，本机不做事实源。</p>
      <div className="chip-row filters" role="tablist" aria-label="按状态筛选">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="skill-chip"
            role="tab"
            aria-selected={filter === item.id}
            aria-pressed={filter === item.id}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {list.error ? <p className="error">{errorText(list.error)}</p> : null}
      <div className="list">
        {tasks.map((item: TaskView) => (
          <button
            key={item.session_id}
            className="item"
            type="button"
            onClick={() => onOpen(item.session_id)}
          >
            <div>
              <div className="item-title">{item.goal}</div>
              <div className="mono" title={item.session_id}>
                {shortId(item.session_id)} · {item.status} · {formatProjectedAt(item.projected_at)}
              </div>
            </div>
            <span className="pill">{item.run_status ?? item.status}</span>
          </button>
        ))}
      </div>
      {list.data && tasks.length === 0 ? <p className="empty">没有符合筛选的对话 Session。</p> : null}
    </section>
  );
}
