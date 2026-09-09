import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  DRIFT_BUCKETS,
  DriftCollector,
  driftTotal,
  parseLine,
  type DriftBucket,
  type DriftReport,
  type Finding,
} from '../src/transcript/index.ts';
import { readLines } from './jsonl.ts';

const USAGE = `usage: drift [--json] [--strict] [--all] [path ...]

Scan Claude Code transcripts (*.jsonl) for schema drift: line types, keys,
content-block types, and subtypes the schema does not know about, plus known
lines that fail to parse. Paths may be files or directories; the default is
~/.claude/projects. Prints key names and counts only, never message content.

  --json    machine-readable report
  --strict  exit 1 when any finding is present
  --all     list every finding (default caps each section at 40 rows)
`;

const SECTION_TITLES: Record<DriftBucket, string> = {
  unknownLineTypes: 'Unknown line types',
  unknownKeys: 'Unknown keys on known lines',
  unknownBlockTypes: 'Unknown content-block types',
  unknownSystemSubtypes: 'Unknown system subtypes',
  unknownAttachmentTypes: 'Unknown attachment types',
  invalid: 'Known lines that failed to parse',
};

interface Options {
  json: boolean;
  strict: boolean;
  all: boolean;
  paths: string[];
}

function parseArgs(argv: string[]): Options | undefined {
  const opts: Options = { json: false, strict: false, all: false, paths: [] };
  for (const arg of argv) {
    if (arg === '--json') opts.json = true;
    else if (arg === '--strict') opts.strict = true;
    else if (arg === '--all') opts.all = true;
    else if (arg === '--help' || arg === '-h') return undefined;
    else if (arg.startsWith('--')) {
      process.stderr.write(`unknown flag ${arg}\n`);
      return undefined;
    } else opts.paths.push(arg);
  }
  if (opts.paths.length === 0) opts.paths.push(join(homedir(), '.claude', 'projects'));
  return opts;
}

function* walk(path: string): Generator<string> {
  const stat = statSync(path);
  if (stat.isFile()) {
    if (path.endsWith('.jsonl')) yield path;
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) yield* walk(child);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) yield child;
  }
}

async function scanFile(path: string, drift: DriftCollector): Promise<void> {
  for await (const line of readLines(path)) {
    if (!line.trim()) continue;
    drift.observe(parseLine(line));
  }
}

function formatVersions(f: Finding): string {
  if (!f.firstVersion) return '';
  return f.firstVersion === f.lastVersion ? f.firstVersion : `${f.firstVersion} → ${f.lastVersion}`;
}

function printReport(report: DriftReport, files: number, all: boolean): void {
  const out: string[] = [];
  const versions = report.versions;
  const range = versions.length
    ? `${versions[0]} → ${versions[versions.length - 1]} (${versions.length} distinct)`
    : 'none recorded';
  out.push(`Scanned ${files} files · ${report.lines.toLocaleString()} lines · ${report.unparseable} unparseable`);
  out.push(`CLI versions: ${range}`);
  out.push('');

  const total = driftTotal(report);
  if (total === 0) {
    out.push('No drift against the current schema.');
    process.stdout.write(out.join('\n') + '\n');
    return;
  }

  const CAP = 40;
  for (const bucket of DRIFT_BUCKETS) {
    const findings = report[bucket];
    if (findings.length === 0) continue;
    out.push(`${SECTION_TITLES[bucket]} (${findings.length})`);
    const shown = all ? findings : findings.slice(0, CAP);
    const nameWidth = Math.min(60, Math.max(...shown.map((f) => f.name.length)));
    for (const f of shown) {
      const name = f.name.length > nameWidth ? f.name.slice(0, nameWidth - 1) + '…' : f.name.padEnd(nameWidth);
      const count = String(f.count).padStart(8);
      const versionsCol = formatVersions(f).padEnd(20);
      const sample = f.sample && f.sample.length ? `  ${truncate(f.sample.join(' '), 80)}` : '';
      out.push(`  ${name}${count}  ${versionsCol}${sample}`);
    }
    if (!all && findings.length > CAP) out.push(`  … ${findings.length - CAP} more (use --all)`);
    out.push('');
  }
  out.push(`${total} finding${total !== 1 ? 's' : ''}.`);
  process.stdout.write(out.join('\n') + '\n');
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

async function main(argv: string[]): Promise<number> {
  const opts = parseArgs(argv);
  if (!opts) {
    process.stderr.write(USAGE);
    return 2;
  }
  const drift = new DriftCollector();
  let files = 0;
  for (const p of opts.paths) {
    const abs = resolve(p);
    try {
      statSync(abs);
    } catch {
      process.stderr.write(`not found: ${abs}\n`);
      return 2;
    }
    for (const file of walk(abs)) {
      files++;
      await scanFile(file, drift);
    }
  }
  const report = drift.report();
  if (opts.json) process.stdout.write(JSON.stringify({ files, ...report }, null, 2) + '\n');
  else printReport(report, files, opts.all);
  return opts.strict && driftTotal(report) > 0 ? 1 : 0;
}

process.exitCode = await main(process.argv.slice(2));
