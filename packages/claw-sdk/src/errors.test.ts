import { describe, expect, it } from "vitest";
import { ClawApiError, formatClawApiError, newIdempotencyKey } from "./errors.js";

describe("newIdempotencyKey", () => {
  it("uses a UUID-shaped suffix when randomUUID is unavailable", () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      const key = newIdempotencyKey("task");
      expect(key).toMatch(
        /^task:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    } finally {
      Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true });
    }
  });
});

describe("formatClawApiError", () => {
  it("preserves the HTTP status and structured policy error", () => {
    expect(
      formatClawApiError(
        new ClawApiError(403, "policy_denied", "Skill package signature is invalid"),
      ),
    ).toBe("HTTP 403 · policy_denied: Skill package signature is invalid");
  });

  it("replaces an opaque forbidden body with safe operation guidance", () => {
    expect(
      formatClawApiError(
        new ClawApiError(403, "http_error", "Sorry, Page Not Found"),
        { redactedForbiddenMessage: "Skill 发布被策略拒绝；请在 Admissions 查看拒绝阶段和错误码。" },
      ),
    ).toBe("HTTP 403 · Skill 发布被策略拒绝；请在 Admissions 查看拒绝阶段和错误码。");
  });

  it("does not confuse a real not-found response with a forbidden response", () => {
    expect(
      formatClawApiError(new ClawApiError(404, "not_found", "Skill not found")),
    ).toBe("HTTP 404 · not_found: Skill not found");
  });
});
