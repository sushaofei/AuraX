import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelTask,
  closeSession,
  createTask,
  followTaskStream,
  followUp,
  getTask,
  getTranscript,
  listSkills,
  respondToApproval,
  resumeTask,
  toggleSkill,
  type ClawClient,
  type SkillSummary,
  type TranscriptMessage,
} from "@aurax/claw-sdk";
import { useEffect, useState } from "react";
import { loadDraft, loadLastEventId, saveDraft, saveLastEventId } from "../cache";
import { MarkdownBody } from "../components/MarkdownBody";
import { errorText, isNotFound } from "../lib/errors";

const TERMINAL_RUN = new Set(["completed", "failed", "cancelled"]);
const RESUMABLE = new Set(["paused", "retry_wait"]);

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
  const [draft, setDraft] = useState(loadDraft);
  const [streamNote, setStreamNote] = useState("");
  const [optimistic, setOptimistic] = useState<string[]>([]);

  useEffect(() => {
    saveDraft(draft);
  }, [draft]);

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
  const confirmedUser = new Set(
    messages.filter((message) => message.role === "user").map((message) => message.content),
  );
  const pendingOptimistic = optimistic.filter((text) => !confirmedUser.has(text));
  const runStatus = task.data?.run_status;
  const sessionStatus = task.data?.status;
  const streamIdle =
    typeof runStatus === "string" &&
    TERMINAL_RUN.has(runStatus) &&
    sessionStatus !== "waiting_for_human" &&
    !RESUMABLE.has(sessionStatus ?? "");

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
          await queryClient.invalidateQueries({ queryKey: ["transcript"] });
          await queryClient.invalidateQueries({ queryKey: ["task"] });
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          setStreamNote(errorText(error));
        }
      }
    })();
    return () => abort.abort();
  }, [client, sessionId, queryClient, task.error, streamIdle]);

  const send = useMutation({
    mutationFn: async (text: string) => {
      if (!sessionId) {
        const created = await createTask(client, { goal: text, source: "chat" });
        onSession(created.body.session_id);
        return created.body;
      }
      const current = task.data ?? (await getTask(client, sessionId)).body;
      if (current.status === "waiting_for_human") {
        throw new Error("当前等待人审，不能当普通追问发送");
      }
      if (current.status === "closed") {
        throw new Error("Session 已结束，请新开一轮");
      }
      return (
        await followUp(client, sessionId, text, current.projection_version, current.status)
      ).body;
    },
    onMutate: (text) => {
      setOptimistic((prev) => [...prev, text]);
    },
    onSuccess: () => {
      setDraft("");
      saveDraft("");
      void queryClient.invalidateQueries();
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

  const cancel = useMutation({
    mutationFn: async () => {
      if (!sessionId || !task.data) {
        return;
      }
      await cancelTask(client, sessionId, task.data.projection_version);
    },
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const resume = useMutation({
    mutationFn: async () => {
      if (!sessionId || !task.data) {
        return;
      }
      await resumeTask(client, sessionId, task.data.projection_version);
    },
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const close = useMutation({
    mutationFn: async () => {
      if (!sessionId || !task.data) {
        return;
      }
      await closeSession(client, sessionId, task.data.projection_version);
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

  return (
    <section className="bench">
      <p className="kicker">Live bench</p>
      <div className="page-head">
        <h1>对话</h1>
        <div className="row">
          <button className="btn ghost" type="button" onClick={() => onSession(null)}>
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
        发送即创建 AuraClaw Session。流式只用于展示，最终以 transcript / result 为准。关闭窗口不会取消任务。
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
      {!sessionId ? <p className="empty">还没有 Session。勾选要用的 Skill，输入目标后开始一轮对话。</p> : null}
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
      </div>
      {task.data?.run_status === "completed" && task.data.result_summary ? (
        <div className="card result-card">
          <strong>权威结果</strong>
          <MarkdownBody text={task.data.result_summary} />
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
          <button
            className="btn ghost"
            type="button"
            disabled={!sessionId || cancel.isPending || closed || missing}
            onClick={() => cancel.mutate()}
          >
            取消当前 Run
          </button>
        </div>
        {send.error ? <p className="error">{errorText(send.error)}</p> : null}
        {resume.error ? <p className="error">{errorText(resume.error)}</p> : null}
        {close.error ? <p className="error">{errorText(close.error)}</p> : null}
        {cancel.error ? <p className="error">{errorText(cancel.error)}</p> : null}
      </div>
    </section>
  );
}

function SkillSelector({ client, locked }: { client: ClawClient; locked: boolean }) {
  const queryClient = useQueryClient();
  const skills = useQuery({
    queryKey: ["skills", client.baseUrl],
    queryFn: async () => (await listSkills(client)).body.skills,
  });
  const toggle = useMutation({
    mutationFn: async (skill: SkillSummary) => {
      await toggleSkill(
        client,
        skill.publisher,
        skill.name,
        skill.status === "active" ? "disable" : "enable",
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
  });

  return (
    <div className="skill-picker">
      <p className="skill-picker-label">允许使用的 Skill</p>
      <p className="mono">
        勾选改的是租户目录，下一轮 Run 由 AuraClaw Resolver 解析；进行中的 Run 不受影响。
      </p>
      {skills.error ? <p className="error">{errorText(skills.error)}</p> : null}
      <div className="chip-row">
        {(skills.data ?? []).map((skill) => {
          const pressed = skill.status === "active";
          return (
            <button
              key={`${skill.publisher}/${skill.name}`}
              type="button"
              className="skill-chip"
              aria-pressed={pressed}
              disabled={locked || toggle.isPending}
              title={skill.description || `${skill.publisher}/${skill.name}`}
              onClick={() => toggle.mutate(skill)}
            >
              {skill.name}
              <span>{pressed ? "开" : "关"}</span>
            </button>
          );
        })}
      </div>
      {skills.data?.length === 0 ? (
        <p className="empty">租户还没有 Skill。到 Skill 页查看目录。</p>
      ) : null}
      {toggle.error ? <p className="error">{errorText(toggle.error)}</p> : null}
    </div>
  );
}
