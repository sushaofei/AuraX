import { describe, expect, it } from "vitest";
import { ClawClient } from "./client.js";
import { getManagedWebIdentity } from "./web-environment.js";

function client(body: unknown): ClawClient {
  return new ClawClient({ baseUrl: "http://127.0.0.1:1420", fetch: (async (url) => {
    expect(String(url)).toBe("http://127.0.0.1:1420/aurax/environment");
    return new Response(JSON.stringify(body));
  }) as typeof fetch });
}

describe("managed web environment", () => {
  it("only returns public fixed identity fields", async () => {
    expect(await getManagedWebIdentity(client({ identity: {
      tenantId: " platform ", deptId: "local-org", userId: "local-user", ignored: "value",
    } }))).toEqual({ tenantId: "platform", deptId: "local-org", userId: "local-user" });
  });
  it.each([null, {}, { identity: null }, { identity: { tenantId: "platform" } }])(
    "rejects missing or partial identity without falling back to browser headers", async (value) => {
      await expect(getManagedWebIdentity(client(value))).rejects.toThrow("工作台身份配置");
    },
  );
});
