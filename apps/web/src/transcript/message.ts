import * as z from 'zod';
import { ContentBlock } from './blocks.ts';

/*
 * The `message` payload on `user` and `assistant` lines. These are Anthropic
 * Messages API shapes (MessageParam and Message) plus a few Claude Code
 * additions. Only `role` and `content` are required: a reader must still show
 * a message whose bookkeeping fields are missing.
 */

export const Usage = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_creation_input_tokens: z.number().nullable().optional(),
  cache_read_input_tokens: z.number().nullable().optional(),
  cache_creation: z.unknown().optional(),
  server_tool_use: z.unknown().optional(),
  service_tier: z.string().nullable().optional(),
  inference_geo: z.string().nullable().optional(),
  output_tokens_details: z.unknown().optional(),
  /** Claude Code additions since 2.1.173: per-iteration usage for server-side tool loops, and a speed label. */
  iterations: z.unknown().optional(),
  speed: z.string().nullable().optional(),
});

/** `message` on a `user` line: a MessageParam with role "user". */
export const UserMessage = z.object({
  role: z.literal('user'),
  content: z.union([z.string(), z.array(ContentBlock)]),
});

/** `message` on an `assistant` line: a Message, plus Claude Code's `diagnostics`. */
export const AssistantMessage = z.object({
  role: z.literal('assistant'),
  content: z.array(ContentBlock),
  type: z.literal('message').optional(),
  id: z.string().optional(),
  model: z.string().optional(),
  stop_reason: z.string().nullable().optional(),
  stop_sequence: z.string().nullable().optional(),
  stop_details: z.unknown().optional(),
  usage: Usage.optional(),
  container: z.unknown().optional(),
  context_management: z.unknown().optional(),
  diagnostics: z.unknown().optional(),
});

export type Usage = z.infer<typeof Usage>;
export type UserMessage = z.infer<typeof UserMessage>;
export type AssistantMessage = z.infer<typeof AssistantMessage>;
