import * as z from 'zod/mini';
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
  parentUuid: z.nullable(z.string()),
  timestamp: z.string(),
  sessionId,
  isSidechain: z.optional(z.boolean()),
  userType: z.optional(z.string()),
  entrypoint: z.optional(z.string()),
  cwd: z.optional(z.string()),
  version: z.optional(z.string()),
  gitBranch: z.optional(z.string()),
  slug: z.optional(z.string()),
  agentId: z.optional(z.string()),
  session_id: z.optional(z.string()),
  sessionKind: z.optional(z.string()),
});

export const UserLine = z.extend(Envelope, {
  type: z.literal('user'),
  message: UserMessage,
  promptId: z.optional(z.string()),
  promptSource: z.optional(z.string()),
  permissionMode: z.optional(z.string()),
  origin: z.optional(z.looseObject({ kind: z.string() })),
  isMeta: z.optional(z.boolean()),
  isCompactSummary: z.optional(z.boolean()),
  isVisibleInTranscriptOnly: z.optional(z.boolean()),
  toolUseResult: z.optional(z.unknown()),
  sourceToolAssistantUUID: z.optional(z.string()),
  sourceToolUseID: z.optional(z.string()),
  toolDenialKind: z.optional(z.string()),
  interruptedMessageId: z.optional(z.string()),
  imagePasteIds: z.optional(z.unknown()),
  mcpMeta: z.optional(z.unknown()),
  classifierMetaLines: z.optional(z.unknown()),
  queuePriority: z.optional(z.unknown()),
  queueSkipAttachments: z.optional(z.unknown()),
  turnCompanion: z.optional(z.unknown()),
  userFeedback: z.optional(z.unknown()),
  stackedOriginalInput: z.optional(z.string()),
  stackedExpansion: z.optional(z.boolean()),
});

export const AssistantLine = z.extend(Envelope, {
  type: z.literal('assistant'),
  message: AssistantMessage,
  requestId: z.optional(z.string()),
  effort: z.optional(z.string()),
  apiBlockIndex: z.optional(z.number()),
  attributionSkill: z.optional(z.unknown()),
  attributionAgent: z.optional(z.unknown()),
  attributionPlugin: z.optional(z.unknown()),
  attributionMcpServer: z.optional(z.unknown()),
  attributionMcpTool: z.optional(z.unknown()),
  isApiErrorMessage: z.optional(z.boolean()),
  error: z.optional(z.unknown()),
  errorDetails: z.optional(z.unknown()),
  apiErrorStatus: z.optional(z.number()),
  quotaLimits: z.optional(z.unknown()),
  truncatedAfterOutput: z.optional(z.unknown()),
  healsDistinctCarrier: z.optional(z.boolean()),
  /** Pre-2.1 releases wrote per-message cost and latency here. */
  costUSD: z.optional(z.number()),
  durationMs: z.optional(z.number()),
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

export const SystemLine = z.extend(Envelope, {
  type: z.literal('system'),
  subtype: z.string(),
  content: z.optional(z.string()),
  level: z.optional(z.string()),
  isMeta: z.optional(z.boolean()),
  durationMs: z.optional(z.number()),
  messageCount: z.optional(z.number()),
  logicalParentUuid: z.optional(z.nullable(z.string())),
  compactMetadata: z.optional(z.unknown()),
  trigger: z.optional(z.string()),
  direction: z.optional(z.string()),
  scope: z.optional(z.string()),
  originalModel: z.optional(z.string()),
  fallbackModel: z.optional(z.string()),
  requestId: z.optional(z.string()),
  apiRefusalCategory: z.optional(z.unknown()),
  apiRefusalExplanation: z.optional(z.unknown()),
  retractedMessageUuids: z.optional(z.unknown()),
  refusedUserMessageUuid: z.optional(z.nullable(z.string())),
  error: z.optional(z.unknown()),
  retryInMs: z.optional(z.number()),
  retryAttempt: z.optional(z.number()),
  maxRetries: z.optional(z.number()),
  pendingBackgroundAgentCount: z.optional(z.number()),
  pendingWorkflowCount: z.optional(z.number()),
  cronKind: z.optional(z.string()),
  hookCount: z.optional(z.number()),
  hookInfos: z.optional(z.unknown()),
  hookErrors: z.optional(z.unknown()),
  hookAdditionalContext: z.optional(z.unknown()),
  preventedContinuation: z.optional(z.boolean()),
  stopReason: z.optional(z.string()),
  hasOutput: z.optional(z.boolean()),
  toolUseID: z.optional(z.string()),
  url: z.optional(z.string()),
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

export const AttachmentLine = z.extend(Envelope, {
  type: z.literal('attachment'),
  attachment: z.looseObject({ type: z.string() }),
  rendered: z.optional(z.unknown()),
  renderedInHumanTurn: z.optional(z.unknown()),
});

// Session-scoped metadata lines. None carry the envelope.

export const LastPromptLine = z.object({
  type: z.literal('last-prompt'),
  sessionId,
  leafUuid: z.string(),
  lastPrompt: z.optional(z.string()),
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
  totalCostUSD: z.optional(z.number()),
  totalAPIDuration: z.optional(z.number()),
  totalAPIDurationWithoutRetries: z.optional(z.number()),
  totalToolDuration: z.optional(z.number()),
  totalLinesAdded: z.optional(z.number()),
  totalLinesRemoved: z.optional(z.number()),
  totalDuration: z.optional(z.number()),
  startTime: z.optional(z.number()),
  modelUsage: z.optional(z.unknown()),
  hasUnknownModelCost: z.optional(z.boolean()),
});

export const QueueOperationLine = z.object({
  type: z.literal('queue-operation'),
  sessionId,
  operation: z.string(),
  timestamp: z.string(),
  content: z.optional(z.string()),
  reason: z.optional(z.string()),
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
  isSnapshotUpdate: z.optional(z.boolean()),
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
  path: z.optional(z.string()),
  frameUrl: z.optional(z.string()),
  title: z.optional(z.string()),
  artifactCount: z.optional(z.number()),
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
  ownerAccountUuid: z.optional(z.string()),
  ownerOrganizationUuid: z.optional(z.string()),
});

/** Legacy title line, written at the tail of the file before `ai-title` existed. */
export const SummaryLine = z.object({
  type: z.literal('summary'),
  summary: z.string(),
  leafUuid: z.optional(z.string()),
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
  LINE_SCHEMAS.map((schema): [string, LineSchema] => [discriminant(schema), schema]),
);

function discriminant(schema: LineSchema): string {
  const value = schema.shape.type.def.values[0];
  if (typeof value !== 'string') throw new Error('line schema without a string `type` literal');
  return value;
}
