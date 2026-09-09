import type * as core from 'zod/v4/core';
import { KNOWN_BLOCK_TYPES } from './blocks.ts';
import { KNOWN_ATTACHMENT_TYPES, KNOWN_SYSTEM_SUBTYPES, LINE_SCHEMA_BY_TYPE } from './lines.ts';
import { isRecord, type LineResult } from './parse.ts';

/*
 * Schema drift accounting. Feed every LineResult to a DriftCollector and read
 * the report: which line types, keys, block types, and subtypes appeared that
 * the schema does not know about, and which known lines failed to parse.
 *
 * Findings carry the CLI version range they were seen under so a new key can
 * be dated. Metadata lines have no version of their own and inherit the last
 * version seen in the stream. Nothing here retains message content.
 */

export interface Finding {
  name: string;
  count: number;
  firstVersion?: string;
  lastVersion?: string;
  /** Key names or issue text that illustrate the finding. Never content. */
  sample?: string[];
}

export interface DriftReport {
  lines: number;
  unparseable: number;
  versions: string[];
  unknownLineTypes: Finding[];
  unknownKeys: Finding[];
  unknownBlockTypes: Finding[];
  unknownSystemSubtypes: Finding[];
  unknownAttachmentTypes: Finding[];
  invalid: Finding[];
}

export type DriftBucket = Exclude<keyof DriftReport, 'lines' | 'unparseable' | 'versions'>;

export const DRIFT_BUCKETS: readonly DriftBucket[] = [
  'unknownLineTypes',
  'unknownKeys',
  'unknownBlockTypes',
  'unknownSystemSubtypes',
  'unknownAttachmentTypes',
  'invalid',
];

/** Total number of distinct findings across every bucket. */
export function driftTotal(report: DriftReport): number {
  return DRIFT_BUCKETS.reduce((n, b) => n + report[b].length, 0);
}

