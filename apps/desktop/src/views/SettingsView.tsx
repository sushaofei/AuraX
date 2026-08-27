import { MOCK_IDENTITY } from "@aurax/claw-sdk";
import { useState } from "react";
import { isSameOriginUplink } from "../connection";

export function SettingsView({
  baseUrl,
  onSave,
}: {
  baseUrl: string;
  onSave: (url: string) => void;
}) {
  const sameOrigin = isSameOriginUplink();
  const [draft, setDraft] = useState(baseUrl);
  return (
    <section>
      <p className="kicker">Uplink</p>
      <h1>连接</h1>
      <p className="lede">
        {sameOrigin
          ? "当前为同源部署：页面所在 nginx 已将 /v1 反代到 AuraClaw，AuraClaw URL 必须留空。不要填 MCP Server 的 endpoint，也不要填 http://10.244.16.131:8080，否则浏览器会因 CORS 报 Failed to fetch。"
          : "v1 只允许改 AuraClaw base URL。本机 Vite 开发留空会代理到 127.0.0.1:8080；其他主机填 http://<跑 AuraClaw 的机器>:8080。身份固定为 platform / local-org / local-user，界面不能切换账号。"}
      </p>
      <div className="card stack">
        {sameOrigin ? (
          <p className="mono">
            Uplink: {typeof window !== "undefined" ? window.location.origin : "（同源）"}
            <br />
            AuraClaw URL: （留空，由 nginx 反代）
          </p>
        ) : (
          <label>
            AuraClaw URL
            <input
              value={draft}
              placeholder="本机留空；其他主机填 http://<AuraClaw 主机>:8080"
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
        )}
        <button
          className="btn"
          type="button"
          onClick={() => onSave(sameOrigin ? "" : draft.trim())}
        >
          {sameOrigin ? "确认同源 uplink" : "保存"}
        </button>
        <p className="mono">
          X-Tenant-ID: {MOCK_IDENTITY.tenantId}
          <br />
          X-Dept-ID: {MOCK_IDENTITY.deptId}
          <br />
          X-Actor-ID: {MOCK_IDENTITY.userId}
        </p>
      </div>
    </section>
  );
}
