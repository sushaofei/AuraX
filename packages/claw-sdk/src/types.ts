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

export type ActivityNode = {
  id: string;
  type: string;
  status: string;
  title: string;
  summary: string;
  sequence: number;
  updated_version: number;
  run_id: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  detail: unknown;
  correlation: {
    event_ids: string[];
    model_call_id?: string;
    tool_invocation_id?: string;
    skill_activation_id?: string;
    approval_id?: string;
    capability_id?: string;
    [key: string]: unknown;
  };
};

export type ActivityPage = {
  session_id: string;
  projection_version: number;
  source_version: number;
  nodes: ActivityNode[];
  next_after_version: number;
  has_more: boolean;
};

export type CommandAccepted = {
  session_id: string;
  run_id: string | null;
  status: string;
  run_status?: string | null;
};

export type WaitOutcome =
  | "completed"
  | "failed"
  | "cancelled"
  | "timeout"
  | "needs_human"
  | "needs_resume";

export type SyncInvokeInput = {
  goal: string;
  timeoutSeconds?: number;
};

export type TaskResult = {
  session_id: string;
  run_id?: string | null;
  status: string;
  session_status?: string;
  run_status?: string | null;
  result_summary?: string | null;
  result_ref?: string | null;
  artifact_refs?: unknown[];
  error?: Record<string, unknown> | null;
  wait_outcome?: WaitOutcome;
  status_url?: string;
  result_url?: string;
  stream_url?: string;
  code?: string;
  message?: string;
  [key: string]: unknown;
};

export type RuntimeEvent = {
  event_id: string;
  session_id: string;
  run_id?: string;
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  visibility?: string;
};

export type ModelOutputDeltaState = {
  seenEventIds: Set<string>;
  text: string;
  runId: string | null;
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
  catalog_publication?: {
    active_generation?: number | null;
    status?: string | null;
    stale?: boolean;
    last_sync_at?: string | null;
    last_good_at?: string | null;
    last_sync_error?: string | null;
  } | null;
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

export type McpLifecycleAction =
  | "test"
  | "enable"
  | "disable"
  | "reconcile"
  | "retire"
  | "delete";

export type McpOperationRecord = {
  operation_id: string;
  server_id: string;
  operation: string;
  status: string;
  safe_error_code?: string | null;
  result?: Record<string, unknown>;
  target_revision?: number | null;
};

export type SkillInstallationRecord = {
  publisher: string;
  name: string;
  version_constraint: string;
  pinned_package_digest: string | null;
  status: string;
  source_id: string | null;
  auto_upgrade: boolean;
  revision: number;
  reason_code: string | null;
  uninstall_action: string | null;
  uninstall_policy_version: string | null;
  uninstall_policy_decision_id: string | null;
  updated_by: string;
  updated_at: string;
};

export type SkillPublicationRecord = {
  publisher: string;
  name: string;
  version: string;
  package_digest: string;
  status: string;
  source_id: string | null;
  revision: number;
  reason_code: string | null;
  revocation_action: string | null;
  revocation_policy_version: string | null;
  revocation_policy_decision_id: string | null;
  updated_by: string;
  updated_at: string;
};

export type SkillPackageRecord = {
  publisher: string;
  name: string;
  version: string;
  package_digest: string;
  retention_status: string;
  retention_until: string;
  legal_hold: boolean;
  retention_revision: number;
  retention_updated_by: string;
  retention_updated_at: string;
  purged_at: string | null;
};

export type SkillCatalogItem = {
  publisher: string;
  name: string;
  version: string;
  latest_version?: string;
  status: string;
  description: string;
  risk_level: string;
  package_digest: string;
  required_tools: unknown[];
  required_resources: unknown[];
  required_skills: unknown[];
  skill_markdown?: string;
  versions?: string[];
  publication?: {
    status: string;
    revision: number | null;
    source_id: string | null;
  };
  installation?: SkillInstallationRecord | null;
  availability?: string;
};

export type SkillSummary = SkillCatalogItem;

export type SkillCatalogPage = {
  items?: SkillCatalogItem[];
  skills: SkillCatalogItem[];
  next_cursor?: string | null;
};

export type SkillSourceRecord = {
  source_id: string;
  tenant_id: string;
  kind: "mcp" | string;
  desired_state: string;
  publisher_allowlist: string[];
  credential_ref: string | null;
  config_metadata: Record<string, unknown>;
  priority: number;
  revision: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

export type SkillSourceSyncState = {
  source_id: string;
  generation: number;
  cursor: string | null;
  complete_snapshot: boolean;
  last_success_at: string | null;
  last_attempt_at: string | null;
  consecutive_failures: number;
  safe_error_code: string | null;
};

export type SkillPublisherKeyRecord = {
  key_id: string;
  algorithm: string;
  public_key?: string;
  status: string;
  revision: number;
  activated_at: string;
  retired_at: string | null;
  revoked_at: string | null;
  reason_code: string | null;
  revocation_action: string | null;
  revocation_policy_version: string | null;
  revocation_policy_decision_id: string | null;
};

export type SkillPublisherRecord = {
  publisher: string;
  display_name: string;
  status: string;
  status_reason_code: string | null;
  security_action: string | null;
  security_policy_version: string | null;
  security_policy_decision_id: string | null;
  revision: number;
  updated_by: string;
  updated_at: string;
};

export type SkillPublisherView = {
  publisher: SkillPublisherRecord;
  keys: SkillPublisherKeyRecord[];
};

export type SkillAdmissionRecord = {
  admission_id: string;
  outcome: string;
  stage: string;
  safe_error_code: string | null;
  content_policy_version: string | null;
  duration_ms: number;
  occurred_at: string;
  [key: string]: unknown;
};

export type SkillAdmissionMetrics = {
  window: { hours: number; since: string; observed_at: string };
  metrics: Array<{ name: string; value: number; labels: Record<string, string> }>;
  alerts: Array<{
    rule: string;
    status: string;
    value: number;
    threshold: number;
    sample_count: number;
    minimum_samples: number;
  }>;
};
