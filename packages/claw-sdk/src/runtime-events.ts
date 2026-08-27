import type { ModelOutputDeltaState, RuntimeEvent } from "./types.js";

export function parseRuntimeEvent(data: string): RuntimeEvent | null {
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    const eventId = parsed.event_id;
    const sessionId = parsed.session_id;
    const sequence = parsed.sequence;
    const type = parsed.type;
    if (
      typeof eventId !== "string" ||
      typeof sessionId !== "string" ||
      typeof sequence !== "number" ||
      typeof type !== "string"
    ) {
      return null;
    }
    const payload =
      typeof parsed.payload === "object" && parsed.payload !== null
        ? (parsed.payload as Record<string, unknown>)
        : {};
    const event: RuntimeEvent = {
      event_id: eventId,
      session_id: sessionId,
      sequence,
      type,
      payload,
    };
    if (typeof parsed.run_id === "string") {
      event.run_id = parsed.run_id;
    }
    if (typeof parsed.visibility === "string") {
      event.visibility = parsed.visibility;
    }
    return event;
  } catch {
    return null;
  }
}

export function createModelOutputDeltaState(): ModelOutputDeltaState {
  return { seenEventIds: new Set(), text: "", runId: null };
}

/** Merge model.output.delta by event_id dedup; reset when run_id changes. */
export function mergeModelOutputDelta(
  state: ModelOutputDeltaState,
  event: RuntimeEvent,
): ModelOutputDeltaState {
  if (event.type !== "model.output.delta") {
    return state;
  }
  if (state.seenEventIds.has(event.event_id)) {
    return state;
  }
  const delta = event.payload.delta;
  if (typeof delta !== "string") {
    return state;
  }
  const runChanged =
    event.run_id !== undefined && state.runId !== null && event.run_id !== state.runId;
  const next: ModelOutputDeltaState = runChanged
    ? { seenEventIds: new Set(), text: "", runId: event.run_id ?? null }
    : { seenEventIds: new Set(state.seenEventIds), text: state.text, runId: state.runId };
  next.seenEventIds.add(event.event_id);
  if (event.run_id !== undefined) {
    next.runId = event.run_id;
  }
  next.text += delta;
  return next;
}
