import { ClawClient, MOCK_IDENTITY } from "@aurax/claw-sdk";
import { useEffect, useMemo, useState } from "react";
import { loadLastSessionId, saveLastSessionId } from "./cache";
import { loadBaseUrl, saveBaseUrl } from "./connection";
import { ChatView } from "./views/ChatView";
import { McpView } from "./views/McpView";
import { SessionsView } from "./views/SessionsView";
import { SettingsView } from "./views/SettingsView";
import { SkillsView } from "./views/SkillsView";

type View = "chat" | "sessions" | "mcp" | "skills" | "settings";

export function App() {
  const [view, setView] = useState<View>("chat");
  const [baseUrl, setBaseUrl] = useState(loadBaseUrl);
  const client = useMemo(() => new ClawClient({ baseUrl }), [baseUrl]);
  const [sessionId, setSessionId] = useState<string | null>(loadLastSessionId);

  useEffect(() => {
    saveLastSessionId(sessionId);
  }, [sessionId]);

  return (
    <div className="shell">
      <aside className="rail">
        <p className="brand">AuraX</p>
        <p className="brand-sub">AuraClaw 工作台</p>
        <nav>
          {(
            [
              ["chat", "对话"],
              ["sessions", "历史"],
              ["mcp", "MCP"],
              ["skills", "Skill"],
              ["settings", "连接"],
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
          {MOCK_IDENTITY.tenantId}
          <br />
          {MOCK_IDENTITY.deptId} / {MOCK_IDENTITY.userId}
          <br />
          关窗不会取消任务
        </p>
      </aside>
      <main className="stage">
        {view === "chat" ? (
          <ChatView client={client} sessionId={sessionId} onSession={setSessionId} />
        ) : null}
        {view === "sessions" ? (
          <SessionsView
            client={client}
            onOpen={(id) => {
              setSessionId(id);
              setView("chat");
            }}
          />
        ) : null}
        {view === "mcp" ? <McpView client={client} /> : null}
        {view === "skills" ? <SkillsView client={client} /> : null}
        {view === "settings" ? (
          <SettingsView
            baseUrl={baseUrl}
            onSave={(url) => {
              saveBaseUrl(url);
              setBaseUrl(url);
            }}
          />
        ) : null}
      </main>
    </div>
  );
}
