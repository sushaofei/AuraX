import type { ClawClient } from "./client.js";
import { newIdempotencyKey } from "./errors.js";
import type {
  SkillAdmissionMetrics,
  SkillAdmissionRecord,
  SkillCatalogItem,
  SkillCatalogPage,
  SkillInstallationRecord,
  SkillPackageRecord,
  SkillPublicationRecord,
  SkillPublisherView,
  SkillPublisherKeyRecord,
  SkillSummary,
} from "./types.js";

const segment = (value: string) => encodeURIComponent(value);
const reasonHeaders = (reasonCode: string) => ({ "X-Reason-Code": reasonCode });

export type SkillCatalogFilters = {
  q?: string;
  publisher?: string;
  risk_level?: string;
  publication_status?: string;
  installation_status?: string;
  cursor?: string;
  limit?: number;
};

export async function listSkillCatalog(client: ClawClient, filters: SkillCatalogFilters = {}) {
  const response = await client.request<SkillCatalogPage>("GET", "/v1/admin/skills", {
    query: filters,
  });
  const items = response.body.items ?? response.body.skills;
  return { ...response, body: { ...response.body, items } };
}

export function listSkills(client: ClawClient) {
  return listSkillCatalog(client);
}

export function getSkill(client: ClawClient, publisher: string, name: string) {
  return client.request<SkillSummary>(
    "GET",
    `/v1/admin/skills/${segment(publisher)}/${segment(name)}`,
  );
}

export type SkillManagementView = {
  publisher: string;
  name: string;
  installation: SkillInstallationRecord | null;
  versions: Array<{ publication: SkillPublicationRecord; package: SkillPackageRecord | null }>;
};

export function getSkillManagement(client: ClawClient, publisher: string, name: string) {
  return client.request<SkillManagementView>(
    "GET",
    `/v1/admin/skills/${segment(publisher)}/${segment(name)}/management`,
  );
}

export function changeSkillInstallation(
  client: ClawClient,
  skill: Pick<SkillCatalogItem, "publisher" | "name">,
  action: "install" | "enable" | "disable" | "uninstall",
  expectedRevision: number,
  options: { reasonCode?: string; force?: boolean } = {},
) {
  const requestOptions: {
    query?: Record<string, string | number | undefined>;
    idempotencyKey: string;
    expectedRevision: number;
    headers?: Record<string, string>;
  } = {
    idempotencyKey: newIdempotencyKey(`skill-${action}`),
    expectedRevision,
  };
  if (action === "uninstall" && options.force) requestOptions.query = { force: "true" };
  if (options.reasonCode) requestOptions.headers = reasonHeaders(options.reasonCode);
  return client.request<{ installation: SkillInstallationRecord }>(
    "POST",
    `/v1/admin/skills/${segment(skill.publisher)}/${segment(skill.name)}:${action}`,
    requestOptions,
  );
}

export function toggleSkill(
  client: ClawClient,
  publisher: string,
  name: string,
  action: "enable" | "disable",
  expectedRevision: number,
  reasonCode = action === "disable" ? "user_disabled" : undefined,
) {
  return changeSkillInstallation(
    client,
    { publisher, name },
    action,
    expectedRevision,
    reasonCode ? { reasonCode } : {},
  );
}

export function listSkillInstallations(client: ClawClient) {
  return client.request<{ installations: SkillInstallationRecord[]; next_cursor: string | null }>(
    "GET",
    "/v1/admin/skill-installations",
  );
}

export function listSkillPublications(client: ClawClient, publisher?: string, name?: string) {
  return client.request<{ publications: SkillPublicationRecord[]; next_cursor: string | null }>(
    "GET",
    "/v1/admin/skill-publications",
    { query: { publisher, name } },
  );
}

export function listSkillPackages(client: ClawClient, publisher?: string, name?: string) {
  return client.request<{ packages: SkillPackageRecord[]; next_cursor: string | null }>(
    "GET",
    "/v1/admin/skill-packages",
    { query: { publisher, name } },
  );
}

