export interface SessionMetadata {
  startTime?: string;
  endTime?: string;
  cwd?: string;
  version?: string;
  gitBranch?: string;
  sessionId?: string;
  entrypoint?: string;
  permissionMode?: string;
}

export interface UserMessageEntry {
  type: 'user-message';
  content: string;
  timestamp?: string;
}

export interface AssistantTextEntry {
  type: 'assistant-text';
  content: string;
  timestamp?: string;
}

export interface ToolCallEntry {
  type: 'tool-call';
  id: string;
  name: string;
  input: Record<string, unknown>;
  timestamp?: string;
}

export interface ThinkingEntry {
  type: 'thinking';
  content: string;
  timestamp?: string;
}

export type Entry = UserMessageEntry | AssistantTextEntry | ToolCallEntry | ThinkingEntry;

export interface ToolResult {
  content: string;
  isError: boolean;
}

export interface ParsedSession {
  entries: Entry[];
  toolResults: Map<string, ToolResult>;
  metadata: SessionMetadata;
}

export function parseSession(text: string): ParsedSession {
  const lines = text.trim().split('\n');
  const entries: Entry[] = [];
  const toolResults = new Map<string, ToolResult>();
  const metadata: SessionMetadata = {};

  for (const line of lines) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (!metadata.startTime && obj.timestamp) metadata.startTime = obj.timestamp as string;
    if (obj.timestamp) metadata.endTime = obj.timestamp as string;
    if (!metadata.cwd && obj.cwd) {
      metadata.cwd = obj.cwd as string;
      metadata.version = obj.version as string;
      metadata.gitBranch = obj.gitBranch as string;
      metadata.sessionId = obj.sessionId as string;
      metadata.entrypoint = obj.entrypoint as string;
      metadata.permissionMode = obj.permissionMode as string;
    }

    if (obj.type === 'user' && obj.message) {
      const msg = obj.message as Record<string, unknown>;
      const content = msg.content;
      if (typeof content === 'string') {
        entries.push({ type: 'user-message', content, timestamp: obj.timestamp as string });
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_result') {
            let rc: string;
            if (typeof block.content === 'string') rc = block.content;
            else if (Array.isArray(block.content))
              rc = block.content.map((b: Record<string, unknown>) => (b.text as string) || '').join('\n');
            else rc = '';
            toolResults.set(block.tool_use_id as string, { content: rc, isError: !!block.is_error });
          }
        }
      }
    } else if (obj.type === 'assistant' && obj.message) {
      const msg = obj.message as Record<string, unknown>;
      const content = msg.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && block.text) {
            entries.push({ type: 'assistant-text', content: block.text as string, timestamp: obj.timestamp as string });
          } else if (block.type === 'tool_use') {
            entries.push({
              type: 'tool-call',
              id: block.id as string,
              name: block.name as string,
              input: (block.input as Record<string, unknown>) || {},
              timestamp: obj.timestamp as string,
            });
          } else if (block.type === 'thinking' && block.thinking) {
            entries.push({ type: 'thinking', content: block.thinking as string, timestamp: obj.timestamp as string });
          }
        }
      }
    }
  }
  return { entries, toolResults, metadata };
}
