import * as z from 'zod/mini';

/*
 * Content blocks found inside `message.content`.
 *
 * Policy: known blocks are strip-mode objects, so a key we do not model is
 * dropped from the typed value and surfaced by the drift walker instead. A
 * block whose `type` we do not know becomes an `UnknownBlock`, which keeps
 * every key. A known type with a bad shape fails the whole line rather than
 * quietly becoming "unknown" (see the refinement on `UnknownBlock`).
 *
 * Shapes verified against Claude Code 2.1.153 through 2.1.266 transcripts and
 * checked against @anthropic-ai/sdk in conformance.ts. Built on zod/mini for
 * bundle size: wrappers are functions (z.optional(x)), not methods (x.optional()).
 */

export const KNOWN_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'text',
  'thinking',
  'redacted_thinking',
  'tool_use',
  'tool_result',
  'image',
  'document',
  'tool_reference',
  'fallback',
]);

/** Any block whose type we do not model. Keeps every key. Refuses known types so a malformed known block fails loudly. */
export const UnknownBlock = z
  .looseObject({ type: z.string() })
  // `abort` keeps this refinement from being the union's lone non-aborting branch: zod would then
  // report only this issue and hide the real shape error from the known-block branch.
  .check(z.refine((b) => !KNOWN_BLOCK_TYPES.has(b.type), { message: 'known block type with an invalid shape', abort: true }));

export const TextBlock = z.object({
  type: z.literal('text'),
  text: z.string(),
  citations: z.optional(z.unknown()),
});

export const ThinkingBlock = z.object({
  type: z.literal('thinking'),
  thinking: z.string(),
  signature: z.optional(z.string()),
});

export const RedactedThinkingBlock = z.object({
  type: z.literal('redacted_thinking'),
  data: z.string(),
});

export const ToolUseBlock = z.object({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  // The API types this as `unknown`; tool inputs are always JSON objects in practice.
  input: z.record(z.string(), z.unknown()),
  caller: z.optional(z.unknown()),
});

/** Shared shape of image and document sources (base64, url, file, text, content). */
export const BlockSource = z.object({
  type: z.string(),
  media_type: z.optional(z.string()),
  data: z.optional(z.string()),
  url: z.optional(z.string()),
  file_id: z.optional(z.string()),
});

export const ImageBlock = z.object({
  type: z.literal('image'),
  source: BlockSource,
});

export const DocumentBlock = z.object({
  type: z.literal('document'),
  source: BlockSource,
  title: z.optional(z.nullable(z.string())),
  context: z.optional(z.nullable(z.string())),
  citations: z.optional(z.unknown()),
});

export const ToolReferenceBlock = z.object({
  type: z.literal('tool_reference'),
  tool_name: z.string(),
});

/** Claude Code internal marker for a mid-turn model fallback. Not an API block. */
export const FallbackBlock = z.object({
  type: z.literal('fallback'),
  from: z.object({ model: z.optional(z.string()) }),
  to: z.object({ model: z.optional(z.string()) }),
});

const KnownToolResultContentBlock = z.discriminatedUnion('type', [
  TextBlock,
  ImageBlock,
  DocumentBlock,
  ToolReferenceBlock,
]);

export const ToolResultBlock = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string(),
  content: z.optional(z.union([z.string(), z.array(z.union([KnownToolResultContentBlock, UnknownBlock]))])),
  is_error: z.optional(z.boolean()),
});

export const KnownBlock = z.discriminatedUnion('type', [
  TextBlock,
  ThinkingBlock,
  RedactedThinkingBlock,
  ToolUseBlock,
  ToolResultBlock,
  ImageBlock,
  DocumentBlock,
  ToolReferenceBlock,
  FallbackBlock,
]);

export const ContentBlock = z.union([KnownBlock, UnknownBlock]);

export type TextBlock = z.infer<typeof TextBlock>;
export type ThinkingBlock = z.infer<typeof ThinkingBlock>;
export type RedactedThinkingBlock = z.infer<typeof RedactedThinkingBlock>;
export type ToolUseBlock = z.infer<typeof ToolUseBlock>;
export type ToolResultBlock = z.infer<typeof ToolResultBlock>;
export type ImageBlock = z.infer<typeof ImageBlock>;
export type DocumentBlock = z.infer<typeof DocumentBlock>;
export type ToolReferenceBlock = z.infer<typeof ToolReferenceBlock>;
export type FallbackBlock = z.infer<typeof FallbackBlock>;
export type KnownBlock = z.infer<typeof KnownBlock>;
export type UnknownBlock = z.infer<typeof UnknownBlock>;
export type ContentBlock = z.infer<typeof ContentBlock>;

export function isKnownBlock(block: ContentBlock): block is KnownBlock {
  return KNOWN_BLOCK_TYPES.has(block.type);
}
