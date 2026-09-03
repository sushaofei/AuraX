import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelTask,
  closeSession,
  createTask,
  followTaskStream,
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
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  loadLastEventId,
  loadTaskDraft,
  loadTraceOpen,
  loadTraceWidth,
  saveLastEventId,
  saveSessionOrigin,
  saveTaskDraft,
  saveTraceOpen,
  saveTraceWidth,
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
  const [traceOpen, setTraceOpen] = useState(() => loadTraceOpen("task"));
  const [traceCount, setTraceCount] = useState(0);
  const [traceWidth, setTraceWidth] = useState(loadTraceWidth);
  const autoCloseSessionRef = useRef<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- session transitions restore persisted per-session draft state */
  useEffect(() => {
    setDraft(loadTaskDraft(sessionId));
  }, [sessionId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    saveTaskDraft(draft, sessionId);
  }, [draft, sessionId]);

  useEffect(() => {
    saveTraceOpen(traceOpen, "task");
  }, [traceOpen]);

  useEffect(() => {
    saveTraceWidth(traceWidth);
  }, [traceWidth]);

  useEffect(() => {
    if (!sessionId) {
      autoCloseSessionRef.current = null;
    }
  }, [sessionId]);

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
      if (sessionId) {
        throw new Error("任务只允许提交一次；如需执行新目标，请新建任务");
      }
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

  const close = useMutation<void, Error, string>({
    mutationFn: async (reason) => {
      if (!sessionId) {
        return;
      }
      const current = (await getTask(client, sessionId)).body;
      await closeSession(client, sessionId, current.projection_version, reason);
    },
    onSuccess: () => queryClient.invalidateQueries(),
  });

  useEffect(() => {
    if (
      !sessionId ||
      !runStatus ||
      !TERMINAL_RUN.has(runStatus) ||
      sessionStatus === "closed" ||
      autoCloseSessionRef.current === sessionId
    ) {
      return;
    }
    autoCloseSessionRef.current = sessionId;
    close.mutate("task run reached terminal state");
  }, [close, runStatus, sessionId, sessionStatus]);

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
  const traceVisible = Boolean(sessionId && !missing && traceOpen);

  const displayResult = invokeResult ?? (task.data?.result_summary ? {
    session_id: task.data.session_id,
    status: task.data.run_status ?? task.data.status,
    result_summary: task.data.result_summary,
    wait_outcome: task.data.run_status as TaskResult["wait_outcome"],
  } : null);

  return (
    <div
      className={`chat-workspace ${traceVisible ? "trace-open" : "trace-closed"}`}
      style={{ "--trace-panel-width": `${traceWidth}px` } as CSSProperties}
    >
      <section className="bench task-stream">
        <header className="chat-toolbar task-toolbar">
          <div>
            <p className="kicker">API task</p>
            <h1>任务</h1>
            <p className="chat-runtime-note">一次性目标执行 · result 作为权威结果</p>
          </div>
          <div className="row">
            <button
              className="btn ghost"
              type="button"
              aria-expanded={traceVisible}
              aria-controls="task-execution-trace"
              aria-label={traceVisible ? "收起执行轨迹" : "显示执行轨迹"}
              title={traceVisible ? "收起执行轨迹" : "显示执行轨迹"}
              disabled={!sessionId || missing}
              onClick={() => setTraceOpen((open) => !open)}
            >
              轨迹
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
              新建任务
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
              <>
                <button
                  className="btn ghost"
                  type="button"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate()}
                >
                  取消
                </button>
                <button
                  className="btn ghost"
                  type="button"
                  disabled={close.isPending}
                  onClick={() => close.mutate("closed by user")}
                  title="结束 Session"
                >
                  结束
                </button>
              </>
            ) : null}
          </div>
        </header>

        <div className="chat-scroll task-scroll">
          {missing ? (
            <div className="chat-notice error">
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
                新建任务
              </button>
            </div>
          ) : null}
          {sessionId && !missing ? (
            <p className="chat-status-line session-meta mono">
              {sessionId} · {task.data?.status ?? "…"} / {task.data?.run_status ?? "…"}
              {streamNote ? ` · ${streamNote}` : ""}
            </p>
          ) : null}
          {!sessionId ? (
            <section className="task-setup" aria-labelledby="task-mode-title">
              <div className="task-setup-heading">
                <div>
                  <p className="kicker">Submission</p>
                  <h2 id="task-mode-title">选择执行方式</h2>
                </div>
                <p>任务只接受一个目标，提交后不可追问。</p>
              </div>
              <div className="chip-row filters" role="tablist" aria-label="触发方式">
                <button
                  type="button"
                  className="skill-chip"
                  role="tab"
                  aria-selected={triggerMode === "async"}
                  aria-pressed={triggerMode === "async"}
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
                  onClick={() => setTriggerMode("sync")}
                >
                  同步 /tasks/sync
                </button>
              </div>
              <SkillSelector client={client} locked={false} compact />
            </section>
          ) : null}
          {accepted ? (
            <details className="task-request-details">
              <summary>202 Accepted · 查看接口地址</summary>
              <div className="api-card">
                <p className="mono">POST /v1/tasks</p>
                <p className="mono">status_url: {accepted.status_url}</p>
                <p className="mono">result_url: {accepted.result_url}</p>
                <p className="mono">stream_url: {accepted.stream_url}</p>
              </div>
            </details>
          ) : null}
          {displayResult ? (
            <article className="task-result result-card">
              <header>
                <strong>权威结果</strong>
                <span className="mono">
                  {displayResult.session_id}
                  {invokeStatus ? ` · HTTP ${invokeStatus}` : ""}
                  {displayResult.wait_outcome ? ` · ${displayResult.wait_outcome}` : ""}
                </span>
              </header>
              {displayResult.result_summary ? (
                <MarkdownBody text={displayResult.result_summary} />
              ) : (
                <pre className="mono result-json">{JSON.stringify(displayResult, null, 2)}</pre>
              )}
            </article>
          ) : null}
          {sessionId && messages.length > 0 ? (
            <details className="task-request-details" open={logOpen}>
              <summary onClick={(event) => {
                event.preventDefault();
                setLogOpen((open) => !open);
              }}>
                消息日志 · {messages.length} 条
              </summary>
              <div className="transcript compact">
                {messages.map((message, index) => (
                  <div
                    key={message.event_id ?? `${message.role}-${index}`}
                    className={`bubble ${message.role === "user" ? "user" : "assistant"}`}
                  >
                    <span className="mono">{message.role}</span>
                    {message.role === "assistant" ? <MarkdownBody text={message.content} /> : message.content}
                  </div>
                ))}
              </div>
            </details>
          ) : null}
          {transcript.data?.pending_approval ? (
            <div className="card chat-approval">
              <strong>待人审</strong>
              <p>{transcript.data.pending_approval.reason}</p>
              <p className="mono">{transcript.data.pending_approval.tool_name}</p>
              {approve.isSuccess &&
              approve.variables?.approvalId === transcript.data.pending_approval.approval_id ? (
                <p className="mono">审批已提交，等待 Runtime 恢复…</p>
              ) : null}
              <div className="row">
                <button className="btn amber" type="button" disabled={approve.isPending} onClick={() => approve.mutate({ approvalId: transcript.data.pending_approval!.approval_id, decision: "approved" })}>
                  {approve.isPending && approve.variables?.decision === "approved" ? "提交中…" : "批准"}
                </button>
                <button className="btn danger" type="button" disabled={approve.isPending} onClick={() => approve.mutate({ approvalId: transcript.data.pending_approval!.approval_id, decision: "rejected" })}>
                  {approve.isPending && approve.variables?.decision === "rejected" ? "提交中…" : "拒绝"}
                </button>
              </div>
              {approve.error ? <p className="error">审批提交失败：{errorText(approve.error)}</p> : null}
            </div>
          ) : null}
          {sessionId ? (
            <div className="task-single-run-note" role="note">
              <strong>一次性任务</strong>
              <p>
                {sessionStatus === "closed"
                  ? "本轮已到达终态，Session 已自动结束。如需执行新的目标，请点击“新建任务”。"
                  : runStatus && TERMINAL_RUN.has(runStatus)
                    ? "本轮已到达终态，正在自动结束 Session…"
                    : "这个任务已经提交，不能继续追问；Run 到达终态后将自动结束 Session。"}
              </p>
            </div>
          ) : null}
        </div>

        {!sessionId ? (
        <div className="composer chat-composer task-composer">
          <textarea
            value={draft}
            aria-label="任务目标"
            placeholder={
              triggerMode === "sync" ? "POST /v1/tasks/sync goal" : "POST /v1/tasks goal"
            }
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && draft.trim() && !trigger.isPending) {
                event.preventDefault();
                trigger.mutate(draft.trim());
              }
            }}
          />
          <div className="chat-composer-footer">
            <span className="mono">
              {triggerMode === "sync" ? "同步等待结果" : "异步提交并等待结果"} · Enter 发送
            </span>
            <button
              className="chat-send"
              type="button"
              aria-label={triggerMode === "sync" ? "同步调用" : "异步触发"}
              disabled={!draft.trim() || trigger.isPending}
              onClick={() => trigger.mutate(draft.trim())}
            >
              <span aria-hidden="true">↑</span>
            </button>
          </div>
          {trigger.error ? <p className="error">{errorText(trigger.error)}</p> : null}
        </div>
        ) : null}
        {resume.error ? <p className="error task-action-error">{errorText(resume.error)}</p> : null}
        {close.error ? <p className="error task-action-error">{errorText(close.error)}</p> : null}
        {cancel.error ? <p className="error task-action-error">{errorText(cancel.error)}</p> : null}
      </section>
      {sessionId && !missing ? (
        <ExecutionTracePanel
          key={`${client.baseUrl}:${sessionId}`}
          client={client}
          sessionId={sessionId}
          panelId="task-execution-trace"
          open={traceOpen}
          live={!streamIdle}
          width={traceWidth}
          onClose={() => setTraceOpen(false)}
          onCountChange={setTraceCount}
          onWidthChange={setTraceWidth}
        />
      ) : null}
    </div>
  );
}