export function listSkillPublishers(client: ClawClient) {
  return client.request<{ publishers: SkillPublisherView[]; next_cursor: string | null }>(
    "GET",
    "/v1/admin/skill-publishers",
  );
}

export function registerSkillPublisher(client: ClawClient, publisher: string, displayName: string) {
  return client.request<SkillPublisherView>(
    "POST",
    `/v1/admin/skill-publishers/${segment(publisher)}`,
    {
      json: { display_name: displayName },
      idempotencyKey: newIdempotencyKey("skill-publisher-register"),
      expectedRevision: 0,
    },
  );
}

export function rotateSkillPublisherKey(
  client: ClawClient,
  view: SkillPublisherView,
  keyId: string,
  publicKey: string,
) {
  return client.request<SkillPublisherView>(
    "POST",
    `/v1/admin/skill-publishers/${segment(view.publisher.publisher)}/keys:rotate`,
    {
      json: { key_id: keyId, public_key: publicKey },
      idempotencyKey: newIdempotencyKey("skill-publisher-key-rotate"),
      expectedRevision: view.publisher.revision,
    },
  );
}

export function revokeSkillPublisherKey(
  client: ClawClient,
  view: SkillPublisherView,
  key: SkillPublisherKeyRecord,
  reasonCode: string,
  revocationAction: "pause" | "cancel" = "cancel",
) {
  return client.request<SkillPublisherView>(
    "POST",
    `/v1/admin/skill-publishers/${segment(view.publisher.publisher)}/keys/${segment(key.key_id)}:revoke`,
    {
      idempotencyKey: newIdempotencyKey("skill-publisher-key-revoke"),
      expectedRevision: key.revision,
      headers: {
        ...reasonHeaders(reasonCode),
        "X-Revocation-Action": revocationAction,
      },
    },
  );
}

export function changeSkillPublisherStatus(
  client: ClawClient,
  view: SkillPublisherView,
  action: "suspend" | "resume" | "revoke",
  reasonCode: string,
  revocationAction: "pause" | "cancel" = "cancel",
) {
  return client.request<SkillPublisherView>(
    "POST",
    `/v1/admin/skill-publishers/${segment(view.publisher.publisher)}/status:${action}`,
    {
      idempotencyKey: newIdempotencyKey(`skill-publisher-${action}`),
      expectedRevision: view.publisher.revision,
      headers: {
        ...reasonHeaders(reasonCode),
        ...(action === "revoke" ? { "X-Revocation-Action": revocationAction } : {}),
      },
    },
  );
}

export function publishSkillFiles(
  client: ClawClient,
  files: Record<string, string>,
) {
  return client.request<SkillCatalogItem>("POST", "/v1/admin/skill-publications", {
    json: { activate: true, files },
    idempotencyKey: newIdempotencyKey("skill-publish"),
    expectedRevision: 0,
  });
}

export function normalizeSkillPackageFiles<T>(
  entries: ReadonlyArray<readonly [path: string, value: T]>,
): Record<string, T> {
  if (entries.length === 0) throw new Error("Skill 包目录为空");

  const parsed = entries.map(([path, value]) => {
    const normalized = path.replaceAll("\\", "/");
    if (
      normalized.length === 0 ||
      normalized.startsWith("/") ||
      /^[A-Za-z]:\//.test(normalized)
    ) {
      throw new Error(`Skill 包包含非法路径：${path}`);
    }
    const segments = normalized.split("/");
    if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
      throw new Error(`Skill 包包含非法路径：${path}`);
    }
    return { segments, value };
  });

  const firstRoot = parsed[0]!.segments[0]!;
  const hasDirectoryPrefix = parsed.every(
    ({ segments }) => segments.length > 1 && segments[0] === firstRoot,
  );
  const files: Record<string, T> = {};
  for (const { segments, value } of parsed) {
    const packagePath = (hasDirectoryPrefix ? segments.slice(1) : segments).join("/");
    if (Object.hasOwn(files, packagePath)) {
      throw new Error(`Skill 包包含重复路径：${packagePath}`);
    }
    files[packagePath] = value;
  }
  for (const required of ["manifest.json", "SKILL.md"]) {
    if (!Object.hasOwn(files, required)) {
      throw new Error(`Skill 包根目录缺少 ${required}`);
    }
  }
  return files;
}

