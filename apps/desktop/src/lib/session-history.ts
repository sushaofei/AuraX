import type { TaskView } from "@aurax/claw-sdk";
import type { SessionOrigin } from "../cache";

type HistoryState = Pick<TaskView, "status" | "run_status">;
export type HistoryOrigin = SessionOrigin | "unknown";
export const HISTORY_STATUS_FILTERS = [
  { id: "all", label: "全部" }, { id: "live", label: "进行中" },
  { id: "hitl", label: "待人审" }, { id: "paused", label: "可继续" },
  { id: "done", label: "已完成" }, { id: "failed", label: "失败" },
  { id: "cancelled", label: "已取消" }, { id: "closed", label: "已关闭" },
] as const;
export type HistoryStatusFilter = typeof HISTORY_STATUS_FILTERS[number]["id"];
const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const RUNNING = new Set(["created", "pending", "runnable", "running"]);
const RESUMABLE = new Set(["paused", "retry_wait"]);

export function matchesHistoryStatus(task: HistoryState, filter: HistoryStatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "closed") return task.status === "closed";
  // Session ready/closed does not replace the outcome of its most recent Run.
  const run = task.run_status ?? task.status;
  if (filter === "done") return run === "completed";
  if (filter === "failed") return run === "failed";
  if (filter === "cancelled") return run === "cancelled";
  if (task.status === "closed") return false;
  if (filter === "hitl") return task.status === "waiting_for_human" || run === "waiting_for_human";
  if (filter === "paused") return RESUMABLE.has(task.status) || RESUMABLE.has(run);
  return !TERMINAL.has(run) && RUNNING.has(run)
    && task.status !== "waiting_for_human" && !RESUMABLE.has(task.status);
}

export function historyOrigin(localOrigin: SessionOrigin | null): HistoryOrigin {
  // Both AuraX entry points persist source=chat. Missing local data is not proof
  // that a Session came from either page, even when the Session is closed.
  return localOrigin ?? "unknown";
}

export function historyStatusLabel(value: string): string {
  const labels: Record<string, string> = {
    created: "已创建", ready: "就绪", pending: "排队中", runnable: "待执行",
    running: "运行中", waiting_for_human: "待人审", paused: "已暂停",
    retry_wait: "等待重试", completed: "已完成", failed: "失败", cancelled: "已取消", closed: "已关闭",
  };
  return labels[value] ?? value;
}
