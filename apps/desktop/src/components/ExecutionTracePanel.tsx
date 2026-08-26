import { useInfiniteQuery } from "@tanstack/react-query";
import {
  getActivity,
  type ActivityNode,
  type ClawClient,
} from "@aurax/claw-sdk";
import { useEffect, useMemo, useState } from "react";
import {
  loadTraceFilter,
  saveTraceFilter,
  type TraceFilter,
} from "../cache";
import { errorText, isNotFound } from "../lib/errors";

const FILTERS: { id: TraceFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "model", label: "模型" },
  { id: "capability", label: "能力" },
  { id: "state", label: "状态" },
];

const MODEL_TYPES = new Set(["user_prompt", "model_input", "model_output"]);
const CAPABILITY_TYPES = new Set(["tool", "skill", "resource", "approval"]);
const STATE_TYPES = new Set(["run", "session"]);

export function ExecutionTracePanel({
  client,
  sessionId,
  open,
  live,
  onClose,
  onCountChange,
}: {
  client: ClawClient;
  sessionId: string;
  open: boolean;
  live: boolean;
  onClose: () => void;
  onCountChange: (count: number) => void;
}) {
  const [filter, setFilter] = useState<TraceFilter>(loadTraceFilter);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    saveTraceFilter(filter);
  }, [filter]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  const activity = useInfiniteQuery({
    queryKey: ["activity", client.baseUrl, sessionId],
    queryFn: async ({ pageParam }) =>
      (await getActivity(client, sessionId, { afterVersion: pageParam, limit: 200 })).body,
    initialPageParam: 0,
    getNextPageParam: (lastPage, _pages, lastPageParam) =>
      lastPage.next_after_version > lastPageParam
        ? lastPage.next_after_version
        : undefined,
    refetchInterval: live ? 2500 : false,
    retry: (count, error) => !isNotFound(error) && count < 2,
  });
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = activity;

  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const nodes = useMemo(
    () => mergeNodes([], activity.data?.pages.flatMap((page) => page.nodes) ?? []),
    [activity.data],
  );

  useEffect(() => {
    onCountChange(nodes.length);
  }, [nodes.length, onCountChange]);

  const visible = useMemo(
    () => nodes.filter((node) => matchesFilter(node, filter)),
    [filter, nodes],
  );
  const groups = useMemo(() => groupNodes(visible), [visible]);
  const unsupported = isNotFound(activity.error);

  return (
    <>
      <button
        className="trace-backdrop"
        type="button"
        aria-label="关闭执行轨迹"
        hidden={!open}
        onClick={onClose}
      />
      <aside
        id="execution-trace"
        className="execution-trace"
        aria-label="对话执行轨迹"
        hidden={!open}
      >
        <div className="trace-head">
          <div>
            <p className="kicker">Activity</p>
            <h2>执行轨迹</h2>
          </div>
          <button className="trace-close" type="button" onClick={onClose} aria-label="收起执行轨迹">
            ×
          </button>
        </div>
        <div className="trace-filters" role="group" aria-label="轨迹筛选">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {activity.isPending && nodes.length === 0 ? (
          <p className="trace-message" role="status">正在恢复执行轨迹…</p>
        ) : null}
        {unsupported ? (
          <div className="trace-message">
            <p>当前 AuraClaw 不支持执行轨迹。</p>
            <p className="mono">对话与最终结果仍可正常使用。</p>
          </div>
        ) : null}
        {activity.error && !unsupported ? (
          <div className="trace-message error" role="alert">
            <p>执行轨迹加载失败：{errorText(activity.error)}</p>
            <button className="btn ghost" type="button" onClick={() => activity.refetch()}>
              重试
            </button>
          </div>
        ) : null}
        {!activity.isPending && !activity.error && nodes.length === 0 ? (
          <p className="trace-message">这个 Session 还没有可展示的执行活动。</p>
        ) : null}
        {!activity.error && nodes.length > 0 && groups.length === 0 ? (
          <p className="trace-message">当前筛选下没有节点。</p>
        ) : null}
        <div className="trace-groups">
          {groups.map((group) => (
            <section className="trace-group" key={group.id} aria-labelledby={`trace-group-${group.id}`}>
              <h3 id={`trace-group-${group.id}`}>{group.label}</h3>
              <ol className="trace-list">
                {group.nodes.map((node) => {
                  const isExpanded = expanded.has(node.id);
                  return (
                    <li className={`trace-node status-${node.status}`} key={node.id}>
                      <span className="trace-dot" aria-hidden="true" />
                      <button
                        className="trace-node-toggle"
                        type="button"
                        aria-expanded={isExpanded}
                        aria-controls={`trace-detail-${safeId(node.id)}`}
                        onClick={() => setExpanded(toggleSet(expanded, node.id))}
                      >
                        <span className="trace-node-topline">
                          <span className="trace-kind">{typeLabel(node.type)}</span>
                          <span className="trace-status">{statusLabel(node.status)}</span>
                        </span>
                        <strong>{node.title}</strong>
                        {node.summary ? <span className="trace-summary">{node.summary}</span> : null}
                        <span className="trace-time">
                          {formatTime(node.started_at)}
                          {node.duration_ms !== null ? ` · ${formatDuration(node.duration_ms)}` : ""}
                        </span>
                      </button>
                      {isExpanded ? (
                        <div className="trace-detail" id={`trace-detail-${safeId(node.id)}`}>
                          <dl>
                            <div><dt>状态</dt><dd>{statusLabel(node.status)}</dd></div>
                            <div><dt>序号</dt><dd>{node.sequence} → {node.updated_version}</dd></div>
                            {node.run_id ? <div><dt>Run</dt><dd>{node.run_id}</dd></div> : null}
                          </dl>
                          <pre className="mono">{formatDetail(node.detail)}</pre>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
        {activity.isFetching && nodes.length > 0 ? (
          <p className="trace-sync mono" role="status">正在同步…</p>
        ) : null}
      </aside>
    </>
  );
}

function mergeNodes(current: ActivityNode[], incoming: ActivityNode[]): ActivityNode[] {
  const merged = new Map(current.map((node) => [node.id, node]));
  for (const node of incoming) {
    const previous = merged.get(node.id);
    if (!previous || node.updated_version >= previous.updated_version) {
      merged.set(node.id, node);
    }
  }
  return [...merged.values()].sort((left, right) => left.sequence - right.sequence);
}

function matchesFilter(node: ActivityNode, filter: TraceFilter): boolean {
  if (filter === "all") return true;
  if (filter === "model") return MODEL_TYPES.has(node.type);
  if (filter === "capability") return CAPABILITY_TYPES.has(node.type);
  return STATE_TYPES.has(node.type);
}

function groupNodes(nodes: ActivityNode[]): { id: string; label: string; nodes: ActivityNode[] }[] {
  const groups = new Map<string, ActivityNode[]>();
  for (const node of nodes) {
    const id = node.run_id ?? "session";
    groups.set(id, [...(groups.get(id) ?? []), node]);
  }
  return [...groups.entries()]
    .map(([id, items]) => ({
      id: safeId(id),
      label: id === "session" ? "会话" : `Run · ${shortId(id)}`,
      nodes: items.sort((left, right) => left.sequence - right.sequence),
    }))
    .sort((left, right) => left.nodes[0]!.sequence - right.nodes[0]!.sequence);
}

function toggleSet(current: Set<string>, id: string): Set<string> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function typeLabel(type: string): string {
  return {
    user_prompt: "用户输入",
    model_input: "模型输入",
    model_output: "模型输出",
    tool: "Tool / MCP",
    skill: "Skill",
    resource: "Resource",
    approval: "审批",
    run: "Run",
    session: "Session",
  }[type] ?? type;
}

function statusLabel(status: string): string {
  return {
    queued: "排队中",
    running: "执行中",
    waiting: "等待中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  }[status] ?? status;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "时间未知"
    : new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(date);
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)} s`;
  return `${Math.floor(milliseconds / 60_000)}m ${Math.round((milliseconds % 60_000) / 1_000)}s`;
}

function formatDetail(detail: unknown): string {
  try {
    return JSON.stringify(detail, null, 2) ?? "—";
  } catch {
    return String(detail);
  }
}

function shortId(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 9)}…${value.slice(-6)}`;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}
