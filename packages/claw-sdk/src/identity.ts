export type MockIdentity = {
  tenantId: string;
  deptId: string;
  userId: string;
};

/** Default development identity used until AuraX supplies test configuration. */
export const MOCK_IDENTITY = {
  tenantId: "platform",
  deptId: "local-org",
  userId: "local-user",
} as const satisfies MockIdentity;

export function identityHeaders(
  identity: MockIdentity = MOCK_IDENTITY,
): Record<string, string> {
  return {
    "X-Tenant-ID": identity.tenantId,
    "X-Dept-ID": identity.deptId,
    "X-Actor-ID": identity.userId,
  };
}
