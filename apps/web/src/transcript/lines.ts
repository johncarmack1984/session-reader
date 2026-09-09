import * as z from 'zod';
import { AssistantMessage, UserMessage } from './message.ts';

/*
 * One schema per top-level `type` found in a Claude Code transcript.
 *
 * Anthropic documents this format as internal and version-unstable, so the
 * rules here are about surviving change, not enforcing it:
 *
 *   - A field is required only when the reader cannot function without it.
 *   - Known lines are strip-mode: unknown keys are dropped from the typed value
 *     and reported by the drift walker.
 *   - Sub-objects we do not interpret are `z.unknown()` or loose objects; the
 *     walker treats both as opaque.
 *   - Anything with a `type` not listed in LINE_SCHEMAS parses as UnknownLine.
 *
 * Coverage: verified drift-free against every transcript on hand from Claude
 * Code 2.1.153 through 2.1.266 (1,250 files, 421k lines), plus the legacy
 * `summary` line and per-message cost fields from earlier releases. Re-run
 * `pnpm drift` after a CLI upgrade; new findings belong here.
 */

const sessionId = z.string();

/** Fields shared by every conversation line (user, assistant, system, attachment). */
export const Envelope = z.object({
  uuid: z.string(),
  parentUuid: z.string().nullable(),
  timestamp: z.string(),
  sessionId,
  isSidechain: z.boolean().optional(),
  userType: z.string().optional(),
  entrypoint: z.string().optional(),
  cwd: z.string().optional(),
  version: z.string().optional(),
  gitBranch: z.string().optional(),
  slug: z.string().optional(),
  agentId: z.string().optional(),
  session_id: z.string().optional(),
  sessionKind: z.string().optional(),
});

export const UserLine = Envelope.extend({
  type: z.literal('user'),
  message: UserMessage,
  promptId: z.string().optional(),
  promptSource: z.string().optional(),
  permissionMode: z.string().optional(),
  origin: z.looseObject({ kind: z.string() }).optional(),
  isMeta: z.boolean().optional(),
  isCompactSummary: z.boolean().optional(),
  isVisibleInTranscriptOnly: z.boolean().optional(),
  toolUseResult: z.unknown().optional(),
  sourceToolAssistantUUID: z.string().optional(),
  sourceToolUseID: z.string().optional(),
  toolDenialKind: z.string().optional(),
  interruptedMessageId: z.string().optional(),
  imagePasteIds: z.unknown().optional(),
  mcpMeta: z.unknown().optional(),
  classifierMetaLines: z.unknown().optional(),
  queuePriority: z.unknown().optional(),
  queueSkipAttachments: z.unknown().optional(),
  turnCompanion: z.unknown().optional(),
  userFeedback: z.unknown().optional(),
  stackedOriginalInput: z.string().optional(),
  stackedExpansion: z.boolean().optional(),
});

export const AssistantLine = Envelope.extend({
  type: z.literal('assistant'),
  message: AssistantMessage,
  requestId: z.string().optional(),
  effort: z.string().optional(),
  apiBlockIndex: z.number().optional(),
  attributionSkill: z.unknown().optional(),
  attributionAgent: z.unknown().optional(),
  attributionPlugin: z.unknown().optional(),
  attributionMcpServer: z.unknown().optional(),
  attributionMcpTool: z.unknown().optional(),
  isApiErrorMessage: z.boolean().optional(),
  error: z.unknown().optional(),
  errorDetails: z.unknown().optional(),
  apiErrorStatus: z.number().optional(),
  quotaLimits: z.unknown().optional(),
  truncatedAfterOutput: z.unknown().optional(),
  healsDistinctCarrier: z.boolean().optional(),
  /** Pre-2.1 releases wrote per-message cost and latency here. */
  costUSD: z.number().optional(),
  durationMs: z.number().optional(),
});

export const KNOWN_SYSTEM_SUBTYPES: ReadonlySet<string> = new Set([
  'turn_duration',
  'away_summary',
  'local_command',
  'api_error',
  'compact_boundary',
  'model_refusal_fallback',
  'scheduled_task_fire',
  'informational',
  'stop_hook_summary',
  'bridge_status',
]);

