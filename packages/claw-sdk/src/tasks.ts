import type { ClawClient } from "./client.js";
import { newIdempotencyKey } from "./errors.js";
import type {
  CommandAccepted,
  CreateTaskInput,
  ActivityPage,
  TaskAccepted,
  TaskList,
  TaskView,
  Transcript,
} from "./types.js";

export function createTask(
  client: ClawClient,
  input: CreateTaskInput,
  idempotencyKey = newIdempotencyKey("task"),
): Promise<{ status: number; body: TaskAccepted }> {
  return client.request<TaskAccepted>("POST", "/v1/tasks", {
    idempotencyKey,
    json: {
      goal: input.goal,
      source: input.source ?? "chat",
      ...(input.scheduleId ? { schedule_id: input.scheduleId } : {}),
      ...(input.occurrenceId ? { occurrence_id: input.occurrenceId } : {}),
    },
  });
}

export function listTasks(
  client: ClawClient,
  query: {
    kind?: "chat" | "scheduled";
    status?: string;
    cursor?: string;
    limit?: number;
  } = {},
): Promise<{ body: TaskList }> {
  return client.request<TaskList>("GET", "/v1/tasks", {
    query: {
      kind: query.kind,
      status: query.status,
      cursor: query.cursor,
      limit: query.limit,
    },
  });
}

export function getTask(
  client: ClawClient,
  sessionId: string,
): Promise<{ body: TaskView; status: number }> {
  return client.request<TaskView>("GET", `/v1/tasks/${sessionId}`);
}

export function getTranscript(
  client: ClawClient,
  sessionId: string,
): Promise<{ body: Transcript }> {
  return client.request<Transcript>("GET", `/v1/tasks/${sessionId}/transcript`);
}

export function getActivity(
  client: ClawClient,
  sessionId: string,
  options: { afterVersion?: number; limit?: number } = {},
): Promise<{ body: ActivityPage; headers: Headers }> {
  return client.request<ActivityPage>("GET", `/v1/tasks/${sessionId}/activity`, {
    query: {
      after_version: options.afterVersion ?? 0,
      limit: options.limit ?? 200,
    },
  });
}

export function getResult(
  client: ClawClient,
  sessionId: string,
): Promise<{ body: Record<string, unknown>; status: number }> {
  return client.request("GET", `/v1/tasks/${sessionId}/result`);
}

export function appendMessage(
  client: ClawClient,
  sessionId: string,
  message: string,
  expectedVersion: number,
  idempotencyKey = newIdempotencyKey("message"),
): Promise<{ body: CommandAccepted }> {
  return client.request<CommandAccepted>("POST", `/v1/sessions/${sessionId}/messages`, {
    json: { message },
    idempotencyKey,
    expectedVersion,
  });
}

export function requestRun(
  client: ClawClient,
  sessionId: string,
  expectedVersion: number,
  idempotencyKey = newIdempotencyKey("run"),
): Promise<{ body: CommandAccepted }> {
  return client.request<CommandAccepted>("POST", `/v1/sessions/${sessionId}/runs`, {
    idempotencyKey,
    expectedVersion,
  });
}

const RUNNABLE_SESSION_STATUSES = new Set(["created", "ready", "paused"]);

export async function followUp(
  client: ClawClient,
  sessionId: string,
  message: string,
  expectedVersion: number,
  sessionStatus: string,
): Promise<{ body: CommandAccepted }> {
  const appended = await appendMessage(client, sessionId, message, expectedVersion);
  if (!RUNNABLE_SESSION_STATUSES.has(sessionStatus)) {
    return appended;
  }
  const latest = await getTask(client, sessionId);
  const runVersion = Math.max(latest.body.projection_version, expectedVersion + 1);
  return requestRun(client, sessionId, runVersion);
}

export function cancelTask(
  client: ClawClient,
  sessionId: string,
  expectedVersion: number,
  reason = "cancelled by user",
  idempotencyKey = newIdempotencyKey("cancel"),
): Promise<{ body: CommandAccepted }> {
  return client.request<CommandAccepted>("POST", `/v1/sessions/${sessionId}/cancel`, {
    json: { reason },
    idempotencyKey,
    expectedVersion,
  });
}

export function closeSession(
  client: ClawClient,
  sessionId: string,
  expectedVersion: number,
  reason = "closed by user",
  idempotencyKey = newIdempotencyKey("close"),
): Promise<{ body: CommandAccepted }> {
  return client.request<CommandAccepted>("POST", `/v1/sessions/${sessionId}/close`, {
    json: { reason },
    idempotencyKey,
    expectedVersion,
  });
}

export function resumeTask(
  client: ClawClient,
  sessionId: string,
  expectedVersion: number,
  idempotencyKey = newIdempotencyKey("resume"),
): Promise<{ body: CommandAccepted }> {
  return client.request<CommandAccepted>("POST", `/v1/sessions/${sessionId}/resume`, {
    idempotencyKey,
    expectedVersion,
  });
}

export function respondToApproval(
  client: ClawClient,
  sessionId: string,
  approvalId: string,
  decision: "approved" | "rejected",
  expectedVersion: number,
  feedback?: string,
  idempotencyKey = newIdempotencyKey("approval"),
): Promise<{ body: CommandAccepted }> {
  return client.request<CommandAccepted>(
    "POST",
    `/v1/sessions/${sessionId}/approvals/${approvalId}/responses`,
    {
      json: { decision, feedback },
      idempotencyKey,
      expectedVersion,
    },
  );
}
