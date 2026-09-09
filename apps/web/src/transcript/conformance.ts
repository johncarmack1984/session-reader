import type {
  DocumentBlockParam,
  ImageBlockParam,
  Message,
  RedactedThinkingBlock,
  RedactedThinkingBlockParam,
  TextBlock,
  TextBlockParam,
  ThinkingBlock,
  ThinkingBlockParam,
  ToolReferenceBlockParam,
  ToolResultBlockParam,
  ToolUseBlock,
  ToolUseBlockParam,
  Usage,
} from '@anthropic-ai/sdk/resources/messages';
import type * as B from './blocks.ts';
import type * as M from './message.ts';

/*
 * Compile-time conformance against the official Anthropic SDK types.
 *
 * Direction: every value the API can produce must satisfy our schema. If a
 * future SDK release renames or retypes a field we require, `tsc` fails here,
 * which is the cheapest possible early warning for the half of the transcript
 * that is stable API surface. Polymorphic arrays (`content`) are checked per
 * element type because our unions carry a loose catch-all.
 *
 * This file has no runtime output.
 */

type Extends<A extends B, B> = A;

// tool_use.input is `unknown` in the SDK; tool inputs are always JSON objects, so we tighten it.
type ToolUseWithObjectInput<T extends { input: unknown }> = Omit<T, 'input'> & { input: Record<string, unknown> };

export type Conformance = [
  Extends<TextBlock, B.TextBlock>,
  Extends<TextBlockParam, B.TextBlock>,
  Extends<ThinkingBlock, B.ThinkingBlock>,
  Extends<ThinkingBlockParam, B.ThinkingBlock>,
  Extends<RedactedThinkingBlock, B.RedactedThinkingBlock>,
  Extends<RedactedThinkingBlockParam, B.RedactedThinkingBlock>,
  Extends<ToolUseWithObjectInput<ToolUseBlock>, B.ToolUseBlock>,
  Extends<ToolUseWithObjectInput<ToolUseBlockParam>, B.ToolUseBlock>,
  Extends<Omit<ToolResultBlockParam, 'content'>, Omit<B.ToolResultBlock, 'content'>>,
  Extends<ImageBlockParam, B.ImageBlock>,
  Extends<DocumentBlockParam, B.DocumentBlock>,
  Extends<ToolReferenceBlockParam, B.ToolReferenceBlock>,
  Extends<Usage, M.Usage>,
  Extends<Omit<Message, 'content'>, Omit<M.AssistantMessage, 'content'>>,
];
