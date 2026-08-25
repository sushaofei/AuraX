import { describe, expect, it } from "vitest";
import { ClawClient } from "./client.js";
import { followTaskStream } from "./streams.js";

function sseResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("followTaskStream", () => {
  it("reconnects with Last-Event-ID after the stream ends", async () => {
    const lastIds: Array<string | null> = [];
    let calls = 0;
    const abort = new AbortController();
    const client = new ClawClient({
      baseUrl: "http://claw.example",
      fetch: (async (_input, init) => {
        calls += 1;
        lastIds.push(new Headers(init?.headers).get("Last-Event-ID"));
        if (calls === 1) {
          return sseResponse("id: 12\nevent: model.output.delta\ndata: hi\n\n");
        }
        return sseResponse("id: 13\nevent: run.completed\ndata: {}\n\n");
      }) as typeof fetch,
    });

    const events = [];
    for await (const event of followTaskStream(client, "ses_1", {
      signal: abort.signal,
      retryMs: 1,
    })) {
      events.push(event);
      if (events.length >= 2) {
        abort.abort();
      }
    }

    expect(events.map((event) => event.id)).toEqual(["12", "13"]);
    expect(lastIds).toEqual([null, "12"]);
  });
});
