import { describe, expect, it } from "vitest";
import { ClawClient } from "./client.js";
import {
  changeSkillInstallation,
  listSkillAdmissions,
  listSkillCatalog,
  normalizeSkillPackageFiles,
  publishSkillFilesStaged,
  revokeSkillPublisherKey,
  saveSkillSource,
} from "./skills.js";
import type { SkillPublisherView } from "./types.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Skill Admin SDK", () => {
  it("normalizes a selected Skill directory to package-root paths", () => {
    expect(
      normalizeSkillPackageFiles([
        ["price-insight-deviation/manifest.json", "manifest"],
        ["price-insight-deviation/SKILL.md", "skill"],
        ["price-insight-deviation/references/tools.md", "tools"],
      ]),
    ).toEqual({
      "manifest.json": "manifest",
      "SKILL.md": "skill",
      "references/tools.md": "tools",
    });
  });

  it("preserves package-root paths supplied without a directory prefix", () => {
    expect(
      normalizeSkillPackageFiles([
        ["manifest.json", "manifest"],
        ["SKILL.md", "skill"],
        ["references/tools.md", "tools"],
      ]),
    ).toEqual({
      "manifest.json": "manifest",
      "SKILL.md": "skill",
      "references/tools.md": "tools",
    });
  });

  it.each([
    {
      name: "path traversal",
      entries: [
        ["skill/manifest.json", "manifest"],
        ["skill/SKILL.md", "skill"],
        ["skill/../secret", "secret"],
      ] as const,
      message: "Skill 包包含非法路径",
    },
    {
      name: "duplicates after normalization",
      entries: [
        ["skill/manifest.json", "first"],
        ["skill/manifest.json", "second"],
        ["skill/SKILL.md", "skill"],
      ] as const,
      message: "Skill 包包含重复路径：manifest.json",
    },
    {
      name: "missing root manifest",
      entries: [["skill/SKILL.md", "skill"]] as const,
      message: "Skill 包根目录缺少 manifest.json",
    },
  ])("rejects $name", ({ entries, message }) => {
    expect(() => normalizeSkillPackageFiles(entries)).toThrow(message);
  });

  it("prefers the aggregate catalog items while preserving legacy responses", async () => {
    const client = new ClawClient({
      baseUrl: "http://claw.example",
      fetch: (async () =>
        jsonResponse({
          skills: [{ publisher: "platform", name: "legacy" }],
          items: [{ publisher: "platform", name: "managed", availability: "available" }],
          next_cursor: null,
        })) as typeof fetch,
    });
    const response = await listSkillCatalog(client, { q: "managed" });
    expect(response.body.items?.[0]?.name).toBe("managed");
  });

  it("sends installation revision and reason without confusing publication state", async () => {
    let headers: Record<string, string> = {};
    let url = "";
    const client = new ClawClient({
      baseUrl: "http://claw.example",
      fetch: (async (input, init) => {
        url = String(input);
        headers = init?.headers as Record<string, string>;
        return jsonResponse({ installation: { status: "disabled", revision: 8 } }, 202);
      }) as typeof fetch,
    });
    await changeSkillInstallation(
      client,
      { publisher: "platform", name: "release.prepare" },
      "disable",
      7,
      { reasonCode: "operator_disabled" },
    );
    expect(url).toBe(
      "http://claw.example/v1/admin/skills/platform/release.prepare:disable",
    );
    expect(headers["X-Expected-Revision"]).toBe("7");
    expect(headers["X-Reason-Code"]).toBe("operator_disabled");
    expect(headers["Idempotency-Key"]).toContain("skill-disable:");
  });

  it("uses PATCH and expected revision for an existing Source", async () => {
    let method = "";
    let expectedRevision = "";
    const client = new ClawClient({
      baseUrl: "http://claw.example",
      fetch: (async (_input, init) => {
        method = init?.method ?? "";
        expectedRevision = (init?.headers as Record<string, string>)["X-Expected-Revision"] ?? "";
        return jsonResponse({ source: { source_id: "sks_mcp", revision: 3 } });
      }) as typeof fetch,
    });
    await saveSkillSource(
      client,
      {
        source_id: "sks_mcp",
        kind: "mcp",
        desired_state: "enabled",
        publisher_allowlist: ["acme"],
        credential_ref: "vault/acme#token",
        config_metadata: {},
        priority: 10,
      },
      {
        source_id: "sks_mcp",
        tenant_id: "local",
        kind: "mcp",
        desired_state: "enabled",
        publisher_allowlist: ["acme"],
        credential_ref: "vault/acme#token",
        config_metadata: {},
        priority: 0,
        revision: 2,
        created_by: "user",
        updated_by: "user",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    );
    expect(method).toBe("PATCH");
    expect(expectedRevision).toBe("2");
  });

  it("uploads a canonical staged archive before artifact publication", async () => {
    const calls: string[] = [];
    let uploadHeaders: Record<string, string> = {};
    const client = new ClawClient({
      baseUrl: "http://claw.example",
      fetch: (async (input, init) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/skill-package-uploads")) {
          uploadHeaders = init?.headers as Record<string, string>;
          expect(init?.body).toBeInstanceOf(Uint8Array);
          return jsonResponse({
            artifact_ref: { artifact_id: "art_1", version: 1 },
            status: "ready",
          }, 201);
        }
        return jsonResponse({ publisher: "platform", name: "release.prepare", version: "1.0.0" }, 201);
      }) as typeof fetch,
    });
    await publishSkillFilesStaged(client, "sks_upload", {
      "SKILL.md": btoa("# Release"),
      "manifest.json": btoa("{}"),
    });
    expect(calls).toEqual([
      "http://claw.example/v1/admin/skill-package-uploads",
      "http://claw.example/v1/admin/skill-publications",
    ]);
    expect(uploadHeaders["Content-Type"]).toBe(
      "application/vnd.auraclaw.skill-package+json",
    );
    expect(uploadHeaders["X-Content-SHA256"]).toMatch(/^[0-9a-f]{64}$/);
    expect(uploadHeaders["X-Tenant-ID"]).toBe("platform");
  });

  it("uses the key revision and governance headers when revoking a publisher key", async () => {
    let url = "";
    let headers: Record<string, string> = {};
    const client = new ClawClient({
      baseUrl: "http://claw.example",
      fetch: (async (input, init) => {
        url = String(input);
        headers = init?.headers as Record<string, string>;
        return jsonResponse({ publisher: { publisher: "acme" }, keys: [] }, 202);
      }) as typeof fetch,
    });
    const view = {
      publisher: { publisher: "acme", revision: 9 },
      keys: [{ key_id: "release-2026", revision: 4, status: "active" }],
    } as SkillPublisherView;
    await revokeSkillPublisherKey(
      client,
      view,
      view.keys[0]!,
      "publisher_key_compromised",
      "pause",
    );
    expect(url).toBe(
      "http://claw.example/v1/admin/skill-publishers/acme/keys/release-2026:revoke",
    );
    expect(headers["X-Expected-Revision"]).toBe("4");
    expect(headers["X-Reason-Code"]).toBe("publisher_key_compromised");
    expect(headers["X-Revocation-Action"]).toBe("pause");
  });

  it("forwards admission filters and an opaque cursor", async () => {
    let url = "";
    const client = new ClawClient({
      baseUrl: "http://claw.example",
      fetch: (async (input) => {
        url = String(input);
        return jsonResponse({ admissions: [], next_cursor: null });
      }) as typeof fetch,
    });
    await listSkillAdmissions(client, {
      outcome: "quarantined",
      cursor: "opaque+cursor",
      limit: 25,
    });
    expect(url).toContain("outcome=quarantined");
    expect(url).toContain("cursor=opaque%2Bcursor");
    expect(url).toContain("limit=25");
  });
});
