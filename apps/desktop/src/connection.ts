const KEY = "aurax.claw.baseUrl";

export function defaultBaseUrl(): string {
  return import.meta.env.DEV ? "" : "http://127.0.0.1:8080";
}

export function loadBaseUrl(): string {
  const stored = window.localStorage.getItem(KEY);
  return stored ?? defaultBaseUrl();
}

export function saveBaseUrl(url: string): void {
  window.localStorage.setItem(KEY, url.replace(/\/+$/, ""));
}
