const LAST_SESSION_KEY = "aurax.ui.lastSessionId";
const DRAFT_KEY = "aurax.ui.composerDraft";
const LAST_EVENT_PREFIX = "aurax.ui.lastEventId.";
const TRACE_OPEN_KEY = "aurax.ui.executionTraceOpen";
const TRACE_FILTER_KEY = "aurax.ui.executionTraceFilter";

export type TraceFilter = "all" | "model" | "capability" | "state";

export function loadLastSessionId(): string | null {
  return window.localStorage.getItem(LAST_SESSION_KEY);
}

export function saveLastSessionId(sessionId: string | null): void {
  if (sessionId) {
    window.localStorage.setItem(LAST_SESSION_KEY, sessionId);
    return;
  }
  window.localStorage.removeItem(LAST_SESSION_KEY);
}

export function loadDraft(): string {
  return window.localStorage.getItem(DRAFT_KEY) ?? "";
}

export function saveDraft(draft: string): void {
  if (draft) {
    window.localStorage.setItem(DRAFT_KEY, draft);
    return;
  }
  window.localStorage.removeItem(DRAFT_KEY);
}

export function loadLastEventId(sessionId: string): string | undefined {
  return window.localStorage.getItem(`${LAST_EVENT_PREFIX}${sessionId}`) ?? undefined;
}

export function saveLastEventId(sessionId: string, eventId: string): void {
  window.localStorage.setItem(`${LAST_EVENT_PREFIX}${sessionId}`, eventId);
}

export function loadTraceOpen(): boolean {
  return window.localStorage.getItem(TRACE_OPEN_KEY) === "true";
}

export function saveTraceOpen(open: boolean): void {
  window.localStorage.setItem(TRACE_OPEN_KEY, String(open));
}

export function loadTraceFilter(): TraceFilter {
  const value = window.localStorage.getItem(TRACE_FILTER_KEY);
  return value === "model" || value === "capability" || value === "state"
    ? value
    : "all";
}

export function saveTraceFilter(filter: TraceFilter): void {
  window.localStorage.setItem(TRACE_FILTER_KEY, filter);
}
