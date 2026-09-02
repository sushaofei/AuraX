import { MOCK_IDENTITY, type MockIdentity } from "@aurax/claw-sdk";

const KEY = "aurax.claw.baseUrl";
const TEST_IDENTITY_KEY = "aurax.claw.testIdentity";

/** DEV_WEB / compose image: nginx on the page origin proxies /v1 to AuraClaw. */
export function isSameOriginUplink(): boolean {
  return import.meta.env.VITE_AURAX_UPLINK === "same-origin";
}

export function defaultBaseUrl(): string {
  if (import.meta.env.DEV) {
    return "";
  }
  if (isSameOriginUplink()) {
    return "";
  }
  return "http://127.0.0.1:8080";
}

export function loadBaseUrl(): string {
  // Cross-origin baseUrl breaks browser fetch (CORS). Same-origin builds always uplink via nginx.
  if (isSameOriginUplink()) {
    return "";
  }
  const stored = window.localStorage.getItem(KEY);
  return stored ?? defaultBaseUrl();
}

export function saveBaseUrl(url: string): void {
  if (isSameOriginUplink()) {
    window.localStorage.removeItem(KEY);
    return;
  }
  window.localStorage.setItem(KEY, url.replace(/\/+$/, ""));
}

function isTestIdentity(value: unknown): value is MockIdentity {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return ["tenantId", "deptId", "userId"].every(
    (key) => typeof candidate[key] === "string" && candidate[key].trim().length > 0,
  );
}

export function loadTestIdentity(): MockIdentity {
  const stored = window.localStorage.getItem(TEST_IDENTITY_KEY);
  if (!stored) {
    return { ...MOCK_IDENTITY };
  }
  try {
    const parsed: unknown = JSON.parse(stored);
    if (isTestIdentity(parsed)) {
      return {
        tenantId: parsed.tenantId.trim(),
        deptId: parsed.deptId.trim(),
        userId: parsed.userId.trim(),
      };
    }
  } catch {
    // Invalid local test configuration is disposable; fall back to safe defaults.
  }
  window.localStorage.removeItem(TEST_IDENTITY_KEY);
  return { ...MOCK_IDENTITY };
}

export function saveTestIdentity(identity: MockIdentity): void {
  const normalized: MockIdentity = {
    tenantId: identity.tenantId.trim(),
    deptId: identity.deptId.trim(),
    userId: identity.userId.trim(),
  };
  if (!isTestIdentity(normalized)) {
    throw new Error("租户 ID、部门 ID 和用户 ID 均为必填项");
  }
  window.localStorage.setItem(TEST_IDENTITY_KEY, JSON.stringify(normalized));
}
