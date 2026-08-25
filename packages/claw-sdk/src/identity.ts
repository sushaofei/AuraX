/** v1 mock identity. Do not expose a UI switcher. */
export const MOCK_IDENTITY = {
  tenantId: "platform",
  deptId: "local-org",
  userId: "local-user",
} as const;

export type MockIdentity = typeof MOCK_IDENTITY;

export function identityHeaders(
  identity: MockIdentity = MOCK_IDENTITY,
): Record<string, string> {
  return {
    "X-Tenant-ID": identity.tenantId,
    "X-Dept-ID": identity.deptId,
    "X-Actor-ID": identity.userId,
  };
}
