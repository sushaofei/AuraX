import type { ClawClient } from "./client.js";
import type { MockIdentity } from "./identity.js";

/** Public identity metadata from the optional, SSH-only development uplink. */
export async function getManagedWebIdentity(client: ClawClient): Promise<MockIdentity> {
  const { body } = await client.request<{ identity?: unknown }>("GET", "/aurax/environment");
  const value = body?.identity;
  if (typeof value !== "object" || value === null) {
    throw new Error("工作台身份配置不可用");
  }
  const identity = value as Record<string, unknown>;
  if (!["tenantId", "deptId", "userId"].every(
    (key) => typeof identity[key] === "string" && identity[key].trim().length > 0,
  )) {
    throw new Error("工作台身份配置不完整");
  }
  return {
    tenantId: String(identity.tenantId).trim(),
    deptId: String(identity.deptId).trim(),
    userId: String(identity.userId).trim(),
  };
}
