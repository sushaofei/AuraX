import { describe, expect, it } from "vitest";
import {
  createModelOutputDeltaState,
  mergeModelOutputDelta,
  parseRuntimeEvent,
} from "./runtime-events.js";
import type { RuntimeEvent } from "./types.js";

describe("parseRuntimeEvent", () => {
  it("parses model.output.delta payload", () => {
    const event = parseRuntimeEvent(
      JSON.stringify({
        event_id: "rte_1",
        session_id: "ses_1",
        run_id: "run_1",
        sequence: 13,
        type: "model.output.delta",
        payload: { delta: "正在分析" },
        visibility: "user",
      }),
    );
    expect(event).toEqual({
      event_id: "rte_1",
      session_id: "ses_1",
      run_id: "run_1",
      sequence: 13,
      type: "model.output.delta",
      payload: { delta: "正在分析" },
      visibility: "user",
    });
  });

  it("returns null for invalid JSON", () => {
    expect(parseRuntimeEvent("not-json")).toBeNull();
  });
});

describe("mergeModelOutputDelta", () => {
  const deltaEvent = (
    eventId: string,
    delta: string,
    runId = "run_1",
  ): RuntimeEvent => ({
    event_id: eventId,
    session_id: "ses_1",
    run_id: runId,
    sequence: 1,
    type: "model.output.delta",
    payload: { delta },
  });

  it("merges deltas in order and dedupes by event_id", () => {
    let state = createModelOutputDeltaState();
    state = mergeModelOutputDelta(state, deltaEvent("rte_1", "Hello"));
    state = mergeModelOutputDelta(state, deltaEvent("rte_2", " world"));
    state = mergeModelOutputDelta(state, deltaEvent("rte_1", "Hello"));
    expect(state.text).toBe("Hello world");
    expect(state.runId).toBe("run_1");
  });

  it("resets when run_id changes", () => {
    let state = createModelOutputDeltaState();
    state = mergeModelOutputDelta(state, deltaEvent("rte_1", "first", "run_1"));
    state = mergeModelOutputDelta(state, deltaEvent("rte_2", "second", "run_2"));
    expect(state.text).toBe("second");
    expect(state.runId).toBe("run_2");
  });
});
