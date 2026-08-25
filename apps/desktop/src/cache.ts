const LAST_SESSION_KEY = "aurax.ui.lastSessionId";
const DRAFT_KEY = "aurax.ui.composerDraft";
const LAST_EVENT_PREFIX = "aurax.ui.lastEventId.";

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
