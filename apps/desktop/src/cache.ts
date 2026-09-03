const LAST_CHAT_SESSION_KEY = "aurax.ui.lastChatSessionId";
const LAST_TASK_SESSION_KEY = "aurax.ui.lastTaskSessionId";
const CHAT_DRAFT_KEY = "aurax.ui.chatDraft";
const CHAT_DRAFT_PREFIX = "aurax.ui.chatDraft.";
const TASK_DRAFT_KEY = "aurax.ui.taskDraft";
const TASK_DRAFT_PREFIX = "aurax.ui.taskDraft.";
const LAST_EVENT_PREFIX = "aurax.ui.lastEventId.";
const TRACE_OPEN_KEY = "aurax.ui.executionTraceOpen";
const CHAT_TRACE_OPEN_KEY = "aurax.ui.chatExecutionTraceOpen";
const TASK_TRACE_OPEN_KEY = "aurax.ui.taskExecutionTraceOpen";
const TRACE_FILTER_KEY = "aurax.ui.executionTraceFilter";
const TRACE_WIDTH_KEY = "aurax.ui.executionTraceWidth";
const SESSION_ORIGIN_PREFIX = "aurax.ui.sessionOrigin.";
const STREAMING_PREFIX = "aurax.ui.streaming.";

export type StreamingBuffer = {
  text: string;
  runId: string | null;
  seenEventIds: string[];
};

export type TraceFilter = "all" | "model" | "capability" | "state";
export type SessionOrigin = "chat" | "task";

export const DEFAULT_TRACE_WIDTH = 360;
export const MIN_TRACE_WIDTH = 300;
export const MAX_TRACE_WIDTH = 640;

export function loadLastChatSessionId(): string | null {
  const value = window.localStorage.getItem(LAST_CHAT_SESSION_KEY);
  if (value) {
    return value;
  }
  // Migrate legacy single-session key
  return window.localStorage.getItem("aurax.ui.lastSessionId");
}

export function saveLastChatSessionId(sessionId: string | null): void {
  if (sessionId) {
    window.localStorage.setItem(LAST_CHAT_SESSION_KEY, sessionId);
    return;
  }
  window.localStorage.removeItem(LAST_CHAT_SESSION_KEY);
}

export function loadLastTaskSessionId(): string | null {
  return window.localStorage.getItem(LAST_TASK_SESSION_KEY);
}

export function saveLastTaskSessionId(sessionId: string | null): void {
  if (sessionId) {
    window.localStorage.setItem(LAST_TASK_SESSION_KEY, sessionId);
    return;
  }
  window.localStorage.removeItem(LAST_TASK_SESSION_KEY);
}

function draftStorageKey(prefix: string, legacyKey: string, sessionId: string | null): string {
  return sessionId ? `${prefix}${sessionId}` : legacyKey;
}

export function loadChatDraft(sessionId: string | null = null): string {
  const scoped = window.localStorage.getItem(draftStorageKey(CHAT_DRAFT_PREFIX, CHAT_DRAFT_KEY, sessionId));
  if (scoped !== null) {
    return scoped;
  }
  if (sessionId) {
    return "";
  }
  return window.localStorage.getItem(CHAT_DRAFT_KEY) ?? "";
}

export function saveChatDraft(draft: string, sessionId: string | null = null): void {
  const key = draftStorageKey(CHAT_DRAFT_PREFIX, CHAT_DRAFT_KEY, sessionId);
  if (draft) {
    window.localStorage.setItem(key, draft);
    return;
  }
  window.localStorage.removeItem(key);
}

export function loadTaskDraft(sessionId: string | null = null): string {
  const scoped = window.localStorage.getItem(draftStorageKey(TASK_DRAFT_PREFIX, TASK_DRAFT_KEY, sessionId));
  if (scoped !== null) {
    return scoped;
  }
  if (sessionId) {
    const legacy = window.localStorage.getItem(TASK_DRAFT_KEY);
    if (legacy) {
      return legacy;
    }
    return window.localStorage.getItem("aurax.ui.composerDraft") ?? "";
  }
  const value = window.localStorage.getItem(TASK_DRAFT_KEY);
  if (value) {
    return value;
  }
  return window.localStorage.getItem("aurax.ui.composerDraft") ?? "";
}

export function saveTaskDraft(draft: string, sessionId: string | null = null): void {
  const key = draftStorageKey(TASK_DRAFT_PREFIX, TASK_DRAFT_KEY, sessionId);
  if (draft) {
    window.localStorage.setItem(key, draft);
    return;
  }
  window.localStorage.removeItem(key);
}

export function loadLastEventId(sessionId: string): string | undefined {
  return window.localStorage.getItem(`${LAST_EVENT_PREFIX}${sessionId}`) ?? undefined;
}

export function saveLastEventId(sessionId: string, eventId: string): void {
  window.localStorage.setItem(`${LAST_EVENT_PREFIX}${sessionId}`, eventId);
}

export function loadTraceOpen(view: "chat" | "task" = "task"): boolean {
  const key = view === "chat" ? CHAT_TRACE_OPEN_KEY : TASK_TRACE_OPEN_KEY;
  const value = window.localStorage.getItem(key);
  if (value !== null) {
    return value === "true";
  }
  const legacy = window.localStorage.getItem(TRACE_OPEN_KEY);
  if (legacy !== null) {
    return legacy === "true";
  }
  return true;
}

export function saveTraceOpen(open: boolean, view: "chat" | "task" = "task"): void {
  const key = view === "chat" ? CHAT_TRACE_OPEN_KEY : TASK_TRACE_OPEN_KEY;
  window.localStorage.setItem(key, String(open));
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

export function clampTraceWidth(width: number): number {
  return Math.min(MAX_TRACE_WIDTH, Math.max(MIN_TRACE_WIDTH, Math.round(width)));
}

export function loadTraceWidth(): number {
  const width = Number(window.localStorage.getItem(TRACE_WIDTH_KEY));
  // Migrate the original auto-saved default to the denser workspace ratio.
  if (width === 380) {
    return DEFAULT_TRACE_WIDTH;
  }
  return Number.isFinite(width) && width > 0
    ? clampTraceWidth(width)
    : DEFAULT_TRACE_WIDTH;
}

export function saveTraceWidth(width: number): void {
  window.localStorage.setItem(TRACE_WIDTH_KEY, String(clampTraceWidth(width)));
}

export function saveSessionOrigin(sessionId: string, origin: SessionOrigin): void {
  window.localStorage.setItem(`${SESSION_ORIGIN_PREFIX}${sessionId}`, origin);
}

export function getSessionOrigin(sessionId: string): SessionOrigin | null {
  const value = window.localStorage.getItem(`${SESSION_ORIGIN_PREFIX}${sessionId}`);
  return value === "chat" || value === "task" ? value : null;
}

export function saveStreamingBuffer(sessionId: string, buffer: StreamingBuffer): void {
  if (!buffer.text) {
    window.localStorage.removeItem(`${STREAMING_PREFIX}${sessionId}`);
    return;
  }
  window.localStorage.setItem(`${STREAMING_PREFIX}${sessionId}`, JSON.stringify(buffer));
}

export function loadStreamingBuffer(sessionId: string): StreamingBuffer | null {
  const raw = window.localStorage.getItem(`${STREAMING_PREFIX}${sessionId}`);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as StreamingBuffer;
    if (typeof parsed.text !== "string" || !Array.isArray(parsed.seenEventIds)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearStreamingBuffer(sessionId: string): void {
  window.localStorage.removeItem(`${STREAMING_PREFIX}${sessionId}`);
}
