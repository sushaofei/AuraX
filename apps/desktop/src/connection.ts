const KEY = "aurax.claw.baseUrl";

/** DEV_WEB / compose image: nginx on the page origin proxies /v1 to AuraClaw. */
export function isSameOriginUplink(): boolean {
  return import.meta.env.VITE_AURAX_UPLINK === "same-origin";
}

export function defaultBaseUrl(): string {
  if (import.meta.env.DEV) {
    return "";
  }
  if (isSameOriginUplink()) {
    return "";
  }
  return "http://127.0.0.1:8080";
}

export function loadBaseUrl(): string {
  // Cross-origin baseUrl breaks browser fetch (CORS). Same-origin builds always uplink via nginx.
  if (isSameOriginUplink()) {
    return "";
  }
  const stored = window.localStorage.getItem(KEY);
  return stored ?? defaultBaseUrl();
}

export function saveBaseUrl(url: string): void {
  if (isSameOriginUplink()) {
    window.localStorage.removeItem(KEY);
    return;
  }
  window.localStorage.setItem(KEY, url.replace(/\/+$/, ""));
}
