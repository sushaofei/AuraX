import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelTask,
  closeSession,
  createTask,
  followTaskStream,
  followUp,
  getResult,
  getTask,
  getTranscript,
  respondToApproval,
  resumeTask,
  syncInvokeTask,
  type ClawClient,
  type TaskAccepted,
  type TaskResult,
  type TranscriptMessage,
} from "@aurax/claw-sdk";
import { useEffect, useState } from "react";
import {
  loadLastEventId,
  loadTaskDraft,
  loadTraceOpen,
  saveLastEventId,
  saveSessionOrigin,
  saveTaskDraft,
  saveTraceOpen,
} from "../cache";
import { ExecutionTracePanel } from "../components/ExecutionTracePanel";
import { MarkdownBody } from "../components/MarkdownBody";
import { SkillSelector } from "../components/SkillSelector";
import { errorText, isNotFound } from "../lib/errors";

const TERMINAL_RUN = new Set(["completed", "failed", "cancelled"]);
const RESUMABLE = new Set(["paused", "retry_wait"]);
type TriggerMode = "async" | "sync";

export function TaskView({
  client,
  sessionId,
  onSession,
}: {
  client: ClawClient;
  sessionId: string | null;
  onSession: (id: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => loadTaskDraft(sessionId));
  const [triggerMode, setTriggerMode] = useState<TriggerMode>("async");
  const [accepted, setAccepted] = useState<TaskAccepted | null>(null);
  const [invokeResult, setInvokeResult] = useState<TaskResult | null>(null);
  const [invokeStatus, setInvokeStatus] = useState<number | null>(null);
  const [streamNote, setStreamNote] = useState("");
  const [logOpen, setLogOpen] = useState(false);
  const [traceOpen, setTraceOpen] = useState(loadTraceOpen);
  const [traceCount, setTraceCount] = useState(0);

  /* eslint-disable react-hooks/set-state-in-effect -- session transitions restore persisted per-session draft state */
  useEffect(() => {
    setDraft(loadTaskDraft(sessionId));
  }, [sessionId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    saveTaskDraft(draft, sessionId);
  }, [draft, sessionId]);

  useEffect(() => {
    saveTraceOpen(traceOpen);
  }, [traceOpen]);

  const task = useQuery({
    queryKey: ["task", client.baseUrl, sessionId],
    queryFn: async () => (await getTask(client, sessionId!)).body,
    enabled: Boolean(sessionId),
    refetchInterval: (query) => {
      const status = query.state.data?.run_status;
      return status && TERMINAL_RUN.has(status) ? false : 2500;
    },
    retry: (count, error) => !isNotFound(error) && count < 2,
  });

  const transcript = useQuery({
    queryKey: ["transcript", client.baseUrl, sessionId],
    queryFn: async () => (await getTranscript(client, sessionId!)).body,
    enabled: Boolean(sessionId) && !isNotFound(task.error),
    refetchInterval: 2000,
  });

  const messages: TranscriptMessage[] = transcript.data?.messages ?? [];
  const runStatus = task.data?.run_status;
  const sessionStatus = task.data?.status;
  const streamIdle =
    typeof runStatus === "string" &&
    TERMINAL_RUN.has(runStatus) &&
    sessionStatus !== "waiting_for_human" &&
    !RESUMABLE.has(sessionStatus ?? "");

  useEffect(() => {
    if (!sessionId || !streamIdle) {
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["task", client.baseUrl, sessionId] });
  }, [client.baseUrl, queryClient, sessionId, streamIdle]);

  useEffect(() => {
    if (!sessionId || isNotFound(task.error) || streamIdle) {
      return;
    }
    const abort = new AbortController();
    const lastEventId = loadLastEventId(sessionId);
    const streamOptions: { lastEventId?: string; signal: AbortSignal } = {
      signal: abort.signal,
    };
    if (lastEventId) {
      streamOptions.lastEventId = lastEventId;
    }
    void (async () => {
      try {
        for await (const event of followTaskStream(client, sessionId, streamOptions)) {
          if (event.id) {
            saveLastEventId(sessionId, event.id);
          }
          if (event.event) {
            setStreamNote(event.event);
          }
          await queryClient.invalidateQueries({ queryKey: ["task"] });
          await queryClient.invalidateQueries({
            queryKey: ["activity", client.baseUrl, sessionId],
          });
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          setStreamNote(errorText(error));
        }
      }
    })();
    return () => abort.abort();
  }, [client, sessionId, queryClient, task.error, streamIdle]);

  const trigger = useMutation({
    mutationFn: async (text: string) => {
      if (!sessionId) {
        if (triggerMode === "sync") {
          const invoked = await syncInvokeTask(client, { goal: text, timeoutSeconds: 120 });
          setInvokeResult(invoked.body);
          setInvokeStatus(invoked.status);
          saveSessionOrigin(invoked.body.session_id, "task");
          onSession(invoked.body.session_id);
          return invoked.body;
        }
        const created = await createTask(client, { goal: text, source: "chat" });
        setAccepted(created.body);
        saveSessionOrigin(created.body.session_id, "task");
        onSession(created.body.session_id);
        const waited = await getResult(client, created.body.session_id, {
          wait: true,
          timeoutSeconds: 120,
        });
        setInvokeResult(waited.body);
        setInvokeStatus(waited.status);
        return waited.body;
      }
      const current = (await getTask(client, sessionId)).body;
      if (current.status === "waiting_for_human") {
        throw new Error("当前等待人审，不能当普通追问发送");
      }
      if (current.status === "closed") {
        throw new Error("Session 已结束，请新开一轮");
      }
      const expectedVersion = Math.max(
        current.projection_version,
        transcript.data?.projection_version ?? 0,
      );
      return (await followUp(client, sessionId, text, expectedVersion, current.status)).body;
    },
    onSuccess: () => {
      setDraft("");
      saveTaskDraft("");
      void queryClient.invalidateQueries();
    },
  });

  const cancel = useMutation({
    mutationFn: async () => {
      if (!sessionId) {
        return;
      }
      const current = (await getTask(client, sessionId)).body;
      await cancelTask(client, sessionId, current.projection_version);
    },
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const resume = useMutation({
    mutationFn: async () => {
      if (!sessionId) {
        return;
      }
      const current = (await getTask(client, sessionId)).body;
      await resumeTask(client, sessionId, current.projection_version);
    },
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const close = useMutation({
    mutationFn: async () => {
      if (!sessionId) {
        return;
      }
      const current = (await getTask(client, sessionId)).body;
      await closeSession(client, sessionId, current.projection_version);
    },
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const approve = useMutation({
    mutationFn: async ({
      approvalId,
      decision,
    }: {
      approvalId: string;
      decision: "approved" | "rejected";
    }) => {
      if (!sessionId) {
        throw new Error("Session 不存在，无法提交审批");
      }
      const current = (await getTask(client, sessionId)).body;
      const expectedVersion = Math.max(
        current.projection_version,
        transcript.data?.projection_version ?? 0,
      );
      return respondToApproval(
        client,
        sessionId,
        approvalId,
        decision,
        expectedVersion,
      );
    },
    onSettled: () => queryClient.invalidateQueries(),
  });

  const waiting = task.data?.status === "waiting_for_human";
  const closed = task.data?.status === "closed";
  const canResume = Boolean(task.data && RESUMABLE.has(task.data.status) && !waiting);
  const missing = isNotFound(task.error);

  const displayResult = invokeResult ?? (task.data?.result_summary ? {
    session_id: task.data.session_id,
    status: task.data.run_status ?? task.data.status,
    result_summary: task.data.result_summary,
    wait_outcome: task.data.run_status as TaskResult["wait_outcome"],
  } : null);

  return (
    <div className={`chat-workspace ${traceOpen ? "trace-open" : "trace-closed"}`}>
      <section className="bench">
        <p className="kicker">API bench</p>
        <div className="page-head">
          <h1>任务</h1>
          <div className="row">
            <button
              className="btn ghost"
              type="button"
              aria-expanded={Boolean(sessionId && !missing && traceOpen)}
              aria-controls="execution-trace"
              disabled={!sessionId || missing}
              onClick={() => setTraceOpen((open) => !open)}
            >
              {traceOpen ? "收起轨迹" : "执行轨迹"}
              {traceCount > 0 ? ` · ${traceCount}` : ""}
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                onSession(null);
                setAccepted(null);
                setInvokeResult(null);
                setInvokeStatus(null);
              }}
            >
              新开一轮
            </button>
            {canResume ? (
              <button
                className="btn amber"
                type="button"
                disabled={resume.isPending}
                onClick={() => resume.mutate()}
              >
                继续
              </button>
            ) : null}
            {sessionId && !closed && !missing ? (
              <button
                className="btn ghost"
                type="button"
                disabled={close.isPending}
                onClick={() => close.mutate()}
              >
                结束 Session
              </button>
            ) : null}
          </div>
        </div>
        <p className="lede">
          通过 REST 触发 AuraClaw 任务，以 result 回调（GET /result?wait=true 或 /tasks/sync）为权威结果。关闭窗口不会取消任务。
        </p>
        {missing ? (
          <p className="error">
            缓存的 Session 已不存在。
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                onSession(null);
                setAccepted(null);
                setInvokeResult(null);
              }}
            >
              开始新任务
            </button>
          </p>
        ) : null}
        {sessionId && !missing ? (
          <p className="session-meta mono">
            {sessionId} · {task.data?.status ?? "…"} / {task.data?.run_status ?? "…"}
            {streamNote ? ` · ${streamNote}` : ""}
          </p>
        ) : null}
        {!sessionId ? (
          <p className="empty">还没有 Session。选择触发方式，输入 goal 后提交。</p>
        ) : null}
        <div className="chip-row filters" role="tablist" aria-label="触发方式">
          <button
            type="button"
            className="skill-chip"
            role="tab"
            aria-selected={triggerMode === "async"}
            aria-pressed={triggerMode === "async"}
            disabled={Boolean(sessionId)}
            onClick={() => setTriggerMode("async")}
          >
            异步 202 + wait
          </button>
          <button
            type="button"
            className="skill-chip"
            role="tab"
            aria-selected={triggerMode === "sync"}
            aria-pressed={triggerMode === "sync"}
            disabled={Boolean(sessionId)}
            onClick={() => setTriggerMode("sync")}
          >
            同步 /tasks/sync
          </button>
        </div>
        {accepted ? (
          <div className="card api-card">
            <strong>202 Accepted</strong>
            <p className="mono">POST /v1/tasks</p>
            <p className="mono">status_url: {accepted.status_url}</p>
            <p className="mono">result_url: {accepted.result_url}</p>
            <p className="mono">stream_url: {accepted.stream_url}</p>
          </div>
        ) : null}
        <SkillSelector client={client} locked={closed || waiting} />
        {displayResult ? (
          <div className="card result-card">
            <strong>
              权威结果
              {invokeStatus ? ` · HTTP ${invokeStatus}` : ""}
              {displayResult.wait_outcome ? ` · ${displayResult.wait_outcome}` : ""}
            </strong>
            {displayResult.result_summary ? (
              <MarkdownBody text={displayResult.result_summary} />
            ) : (
              <pre className="mono result-json">
                {JSON.stringify(displayResult, null, 2)}
              </pre>
            )}
          </div>
        ) : null}
        {sessionId && messages.length > 0 ? (
          <div className="card">
            <button
              className="btn ghost"
              type="button"
              aria-expanded={logOpen}
              onClick={() => setLogOpen((open) => !open)}
            >
              {logOpen ? "收起消息日志" : "展开消息日志"} · {messages.length} 条
            </button>
            {logOpen ? (
              <div className="transcript compact">
                {messages.map((message, index) => (
                  <div
                    key={message.event_id ?? `${message.role}-${index}`}
                    className={`bubble ${message.role === "user" ? "user" : "assistant"}`}
                  >
                    <span className="mono">{message.role}</span>
                    {message.role === "assistant" ? (
                      <MarkdownBody text={message.content} />
                    ) : (
                      message.content
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {transcript.data?.pending_approval ? (
          <div className="card">
            <strong>待人审</strong>
            <p>{transcript.data.pending_approval.reason}</p>
            <p className="mono">{transcript.data.pending_approval.tool_name}</p>
            {approve.isSuccess &&
            approve.variables?.approvalId === transcript.data.pending_approval.approval_id ? (
              <p className="mono">审批已提交，等待 Runtime 恢复…</p>
            ) : null}
            <div className="row">
              <button
                className="btn amber"
                type="button"
                disabled={approve.isPending}
                onClick={() =>
                  approve.mutate({
                    approvalId: transcript.data.pending_approval!.approval_id,
                    decision: "approved",
                  })
                }
              >
                {approve.isPending && approve.variables?.decision === "approved"
                  ? "提交中…"
                  : "批准"}
              </button>
              <button
                className="btn danger"
                type="button"
                disabled={approve.isPending}
                onClick={() =>
                  approve.mutate({
                    approvalId: transcript.data.pending_approval!.approval_id,
                    decision: "rejected",
                  })
                }
              >
                {approve.isPending && approve.variables?.decision === "rejected"
                  ? "提交中…"
                  : "拒绝"}
              </button>
            </div>
            {approve.error ? (
              <p className="error">审批提交失败：{errorText(approve.error)}</p>
            ) : null}
          </div>
        ) : null}
        <div className="composer stack">
          <textarea
            value={draft}
            placeholder={
              closed
                ? "Session 已结束，请新开一轮"
                : triggerMode === "sync"
                  ? "POST /v1/tasks/sync goal"
                  : "POST /v1/tasks goal"
            }
            disabled={closed || missing || Boolean(sessionId && triggerMode === "sync")}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && draft.trim()) {
                trigger.mutate(draft.trim());
              }
            }}
          />
          <div className="row">
            <button
              className="btn"
              type="button"
              disabled={
                !draft.trim() ||
                trigger.isPending ||
                closed ||
                waiting ||
                missing ||
                Boolean(sessionId && triggerMode === "sync")
              }
              onClick={() => trigger.mutate(draft.trim())}
            >
              {sessionId ? "追问" : triggerMode === "sync" ? "同步调用" : "异步触发"}
            </button>
            <button
              className="btn ghost"
              type="button"
              disabled={!sessionId || cancel.isPending || closed || missing}
              onClick={() => cancel.mutate()}
            >
              取消当前 Run
            </button>
          </div>
          {trigger.error ? <p className="error">{errorText(trigger.error)}</p> : null}
          {resume.error ? <p className="error">{errorText(resume.error)}</p> : null}
          {close.error ? <p className="error">{errorText(close.error)}</p> : null}
          {cancel.error ? <p className="error">{errorText(cancel.error)}</p> : null}
        </div>
      </section>
      {sessionId && !missing ? (
        <ExecutionTracePanel
          key={`${client.baseUrl}:${sessionId}`}
          client={client}
          sessionId={sessionId}
          open={traceOpen}
          live={!streamIdle}
          onClose={() => setTraceOpen(false)}
          onCountChange={setTraceCount}
        />
      ) : null}
    </div>
  );
}