export const SystemLine = Envelope.extend({
  type: z.literal('system'),
  subtype: z.string(),
  content: z.string().optional(),
  level: z.string().optional(),
  isMeta: z.boolean().optional(),
  durationMs: z.number().optional(),
  messageCount: z.number().optional(),
  logicalParentUuid: z.string().nullable().optional(),
  compactMetadata: z.unknown().optional(),
  trigger: z.string().optional(),
  direction: z.string().optional(),
  scope: z.string().optional(),
  originalModel: z.string().optional(),
  fallbackModel: z.string().optional(),
  requestId: z.string().optional(),
  apiRefusalCategory: z.unknown().optional(),
  apiRefusalExplanation: z.unknown().optional(),
  retractedMessageUuids: z.unknown().optional(),
  refusedUserMessageUuid: z.string().nullable().optional(),
  error: z.unknown().optional(),
  retryInMs: z.number().optional(),
  retryAttempt: z.number().optional(),
  maxRetries: z.number().optional(),
  pendingBackgroundAgentCount: z.number().optional(),
  pendingWorkflowCount: z.number().optional(),
  cronKind: z.string().optional(),
  hookCount: z.number().optional(),
  hookInfos: z.unknown().optional(),
  hookErrors: z.unknown().optional(),
  hookAdditionalContext: z.unknown().optional(),
  preventedContinuation: z.boolean().optional(),
  stopReason: z.string().optional(),
  hasOutput: z.boolean().optional(),
  toolUseID: z.string().optional(),
  url: z.string().optional(),
});

export const KNOWN_ATTACHMENT_TYPES: ReadonlySet<string> = new Set([
  'agent_listing_delta',
  'auto_mode',
  'bash_output_audience_note',
  'batching_reminder_sent',
  'command_permissions',
  'compact_file_reference',
  'date',
  'date_change',
  'deferred_tools_delta',
  'deferred_tools_record',
  'diagnostics',
  'directory',
  'dynamic_skill',
  'edited_text_file',
  'environment',
  'file',
  'hook_additional_context',
  'hook_success',
  'hook_system_message',
  'instructions',
  'invoked_skills',
  'mcp_instructions_delta',
  'model',
  'nested_memory',
  'opened_file_in_ide',
  'plan_file_reference',
  'plan_mode',
  'plan_mode_exit',
  'plan_mode_reentry',
  'prompt_snapshot',
  'queued_command',
  'read_truncation_notice',
  'remote_session_change',
  'selected_lines_in_ide',
  'session_context',
  'silent_turn_reminder',
  'skill_listing',
  'task_reminder',
  'task_status',
  'total_tokens_reminder',
]);

export const AttachmentLine = Envelope.extend({
  type: z.literal('attachment'),
  attachment: z.looseObject({ type: z.string() }),
  rendered: z.unknown().optional(),
  renderedInHumanTurn: z.unknown().optional(),
});

// Session-scoped metadata lines. None carry the envelope.

export const LastPromptLine = z.object({
  type: z.literal('last-prompt'),
  sessionId,
  leafUuid: z.string(),
  lastPrompt: z.string().optional(),
});

export const ModeLine = z.object({ type: z.literal('mode'), sessionId, mode: z.string() });

export const PermissionModeLine = z.object({
  type: z.literal('permission-mode'),
  sessionId,
  permissionMode: z.string(),
});

export const AtisLatchLine = z.object({ type: z.literal('atis-latch'), sessionId, atis: z.string() });

export const AiTitleLine = z.object({ type: z.literal('ai-title'), sessionId, aiTitle: z.string() });

export const CustomTitleLine = z.object({
  type: z.literal('custom-title'),
  sessionId,
  customTitle: z.string(),
});

export const AgentNameLine = z.object({ type: z.literal('agent-name'), sessionId, agentName: z.string() });

export const CostStateLine = z.object({
  type: z.literal('cost-state'),
  sessionId,
  totalCostUSD: z.number().optional(),
  totalAPIDuration: z.number().optional(),
  totalAPIDurationWithoutRetries: z.number().optional(),
  totalToolDuration: z.number().optional(),
  totalLinesAdded: z.number().optional(),
  totalLinesRemoved: z.number().optional(),
  totalDuration: z.number().optional(),
  startTime: z.number().optional(),
  modelUsage: z.unknown().optional(),
  hasUnknownModelCost: z.boolean().optional(),
});

export const QueueOperationLine = z.object({
  type: z.literal('queue-operation'),
  sessionId,
  operation: z.string(),
  timestamp: z.string(),
  content: z.string().optional(),
  reason: z.string().optional(),
});

