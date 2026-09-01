export class ClawApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string | null;

  constructor(status: number, code: string, message: string, detail: string | null = null) {
    super(message);
    this.name = "ClawApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export type ClawApiErrorFormatOptions = {
  redactedForbiddenMessage?: string;
};

export function formatClawApiError(
  error: ClawApiError,
  options: ClawApiErrorFormatOptions = {},
): string {
  if (
    error.status === 403 &&
    error.code === "http_error" &&
    options.redactedForbiddenMessage
  ) {
    return `HTTP 403 · ${options.redactedForbiddenMessage}`;
  }
  const detail = error.detail ? ` · ${error.detail}` : "";
  return `HTTP ${error.status} · ${error.code}: ${error.message}${detail}`;
}

function randomUuid(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // HTTP (non-secure) origins like http://10.x.x.x lack randomUUID; getRandomValues still works.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function newIdempotencyKey(prefix: string): string {
  const entropy = randomUuid();
  return `${prefix}:${entropy}`;
}
