import type { ClawClient } from "./client.js";

export type SseEvent = {
  id?: string;
  event?: string;
  data: string;
};

export async function* readSse(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const parsed = parseBlock(block);
        if (parsed) {
          yield parsed;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseBlock(block: string): SseEvent | null {
  let id: string | undefined;
  let event: string | undefined;
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("id:")) {
      id = line.slice(3).trim();
    } else if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      data.push(line.slice(5).trimStart());
    }
  }
  if (data.length === 0 && !event) {
    return null;
  }
  const parsed: SseEvent = { data: data.join("\n") };
  if (id) {
    parsed.id = id;
  }
  if (event) {
    parsed.event = event;
  }
  return parsed;
}

export function openTaskStream(
  client: ClawClient,
  sessionId: string,
  options: { lastEventId?: string; signal?: AbortSignal } = {},
): Promise<ReadableStream<Uint8Array>> {
  return client.stream(`/v1/streams/${sessionId}`, options);
}
