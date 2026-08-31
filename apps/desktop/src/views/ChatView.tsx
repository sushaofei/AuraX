import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createModelOutputDeltaState,
  createTask,
  followTaskStream,
  followUp,
  getTask,
  getTranscript,
  mergeModelOutputDelta,
  parseRuntimeEvent,
  respondToApproval,
  type ClawClient,
  type ModelOutputDeltaState,
  type TranscriptMessage,
} from "@aurax/claw-sdk";
import { useEffect, useRef, useState } from "react";
import {
  clearStreamingBuffer,
  loadChatDraft,
  loadLastEventId,
  loadStreamingBuffer,
  saveChatDraft,
  saveLastEventId,
  saveSessionOrigin,
  saveStreamingBuffer,
} from "../cache";
import { MarkdownBody } from "../components/MarkdownBody";
import { SkillSelector } from "../components/SkillSelector";
import { errorText, isNotFound } from "../lib/errors";

const TERMINAL_RUN = new Set(["completed", "failed", "cancelled"]);

export function ChatView({
  client,
  sessionId,
  onSession,
}: {
  client: ClawClient;
  sessionId: string | null;
  onSession: (id: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => loadChatDraft(sessionId));
  const [streamNote, setStreamNote] = useState("");
  const [optimistic, setOptimistic] = useState<string[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const deltaStateRef = useRef<ModelOutputDeltaState>(createModelOutputDeltaState());
  const activeSessionRef = useRef<string | null>(sessionId);

  /* eslint-disable react-hooks/set-state-in-effect -- session transitions restore persisted per-session UI state */
  useEffect(() => {
    activeSessionRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    saveChatDraft(draft, sessionId);
  }, [draft, sessionId]);

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
    refetchInterval: (query) => {
      const status = query.state.data?.run_status;
      return status && TERMINAL_RUN.has(status) ? false : 2000;
    },
  });

  const messages: TranscriptMessage[] = transcript.data?.messages ?? [];
  const confirmedUser = new Set(
    messages.filter((message) => message.role === "user").map((message) => message.content),
  );
  const pendingOptimistic = optimistic.filter((text) => !confirmedUser.has(text));
  const runStatus = task.data?.run_status;
  const sessionStatus = task.data?.status;
  const streamIdle =
    typeof runStatus === "string" &&
    TERMINAL_RUN.has(runStatus) &&
    sessionStatus !== "waiting_for_human";

  const clearStreaming = (targetSessionId: string | null = sessionId) => {
    deltaStateRef.current = createModelOutputDeltaState();
    setStreamingText("");
    if (targetSessionId) {
      clearStreamingBuffer(targetSessionId);
    }
  };

  const persistStreaming = (state: ModelOutputDeltaState, targetSessionId: string | null) => {
    if (!targetSessionId || !state.text) {
      return;
    }
    saveStreamingBuffer(targetSessionId, {
      text: state.text,
      runId: state.runId,
      seenEventIds: [...state.seenEventIds],
    });
  };

  const restoreStreaming = (
    targetSessionId: string,
    runId: string | null | undefined,
  ) => {
    const cached = loadStreamingBuffer(targetSessionId);
    if (!cached?.text) {
      clearStreaming(targetSessionId);
      return;
    }
    if (runId && cached.runId && cached.runId !== runId) {
      clearStreamingBuffer(targetSessionId);
      clearStreaming(targetSessionId);
      return;
    }
    deltaStateRef.current = {
      seenEventIds: new Set(cached.seenEventIds),
      text: cached.text,
      runId: cached.runId,
    };
    setStreamingText(cached.text);
  };

  useEffect(() => {
    setOptimistic([]);
    setStreamNote("");
    setDraft(loadChatDraft(sessionId));
    if (!sessionId) {
      clearStreaming(null);
      return;
    }
    clearStreaming(sessionId);
    restoreStreaming(sessionId, task.data?.run_id);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    restoreStreaming(sessionId, task.data?.run_id);
  }, [sessionId, task.data?.run_id]);

  useEffect(() => {
    if (streamIdle && messages.some((message) => message.role === "assistant")) {
      clearStreaming();
    }
  }, [streamIdle, messages, sessionId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const invalidateSessionQueries = (targetSessionId: string) => {
    void queryClient.invalidateQueries({
      queryKey: ["transcript", client.baseUrl, targetSessionId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["task", client.baseUrl, targetSessionId],
    });
  };

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    const refresh = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      invalidateSessionQueries(sessionId);
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [client.baseUrl, queryClient, sessionId]);

  useEffect(() => {
    if (!sessionId || isNotFound(task.error)) {
      return;
    }
    const streamSessionId = sessionId;
    const abort = new AbortController();
    const lastEventId = loadLastEventId(streamSessionId);
    const streamOptions: { lastEventId?: string; signal: AbortSignal } = {
      signal: abort.signal,
    };
    if (lastEventId) {
      streamOptions.lastEventId = lastEventId;
    }
    void (async () => {
      try {
        for await (const event of followTaskStream(client, streamSessionId, streamOptions)) {
          if (activeSessionRef.current !== streamSessionId) {
            break;
          }
          if (event.id) {
            saveLastEventId(streamSessionId, event.id);
          }
          if (event.event === "stream.reset") {
            setStreamNote("stream.reset — 回退 transcript");
            clearStreaming(streamSessionId);
            await queryClient.invalidateQueries({
              queryKey: ["transcript", client.baseUrl, streamSessionId],
            });
            await queryClient.invalidateQueries({
              queryKey: ["task", client.baseUrl, streamSessionId],
            });
            continue;
          }
          if (event.event) {
            setStreamNote(event.event);
          }
          const runtime = parseRuntimeEvent(event.data);
          if (runtime?.type === "model.output.delta") {
            deltaStateRef.current = mergeModelOutputDelta(deltaStateRef.current, runtime);
            setStreamingText(deltaStateRef.current.text);
            persistStreaming(deltaStateRef.current, streamSessionId);
          }
          if (
            runtime &&
            (runtime.type === "model.output.completed" || runtime.type === "run.completed")
          ) {
            clearStreaming(streamSessionId);
            await queryClient.invalidateQueries({
              queryKey: ["transcript", client.baseUrl, streamSessionId],
            });
            await queryClient.invalidateQueries({
              queryKey: ["task", client.baseUrl, streamSessionId],
            });
          }
        }
      } catch (error) {
        if (!abort.signal.aborted && activeSessionRef.current === streamSessionId) {
          setStreamNote(errorText(error));
        }
      }
    })();
    return () => abort.abort();
  }, [client, sessionId, queryClient, task.error]);

  const send = useMutation({
    mutationFn: async (text: string) => {
      clearStreaming();
      if (!sessionId) {
        const created = await createTask(client, { goal: text, source: "chat" });
        saveSessionOrigin(created.body.session_id, "chat");
        onSession(created.body.session_id);
        return created.body;
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
    onMutate: (text) => {
      setOptimistic((prev) => [...prev, text]);
    },
    onSuccess: (_data, _text, _context) => {
      setDraft("");
      saveChatDraft("", sessionId);
      if (sessionId) {
        invalidateSessionQueries(sessionId);
      } else {
        void queryClient.invalidateQueries({ queryKey: ["tasks", client.baseUrl] });
      }
    },
    onError: (_error, text) => {
      setOptimistic((prev) => {
        const index = prev.lastIndexOf(text);
        if (index < 0) {
          return prev;
        }
        return [...prev.slice(0, index), ...prev.slice(index + 1)];
      });
    },
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
    onSettled: () => {
      if (sessionId) {
        invalidateSessionQueries(sessionId);
      }
    },
  });

  const waiting = task.data?.status === "waiting_for_human";
  const closed = task.data?.status === "closed";
  const missing = isNotFound(task.error);
  const showStreaming = streamingText.length > 0;

  return (
    <section className="bench chat-stream">
      <p className="kicker">Live chat</p>
      <div className="page-head">
        <h1>对话</h1>
        <div className="row">
          <button className="btn ghost" type="button" onClick={() => onSession(null)}>
            新开一轮
          </button>
        </div>
      </div>
      <p className="lede">
        SSE 实时展示 model.output.delta；终态以 transcript 为准。关闭窗口不会取消任务。
      </p>
      {missing ? (
        <p className="error">
          缓存的 Session 已不存在。
          <button className="btn ghost" type="button" onClick={() => onSession(null)}>
            开始新对话
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
        <p className="empty">还没有 Session。勾选要用的 Skill，输入目标后开始对话。</p>
      ) : null}
      <SkillSelector client={client} locked={closed || waiting} />
      <div className="transcript">
        {messages.map((message, index) => (
          <div
            key={message.event_id ?? `${message.role}-${index}`}
            className={`bubble ${message.role === "user" ? "user" : "assistant"}`}
          >
            {message.role === "user" ? (
              message.content
            ) : (
              <MarkdownBody text={message.content} />
            )}
          </div>
        ))}
        {pendingOptimistic.map((text, index) => (
          <div key={`optimistic-${index}`} className="bubble user pending">
            {text}
          </div>
        ))}
        {showStreaming ? (
          <div className="bubble assistant streaming">
            <span className="streaming-text">{streamingText}</span>
            <span className="streaming-cursor" aria-hidden="true">▍</span>
          </div>
        ) : null}
      </div>
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
          {approve.error ? <p className="error">审批提交失败：{errorText(approve.error)}</p> : null}
        </div>
      ) : null}
      <div className="composer stack">
        <textarea
          value={draft}
          placeholder={closed ? "Session 已结束，请新开一轮" : "要 AuraClaw 做什么？"}
          disabled={closed || missing}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && draft.trim()) {
              send.mutate(draft.trim());
            }
          }}
        />
        <div className="row">
          <button
            className="btn"
            type="button"
            disabled={!draft.trim() || send.isPending || closed || waiting || missing}
            onClick={() => send.mutate(draft.trim())}
          >
            {sessionId ? "追问" : "开始"}
          </button>
        </div>
        {send.error ? <p className="error">{errorText(send.error)}</p> : null}
      </div>
    </section>
  );
}
