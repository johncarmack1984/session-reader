import * as z from 'zod/mini';
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
  cache_creation_input_tokens: z.optional(z.nullable(z.number())),
  cache_read_input_tokens: z.optional(z.nullable(z.number())),
  cache_creation: z.optional(z.unknown()),
  server_tool_use: z.optional(z.unknown()),
  service_tier: z.optional(z.nullable(z.string())),
  inference_geo: z.optional(z.nullable(z.string())),
  output_tokens_details: z.optional(z.unknown()),
  /** Claude Code additions since 2.1.173: per-iteration usage for server-side tool loops, and a speed label. */
  iterations: z.optional(z.unknown()),
  speed: z.optional(z.nullable(z.string())),
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
  type: z.optional(z.literal('message')),
  id: z.optional(z.string()),
  model: z.optional(z.string()),
  stop_reason: z.optional(z.nullable(z.string())),
  stop_sequence: z.optional(z.nullable(z.string())),
  stop_details: z.optional(z.unknown()),
  usage: z.optional(Usage),
  container: z.optional(z.unknown()),
  context_management: z.optional(z.unknown()),
  diagnostics: z.optional(z.unknown()),
});

export type Usage = z.infer<typeof Usage>;
export type UserMessage = z.infer<typeof UserMessage>;
export type AssistantMessage = z.infer<typeof AssistantMessage>;
