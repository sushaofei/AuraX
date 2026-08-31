import { ClawApiError } from "./errors.js";
import { identityHeaders, MOCK_IDENTITY, type MockIdentity } from "./identity.js";

export type ClawClientOptions = {
  baseUrl: string;
  identity?: MockIdentity;
  fetch?: typeof fetch;
};

export class ClawClient {
  readonly baseUrl: string;
  readonly identity: MockIdentity;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ClawClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.identity = options.identity ?? MOCK_IDENTITY;
    // Native Window.fetch throws "Illegal invocation" if called as a method on
    // another object. Keep an injected mock as-is; bind the platform fetch.
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  resolveUrl(path: string): URL {
    const origin =
      this.baseUrl ||
      (typeof globalThis.location?.origin === "string"
        ? globalThis.location.origin
        : "http://127.0.0.1:8080");
    return new URL(path, origin.endsWith("/") ? origin : `${origin}/`);
  }

  async request<T>(
    method: string,
    path: string,
    options: {
      json?: unknown;
      query?: Record<string, string | number | undefined>;
      idempotencyKey?: string;
      expectedVersion?: number;
      expectedRevision?: number;
      accept?: string;
      headers?: Record<string, string>;
    } = {},
  ): Promise<{ status: number; body: T; headers: Headers }> {
    const url = this.resolveUrl(path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
    const headers: Record<string, string> = {
      Accept: options.accept ?? "application/json",
      ...identityHeaders(this.identity),
    };
    if (options.json !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (options.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey;
    }
    if (options.expectedVersion !== undefined) {
      headers["X-Expected-Version"] = String(options.expectedVersion);
    }
    if (options.expectedRevision !== undefined) {
      headers["X-Expected-Revision"] = String(options.expectedRevision);
    }
    if (options.headers) {
      Object.assign(headers, options.headers);
    }
    const init: RequestInit = { method, headers };
    if (options.json !== undefined) {
      init.body = JSON.stringify(options.json);
    }
    const response = await this.fetchImpl(url, init);
    const raw = await response.text();
    let parsed: unknown = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        parsed = { message: raw };
      }
    }
    if (!response.ok) {
      const errorBody = (parsed ?? {}) as {
        code?: string;
        message?: string;
        detail?: string | null;
      };
      throw new ClawApiError(
        response.status,
        errorBody.code ?? "http_error",
        errorBody.message ?? `AuraClaw request failed (${response.status})`,
        errorBody.detail ?? null,
      );
    }
    return { status: response.status, body: parsed as T, headers: response.headers };
  }

  async stream(
    path: string,
    options: { lastEventId?: string; signal?: AbortSignal } = {},
  ): Promise<ReadableStream<Uint8Array>> {
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      ...identityHeaders(this.identity),
    };
    if (options.lastEventId) {
      headers["Last-Event-ID"] = options.lastEventId;
    }
    const init: RequestInit = { method: "GET", headers };
    if (options.signal) {
      init.signal = options.signal;
    }
    const response = await this.fetchImpl(this.resolveUrl(path), init);
    if (!response.ok || response.body === null) {
      throw new ClawApiError(
        response.status,
        "stream_unavailable",
        `SSE stream failed (${response.status})`,
      );
    }
    return response.body;
  }

  async uploadObject(
    url: string,
    body: BodyInit,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    const response = await this.fetchImpl(url, { method: "PUT", body, headers });
    if (!response.ok) {
      throw new ClawApiError(
        response.status,
        "artifact_upload_failed",
        `Artifact upload failed (${response.status})`,
      );
    }
    return response;
  }
}
