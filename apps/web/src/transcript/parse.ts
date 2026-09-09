import type * as z from 'zod';
import { LINE_SCHEMA_BY_TYPE, UnknownLine, type KnownLine } from './lines.ts';
import type { DriftCollector } from './drift.ts';

export interface Issue {
  path: string;
  code: string;
  message: string;
}

export type LineResult =
  | { status: 'known'; line: KnownLine; raw: Record<string, unknown> }
  | { status: 'unknown'; line: UnknownLine; raw: Record<string, unknown> }
  | { status: 'invalid'; type: string | undefined; issues: Issue[]; raw: Record<string, unknown> }
  | { status: 'unparseable'; error: string };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse one JSONL line. Never throws. */
export function parseLine(text: string): LineResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { status: 'unparseable', error: (e as Error).message };
  }
  if (!isRecord(json)) return { status: 'unparseable', error: 'line is not a JSON object' };

  const type = typeof json.type === 'string' ? json.type : undefined;
  const schema = type === undefined ? undefined : LINE_SCHEMA_BY_TYPE.get(type);
  if (!schema) {
    const r = UnknownLine.safeParse(json);
    return r.success
      ? { status: 'unknown', line: r.data, raw: json }
      : { status: 'invalid', type, issues: flattenIssues(r.error.issues), raw: json };
  }
  const r = schema.safeParse(json);
  return r.success
    ? { status: 'known', line: r.data as KnownLine, raw: json }
    : { status: 'invalid', type, issues: flattenIssues(r.error.issues), raw: json };
}

/** Parse a whole transcript. Blank lines are skipped; every other line yields one result. */
export function parseTranscript(text: string, drift?: DriftCollector): LineResult[] {
  const out: LineResult[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const result = parseLine(line);
    drift?.observe(result);
    out.push(result);
  }
  return out;
}

/** Collapse array indices so findings aggregate: `content.3.text` becomes `content[].text`. */
export function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let out = '';
  for (const seg of path) {
    if (typeof seg === 'number') out += '[]';
    else out += out ? `.${String(seg)}` : String(seg);
  }
  return out;
}

/**
 * Expand `invalid_union` issues into the issues of their most informative
 * branch. Our unions are always "known shapes | loose catch-all", and the
 * catch-all's refinement fails with a `custom` issue, so a branch with only
 * `custom` issues is the fallback and the other branch is the real story.
 */
export function flattenIssues(issues: ReadonlyArray<z.core.$ZodIssue>, depth = 0): Issue[] {
  const out: Issue[] = [];
  for (const issue of issues) {
    if (issue.code === 'invalid_union' && depth < 6) {
      const branches = (issue as z.core.$ZodIssueInvalidUnion).errors ?? [];
      const informative = branches.filter((b) => b.some((i) => i.code !== 'custom'));
      const pool = informative.length ? informative : branches;
      const best = pool.reduce<ReadonlyArray<z.core.$ZodIssue> | undefined>(
        (acc, b) => (acc === undefined || b.length < acc.length ? b : acc),
        undefined,
      );
      if (best && best.length) {
        const prefix = formatPath(issue.path);
        for (const inner of flattenIssues(best, depth + 1)) {
          out.push({ ...inner, path: joinPath(prefix, inner.path) });
        }
        continue;
      }
    }
    out.push({ path: formatPath(issue.path), code: issue.code, message: issue.message });
  }
  return out;
}

function joinPath(prefix: string, inner: string): string {
  if (!prefix) return inner;
  if (!inner) return prefix;
  return inner.startsWith('[') ? `${prefix}${inner}` : `${prefix}.${inner}`;
}
