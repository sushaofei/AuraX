import { ClawClient } from "@aurax/claw-sdk";
import { useEffect, useMemo, useState } from "react";
import {
  loadLastChatSessionId,
  loadLastTaskSessionId,
  saveLastChatSessionId,
  saveLastTaskSessionId,
} from "./cache";
import {
  loadBaseUrl,
  loadTestIdentity,
  saveBaseUrl,
  saveTestIdentity,
} from "./connection";
import { ChatView } from "./views/ChatView";
import { McpView } from "./views/McpView";
import { SessionsView } from "./views/SessionsView";
import { SettingsView } from "./views/SettingsView";
import { SkillsView } from "./views/SkillsView";
import { TaskView } from "./views/TaskView";

type View = "chat" | "task" | "sessions" | "mcp" | "skills" | "settings";

export function App() {
  const [view, setView] = useState<View>("chat");
  const [baseUrl, setBaseUrl] = useState(loadBaseUrl);
  const [identity, setIdentity] = useState(loadTestIdentity);
  const client = useMemo(() => new ClawClient({ baseUrl, identity }), [baseUrl, identity]);
  const [chatSessionId, setChatSessionId] = useState<string | null>(loadLastChatSessionId);
  const [taskSessionId, setTaskSessionId] = useState<string | null>(loadLastTaskSessionId);

  useEffect(() => {
    saveLastChatSessionId(chatSessionId);
  }, [chatSessionId]);

  useEffect(() => {
    saveLastTaskSessionId(taskSessionId);
  }, [taskSessionId]);

  return (
    <div className="shell">
      <aside className="rail">
        <p className="brand">AuraX</p>
        <p className="brand-sub">AuraClaw 工作台</p>
        <nav>
          {(
            [
              ["chat", "对话"],
              ["task", "任务"],
              ["sessions", "历史"],
              ["mcp", "MCP"],
              ["skills", "Skill"],
              ["settings", "配置"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => setView(id)}
              type="button"
            >
              {label}
            </button>
          ))}
        </nav>
        <p className="meta">
          {identity.tenantId}
          <br />
          {identity.deptId} / {identity.userId}
          <br />
          关窗不会取消任务
        </p>
      </aside>
      <main className="stage">
        <div className={view === "chat" ? "view-panel" : "view-panel view-hidden"}>
          <ChatView
            client={client}
            sessionId={chatSessionId}
            onSession={setChatSessionId}
          />
        </div>
        <div className={view === "task" ? "view-panel" : "view-panel view-hidden"}>
          <TaskView
            client={client}
            sessionId={taskSessionId}
            onSession={setTaskSessionId}
          />
        </div>
        {view === "sessions" ? (
          <SessionsView
            client={client}
            onOpen={(id, target) => {
              if (target === "task") {
                setTaskSessionId(id);
                setView("task");
              } else {
                setChatSessionId(id);
                setView("chat");
              }
            }}
          />
        ) : null}
        {view === "mcp" ? <McpView client={client} /> : null}
        {view === "skills" ? <SkillsView client={client} /> : null}
        {view === "settings" ? (
          <SettingsView
            baseUrl={baseUrl}
            identity={identity}
            onSaveBaseUrl={(url) => {
              saveBaseUrl(url);
              setBaseUrl(url);
            }}
            onSaveIdentity={(nextIdentity) => {
              saveTestIdentity(nextIdentity);
              setIdentity({
                tenantId: nextIdentity.tenantId.trim(),
                deptId: nextIdentity.deptId.trim(),
                userId: nextIdentity.userId.trim(),
              });
              setChatSessionId(null);
              setTaskSessionId(null);
            }}
          />
        ) : null}
      </main>
    </div>
  );
}