export function compareVersions(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

export class DriftCollector {
  private lines = 0;
  private unparseable = 0;
  private readonly versions = new Set<string>();
  private lastVersion: string | undefined;
  private readonly buckets: Record<DriftBucket, Map<string, Finding>> = {
    unknownLineTypes: new Map(),
    unknownKeys: new Map(),
    unknownBlockTypes: new Map(),
    unknownSystemSubtypes: new Map(),
    unknownAttachmentTypes: new Map(),
    invalid: new Map(),
  };

  observe(result: LineResult): void {
    this.lines++;
    if (result.status === 'unparseable') {
      this.unparseable++;
      return;
    }
    const raw = result.raw;
    if (typeof raw.version === 'string') {
      this.versions.add(raw.version);
      this.lastVersion = raw.version;
    }
    const type = typeof raw.type === 'string' ? raw.type : '(none)';

    if (result.status === 'unknown') {
      this.hit('unknownLineTypes', type, Object.keys(raw));
      return;
    }
    if (result.status === 'invalid') {
      for (const issue of result.issues) {
        this.hit('invalid', `${type}: ${issue.path || '(root)'} ${issue.code}`, [issue.message]);
      }
      return;
    }

    const schema = LINE_SCHEMA_BY_TYPE.get(type);
    if (schema) {
      for (const key of collectUnknownKeys(raw, schema)) this.hit('unknownKeys', `${type}.${key}`);
    }
    for (const [blockType, keys] of collectUnknownBlockTypes(raw)) {
      this.hit('unknownBlockTypes', blockType, keys);
    }
    if (type === 'system' && typeof raw.subtype === 'string' && !KNOWN_SYSTEM_SUBTYPES.has(raw.subtype)) {
      this.hit('unknownSystemSubtypes', raw.subtype, Object.keys(raw));
    }
    if (type === 'attachment' && isRecord(raw.attachment) && typeof raw.attachment.type === 'string') {
      if (!KNOWN_ATTACHMENT_TYPES.has(raw.attachment.type)) {
        this.hit('unknownAttachmentTypes', raw.attachment.type, Object.keys(raw.attachment));
      }
    }
  }

  report(): DriftReport {
    const sorted = (m: Map<string, Finding>) => [...m.values()].sort((a, b) => b.count - a.count);
    return {
      lines: this.lines,
      unparseable: this.unparseable,
      versions: [...this.versions].sort(compareVersions),
      unknownLineTypes: sorted(this.buckets.unknownLineTypes),
      unknownKeys: sorted(this.buckets.unknownKeys),
      unknownBlockTypes: sorted(this.buckets.unknownBlockTypes),
      unknownSystemSubtypes: sorted(this.buckets.unknownSystemSubtypes),
      unknownAttachmentTypes: sorted(this.buckets.unknownAttachmentTypes),
      invalid: sorted(this.buckets.invalid),
    };
  }

  private hit(bucket: DriftBucket, name: string, sample?: string[]): void {
    const map = this.buckets[bucket];
    const v = this.lastVersion;
    const existing = map.get(name);
    if (existing) {
      existing.count++;
      if (v !== undefined) {
        if (existing.firstVersion === undefined || compareVersions(v, existing.firstVersion) < 0) existing.firstVersion = v;
        if (existing.lastVersion === undefined || compareVersions(v, existing.lastVersion) > 0) existing.lastVersion = v;
      }
      return;
    }
    const finding: Finding = { name, count: 1 };
    if (v !== undefined) {
      finding.firstVersion = v;
      finding.lastVersion = v;
    }
    if (sample && sample.length) finding.sample = sample.slice(0, 24);
    map.set(name, finding);
  }
}

// Schema walker. Reads a schema's `def` (shared by zod and zod/mini) to compare a raw value against the
// shape that accepted it and returns the paths of keys the shape does not
// declare. Loose objects, records, and `unknown` are opaque by design.

interface Def {
  type: string;
  shape?: Record<string, core.$ZodType>;
  catchall?: unknown;
  element?: core.$ZodType;
  options?: readonly core.$ZodType[];
  innerType?: core.$ZodType;
  values?: readonly unknown[];
}

function defOf(schema: core.$ZodType): Def {
  return schema._zod.def as unknown as Def;
}

const WRAPPERS = new Set(['optional', 'nullable', 'default', 'nonoptional', 'readonly', 'catch', 'prefault']);

function unwrap(schema: core.$ZodType): core.$ZodType {
  let s = schema;
  for (let i = 0; i < 8; i++) {
    const d = defOf(s);
    if (!WRAPPERS.has(d.type) || !d.innerType) return s;
    s = d.innerType;
  }
  return s;
}

export function collectUnknownKeys(value: unknown, schema: core.$ZodType): string[] {
  const out: string[] = [];
  walk(value, schema, '', out);
  return out;
}

function walk(value: unknown, schema: core.$ZodType, path: string, out: string[]): void {
  const s = unwrap(schema);
  const d = defOf(s);
  switch (d.type) {
    case 'object': {
      if (!isRecord(value) || d.catchall !== undefined || !d.shape) return;
      for (const [key, child] of Object.entries(value)) {
        const childSchema = d.shape[key];
        const childPath = path ? `${path}.${key}` : key;
        if (!childSchema) out.push(childPath);
        else walk(child, childSchema, childPath, out);
      }
      return;
    }
    case 'array': {
      if (!Array.isArray(value) || !d.element) return;
      for (const item of value) walk(item, d.element, `${path}[]`, out);
      return;
    }
    case 'union': {
      const picked = pickUnionOption(value, d.options ?? []);
      if (picked) walk(value, picked.schema, picked.tag ? `${path}<${picked.tag}>` : path, out);
      return;
    }
    default:
      return;
  }
}

function flattenOptions(options: readonly core.$ZodType[]): core.$ZodType[] {
  const out: core.$ZodType[] = [];
  for (const o of options) {
    const u = unwrap(o);
    const d = defOf(u);
    if (d.type === 'union' && d.options) out.push(...flattenOptions(d.options));
    else out.push(u);
  }
  return out;
}

function pickUnionOption(
  value: unknown,
  options: readonly core.$ZodType[],
): { schema: core.$ZodType; tag?: string } | undefined {
  const flat = flattenOptions(options);
  if (isRecord(value)) {
    if (typeof value.type === 'string') {
      for (const o of flat) {
        const d = defOf(o);
        if (d.type !== 'object' || !d.shape) continue;
        const disc = d.shape.type;
        if (!disc) continue;
        const dd = defOf(disc);
        if (dd.type === 'literal' && dd.values?.includes(value.type)) return { schema: o, tag: value.type };
      }
      // No discriminant match: the loose catch-all owns it, and that is opaque.
      return undefined;
    }
    const obj = flat.find((o) => defOf(o).type === 'object');
    return obj ? { schema: obj } : undefined;
  }
  const js = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  const match = flat.find((o) => defOf(o).type === js);
  return match ? { schema: match } : undefined;
}

/** Block types under `message.content` (and inside tool_result content) that the schema does not model. */
function collectUnknownBlockTypes(raw: Record<string, unknown>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const message = raw.message;
  if (!isRecord(message) || !Array.isArray(message.content)) return out;
  const visit = (blocks: unknown[]) => {
    for (const b of blocks) {
      if (!isRecord(b) || typeof b.type !== 'string') continue;
      if (!KNOWN_BLOCK_TYPES.has(b.type)) {
        if (!out.has(b.type)) out.set(b.type, Object.keys(b));
        continue;
      }
      if (b.type === 'tool_result' && Array.isArray(b.content)) visit(b.content);
    }
  };
  visit(message.content);
  return out;
}
