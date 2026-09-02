import { type MockIdentity } from "@aurax/claw-sdk";
import { useState } from "react";
import { isSameOriginUplink } from "../connection";

export function SettingsView({
  baseUrl,
  identity,
  onSaveBaseUrl,
  onSaveIdentity,
}: {
  baseUrl: string;
  identity: MockIdentity;
  onSaveBaseUrl: (url: string) => void;
  onSaveIdentity: (identity: MockIdentity) => void;
}) {
  const sameOrigin = isSameOriginUplink();
  const [draft, setDraft] = useState(baseUrl);
  const [identityDraft, setIdentityDraft] = useState(identity);
  const identityComplete = Object.values(identityDraft).every((value) => value.trim());
  return (
    <section className="settings-view">
      <p className="kicker">Environment</p>
      <h1>配置</h1>
      <p className="lede">
        {sameOrigin
          ? "当前为同源部署：页面所在 nginx 已将 /v1 反代到 AuraClaw，AuraClaw URL 必须留空。"
          : "本机 Vite 开发留空会代理到 127.0.0.1:8080；其他主机填写 AuraClaw 地址。"}
      </p>
      <div className="card stack">
        <strong>连接</strong>
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
          onClick={() => onSaveBaseUrl(sameOrigin ? "" : draft.trim())}
        >
          {sameOrigin ? "确认同源 uplink" : "保存"}
        </button>
      </div>
      <div className="card stack">
        <strong>测试身份</strong>
        <p className="helper">
          用于测试环境请求，由 AuraX 注入 AuraClaw 身份 Header。请填写 ChainTower
          可识别的身份；保存后新请求立即生效。
        </p>
        <label>
          租户 ID
          <input
            required
            value={identityDraft.tenantId}
            placeholder="例如 platform"
            onChange={(event) =>
              setIdentityDraft((current) => ({ ...current, tenantId: event.target.value }))
            }
          />
        </label>
        <label>
          部门 ID
          <input
            required
            value={identityDraft.deptId}
            placeholder="ChainTower 可识别的部门 ID"
            onChange={(event) =>
              setIdentityDraft((current) => ({ ...current, deptId: event.target.value }))
            }
          />
        </label>
        <label>
          用户 ID
          <input
            required
            value={identityDraft.userId}
            placeholder="ChainTower 可识别的用户 ID"
            onChange={(event) =>
              setIdentityDraft((current) => ({ ...current, userId: event.target.value }))
            }
          />
        </label>
        <button
          className="btn"
          type="button"
          disabled={!identityComplete}
          onClick={() => onSaveIdentity(identityDraft)}
        >
          保存测试身份
        </button>
        <p className="mono">
          X-Tenant-ID: {identity.tenantId}
          <br />
          X-Dept-ID: {identity.deptId}
          <br />
          X-Actor-ID: {identity.userId}
        </p>
      </div>
    </section>
  );
}
