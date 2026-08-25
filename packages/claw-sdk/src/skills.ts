import type { ClawClient } from "./client.js";
import { newIdempotencyKey } from "./errors.js";
import type { SkillSummary } from "./types.js";

export function listSkills(client: ClawClient) {
  return client.request<{ skills: SkillSummary[] }>("GET", "/v1/admin/skills");
}

export function getSkill(client: ClawClient, publisher: string, name: string) {
  return client.request<SkillSummary>("GET", `/v1/admin/skills/${publisher}/${name}`);
}

export function toggleSkill(
  client: ClawClient,
  publisher: string,
  name: string,
  action: "enable" | "disable",
  idempotencyKey = newIdempotencyKey(`skill-${action}`),
) {
  return client.request<{ skills: SkillSummary[] }>(
    "POST",
    `/v1/admin/skills/${publisher}/${name}:${action}`,
    { idempotencyKey },
  );
}