export async function publishSkillFilesStaged(
  client: ClawClient,
  files: Record<string, string>,
  name = "skill-package.json",
) {
  const sortedFiles = Object.fromEntries(
    Object.entries(files).sort(([left], [right]) => left.localeCompare(right)),
  );
  const archive = new TextEncoder().encode(JSON.stringify({ files: sortedFiles }));
  const checksum = await sha256Hex(archive);
  const staged = await client.upload<{
    artifact_ref: Record<string, unknown>;
    status: string;
  }>(
    "/v1/admin/skill-package-uploads",
    archive,
    {
      idempotencyKey: newIdempotencyKey("skill-upload-create"),
      headers: {
        "Content-Type": "application/vnd.auraclaw.skill-package+json",
        "X-Upload-Name": name,
        "X-Content-SHA256": checksum,
      },
    },
  );
  return client.request<SkillCatalogItem>("POST", "/v1/admin/skill-publications", {
    json: {
      activate: true,
      artifact_ref: staged.body.artifact_ref,
      expected_digest: `sha256:${checksum}`,
    },
    idempotencyKey: newIdempotencyKey("skill-publish-artifact"),
    expectedRevision: 0,
  });
}

export function revokeSkillPublication(
  client: ClawClient,
  publication: SkillPublicationRecord,
  reasonCode: string,
  revocationAction: "continue" | "pause" | "cancel",
) {
  return client.request<{ publication: SkillPublicationRecord }>(
    "POST",
    `/v1/admin/skill-publications/${segment(publication.publisher)}/${segment(publication.name)}/versions/${segment(publication.version)}:revoke`,
    {
      idempotencyKey: newIdempotencyKey("skill-publication-revoke"),
      expectedRevision: publication.revision,
      headers: {
        ...reasonHeaders(reasonCode),
        "X-Skill-Revocation-Action": revocationAction,
      },
    },
  );
}

export function restoreSkillPublication(
  client: ClawClient,
  publication: SkillPublicationRecord,
  reasonCode: string,
) {
  return client.request<{ publication: SkillPublicationRecord }>(
    "POST",
    `/v1/admin/skill-publications/${segment(publication.publisher)}/${segment(publication.name)}/versions/${segment(publication.version)}:restore`,
    {
      idempotencyKey: newIdempotencyKey("skill-publication-restore"),
      expectedRevision: publication.revision,
      headers: reasonHeaders(reasonCode),
    },
  );
}

export function purgeSkillPackage(
  client: ClawClient,
  skillPackage: SkillPackageRecord,
  reasonCode: string,
) {
  return client.request<{ package: SkillPackageRecord }>(
    "POST",
    `/v1/admin/skill-packages/${segment(skillPackage.publisher)}/${segment(skillPackage.name)}/versions/${segment(skillPackage.version)}:purge`,
    {
      idempotencyKey: newIdempotencyKey("skill-package-purge"),
      expectedRevision: skillPackage.retention_revision,
      headers: reasonHeaders(reasonCode),
    },
  );
}

export type SkillAdmissionFilters = {
  outcome?: string;
  stage?: string;
  content_policy_version?: string;
  since?: string;
  cursor?: string;
  limit?: number;
};

export function listSkillAdmissions(client: ClawClient, filters: SkillAdmissionFilters = {}) {
  return client.request<{ admissions: SkillAdmissionRecord[]; next_cursor: string | null }>(
    "GET",
    "/v1/admin/skill-admissions",
    { query: filters },
  );
}

export function getSkillAdmissionMetrics(client: ClawClient, windowHours = 24) {
  return client.request<SkillAdmissionMetrics>("GET", "/v1/admin/skill-admissions/metrics", {
    query: { window_hours: windowHours },
  });
}

async function sha256Hex(content: Uint8Array): Promise<string> {
  const copy = new Uint8Array(content.byteLength);
  copy.set(content);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
