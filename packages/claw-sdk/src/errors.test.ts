import { describe, expect, it } from "vitest";
import { newIdempotencyKey } from "./errors.js";

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
