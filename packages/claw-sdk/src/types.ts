export type TaskSource = "chat" | "schedule";

export type CreateTaskInput = {
  goal: string;
  source?: TaskSource;
  scheduleId?: string;
  occurrenceId?: string;
};

export type TaskAccepted = {
  session_id: string;
  run_id: string;
  status: string;
  status_url: string;
  result_url: string;
  stream_url: string;
};

export type TaskView = {
  tenant_id: string;
  session_id: string;
  root_session_id: string;
  run_id: string | null;
  status: string;
  run_status: string | null;
  goal: string;
  source: string;
  schedule_id: string | null;
  occurrence_id: string | null;
  progress: number;
  current_stage: string;
  result_summary: string | null;
  result_ref: string | null;
  artifact_refs: unknown[];
  error: Record<string, unknown> | null;
  projection_version: number;
  projected_at: string;
};

export type TaskList = {
  tasks: TaskView[];
  next_cursor: string | null;
};

export type TranscriptMessage = {
  role: string;
  content: string;
  event_id?: string;
  occurred_at?: string;
  run_id?: string;
};

export type PendingApproval = {
  approval_id: string;
  tool_name: string;
  reason: string;
  risk?: string;
  redacted_arguments?: unknown;
  expected_effect?: string;
  status: string;
};

export type Transcript = {
  session_id: string;
  projection_version: number;
  status: string;
  run_status: string | null;
  messages: TranscriptMessage[];
  pending_approval: PendingApproval | null;
};

export type CommandAccepted = {
  session_id: string;
  run_id: string | null;
  status: string;
  run_status?: string | null;
};

export type McpServerRecord = {
  server_id: string;
  tenant_id?: string | null;
  desired_state: string;
  latest_revision: number;
  active_revision?: number | null;
  latest_config?: {
    title?: string;
    endpoint?: string;
    protocol_revision?: string;
    credential_ref?: string | null;
    auth_strategy?: string;
    network_mode?: string;
    allowed_tool_prefixes?: string[];
  };
  runtime?: {
    observed_state?: string;
    last_test_at?: string | null;
    safe_error_code?: string | null;
  };
};

export type McpTool = {
  capability_id: string;
  canonical_name: string;
  title: string;
  description: string;
  version: string;
  status: string;
  tags: string[];
};

export type McpToolList = {
  server_id: string;
  tools: McpTool[];
};

export type McpLifecycleAction = "test" | "enable" | "disable" | "reconcile" | "retire";

export type McpOperationRecord = {
  operation_id: string;
  server_id: string;
  operation: string;
  status: string;
  safe_error_code?: string | null;
  result?: Record<string, unknown>;
  target_revision?: number | null;
};

export type SkillSummary = {
  publisher: string;
  name: string;
  version: string;
  status: string;
  description: string;
  risk_level: string;
  package_digest: string;
  required_tools: unknown[];
  required_resources: unknown[];
  required_skills: unknown[];
  skill_markdown?: string;
  versions?: string[];
};
