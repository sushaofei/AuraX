import { MOCK_IDENTITY } from "@aurax/claw-sdk";
import { useState } from "react";

export function SettingsView({
  baseUrl,
  onSave,
}: {
  baseUrl: string;
  onSave: (url: string) => void;
}) {
  const [draft, setDraft] = useState(baseUrl);
  return (
    <section>
      <p className="kicker">Uplink</p>
      <h1>连接</h1>
      <p className="lede">
        v1 只允许改 AuraClaw base URL。本机 Vite 开发留空会代理到 127.0.0.1:8080；其他主机填
        {"http://<跑 AuraClaw 的机器>:8080"}。身份固定为 platform / local-org / local-user，界面不能切换账号。
      </p>
      <div className="card stack">
        <label>
          AuraClaw URL
          <input
            value={draft}
            placeholder="本机留空；其他主机填 http://<AuraClaw 主机>:8080"
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <button className="btn" type="button" onClick={() => onSave(draft.trim())}>
          保存
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
