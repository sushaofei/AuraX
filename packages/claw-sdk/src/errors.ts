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

export function newIdempotencyKey(prefix: string): string {
  const entropy = crypto.randomUUID();
  return `${prefix}:${entropy}`;
}
