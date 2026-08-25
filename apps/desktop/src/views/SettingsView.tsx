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
        v1 只允许改 AuraClaw base URL。开发时留空会走 Vite 同源代理。身份固定为 platform / local-org /
        local-user，界面不能切换账号。
      </p>
      <div className="card stack">
        <label>
          AuraClaw URL
          <input
            value={draft}
            placeholder="开发环境留空 = 代理到 http://127.0.0.1:8080"
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