export const PrLinkLine = z.object({
  type: z.literal('pr-link'),
  sessionId,
  prNumber: z.number(),
  prUrl: z.string(),
  prRepository: z.string(),
  timestamp: z.string(),
});

export const FileHistorySnapshotLine = z.object({
  type: z.literal('file-history-snapshot'),
  messageId: z.string(),
  snapshot: z.unknown(),
  isSnapshotUpdate: z.boolean().optional(),
});

export const FileHistoryDeltaLine = z.object({
  type: z.literal('file-history-delta'),
  messageId: z.string(),
  snapshotMessageId: z.string(),
  trackingPath: z.string(),
  backup: z.unknown(),
  timestamp: z.string(),
});

export const ForkContextRefLine = z.object({
  type: z.literal('fork-context-ref'),
  agentId: z.string(),
  parentSessionId: z.string(),
  parentLastUuid: z.string(),
  contextLength: z.number(),
});

export const FrameLinkLine = z.object({
  type: z.literal('frame-link'),
  sessionId,
  timestamp: z.string(),
  path: z.string().optional(),
  frameUrl: z.string().optional(),
  title: z.string().optional(),
  artifactCount: z.number().optional(),
});

export const ArtifactCommentMonitorLine = z.object({
  type: z.literal('artifact-comment-monitor'),
  sessionId,
  v: z.number(),
  artifacts: z.unknown(),
});

export const ArtifactAutoreactLedgerLine = z.object({
  type: z.literal('artifact-autoreact-ledger'),
  sessionId,
  v: z.number(),
  accountUuid: z.string(),
  artifacts: z.unknown(),
});

export const BridgeSessionLine = z.object({
  type: z.literal('bridge-session'),
  sessionId,
  bridgeSessionId: z.string(),
  lastSequenceNum: z.number(),
  ownerAccountUuid: z.string().optional(),
  ownerOrganizationUuid: z.string().optional(),
});

/** Legacy title line, written at the tail of the file before `ai-title` existed. */
export const SummaryLine = z.object({
  type: z.literal('summary'),
  summary: z.string(),
  leafUuid: z.string().optional(),
});

/** Workflow-run journal lines found under subagents/workflows/wf_*. */
export const WorkflowStartedLine = z.object({
  type: z.literal('started'),
  key: z.string(),
  agentId: z.string(),
});

export const WorkflowResultLine = z.object({
  type: z.literal('result'),
  key: z.string(),
  agentId: z.string(),
  result: z.unknown(),
});

export const LINE_SCHEMAS = [
  UserLine,
  AssistantLine,
  SystemLine,
  AttachmentLine,
  LastPromptLine,
  ModeLine,
  PermissionModeLine,
  AtisLatchLine,
  AiTitleLine,
  CustomTitleLine,
  AgentNameLine,
  CostStateLine,
  QueueOperationLine,
  PrLinkLine,
  FileHistorySnapshotLine,
  FileHistoryDeltaLine,
  ForkContextRefLine,
  FrameLinkLine,
  ArtifactCommentMonitorLine,
  ArtifactAutoreactLedgerLine,
  BridgeSessionLine,
  SummaryLine,
  WorkflowStartedLine,
  WorkflowResultLine,
] as const;

export const KnownLine = z.discriminatedUnion('type', [...LINE_SCHEMAS]);

/** Any line whose `type` is not in LINE_SCHEMAS. Keeps every key. */
export const UnknownLine = z.looseObject({ type: z.string() });

export type LineSchema = (typeof LINE_SCHEMAS)[number];
export type KnownLine = z.infer<typeof KnownLine>;
export type UnknownLine = z.infer<typeof UnknownLine>;
export type LineType = KnownLine['type'];
export type UserLine = z.infer<typeof UserLine>;
export type AssistantLine = z.infer<typeof AssistantLine>;
export type SystemLine = z.infer<typeof SystemLine>;
export type AttachmentLine = z.infer<typeof AttachmentLine>;
export type Envelope = z.infer<typeof Envelope>;

export const LINE_SCHEMA_BY_TYPE: ReadonlyMap<string, LineSchema> = new Map(
  LINE_SCHEMAS.map((schema): [string, LineSchema] => [schema.shape.type.value, schema]),
);
