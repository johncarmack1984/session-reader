# session-reader

A browser-only reader for Claude Code session transcripts: the `.jsonl` files Claude Code writes under `~/.claude/projects/<project>/`, plus the memory markdown files kept next to them. Drop one session file or a whole folder and read it as a conversation, with each turn's tool calls and thinking folded away under the answer. Live at [session-reader.johncarmack.com](https://session-reader.johncarmack.com/).

Nothing leaves the browser. The site is static files on S3 behind CloudFront with no backend, and the app reads dropped files with the File API and never uploads them. The only outbound requests are for the page's own assets and the Google Fonts stylesheet.

## Using it

Drop a `.jsonl` file on the landing page, or drop a folder. Drag-and-drop works in every current browser. The **Browse** button opens a folder picker where the File System Access API exists (Chromium browsers) and falls back to a single-file picker elsewhere, so a folder still works everywhere by dragging it in.

A dropped folder is scanned recursively. Every `.jsonl` lands in the **Sessions** tab and every `.md` in the **Memory** tab, which only appears when there are memory files. The tree mirrors the folder structure, so dropping `~/.claude/projects` gives one folder per project with its sessions and its `memory/` files. Sessions are listed with the date range of the conversation, read by peeking at the head and tail of each file rather than parsing the whole thing, and their size on disk.

A session renders as numbered turns:

- The **user message** as chat. Any `<system-reminder>` blocks the CLI injected into it are folded into a collapsed System block so the text you typed stays readable.
- Any text Claude wrote before its first tool call, such as "let me check", as chat.
- One collapsed **activity** block summarizing what happened in the middle of the turn: tool calls with their inputs and results, thinking blocks, and any interstitial text. Tool results are cut at 6,000 characters with a click to show the rest, and errors are marked.
- The **closing text**, the actual answer, as chat.

A metadata bar shows the date range, working directory, git branch, CLI version, and permission mode, and a stats line at the bottom counts turns, tool calls, and duration. Memory files render their frontmatter (name, description, type) as a header above the markdown body. The theme follows the operating system.

## How a transcript is read

Anthropic documents the session file format as internal and version-unstable. The parser therefore runs on explicit schemas built to survive change rather than enforce it, all in [`apps/web/src/transcript/`](apps/web/src/transcript/):

- One zod/mini schema per known line type (24 of them), per content block (9), and for the user and assistant message shapes. zod/mini rather than full zod, which saved about 18 kB gzipped.
- A field is required only when the reader cannot function without it.
- Known shapes strip unknown keys from the typed value, and the drift walker reports them. Unknown line types and unknown block types fall through to loose catch-alls that keep every key, so the reader keeps working on a CLI it has never seen.
- A known type with a bad shape fails loudly instead of being quietly reclassified as unknown.
- [`conformance.ts`](apps/web/src/transcript/conformance.ts) asserts at compile time that every content block and message type in `@anthropic-ai/sdk` satisfies the schema, so an SDK release that renames a field the reader depends on fails `tsc` instead of failing at runtime.

The schema was verified drift-free against every transcript on hand from Claude Code 2.1.153 through 2.1.266 (1,250 files, 421k lines), plus the legacy `summary` line and per-message cost fields from earlier releases.

| Family | Line types | Notes |
| --- | --- | --- |
| Conversation | `user`, `assistant`, `system`, `attachment` | Share an envelope: `uuid`, `parentUuid`, `timestamp`, `sessionId`, and optional `cwd`, `version`, `gitBranch`, `isSidechain`, `agentId`. `system` subtypes and `attachment` kinds are tracked as known sets, so a new one is reported, not rejected. |
| Session metadata | `last-prompt`, `mode`, `permission-mode`, `atis-latch`, `ai-title`, `custom-title`, `agent-name`, `cost-state`, `queue-operation`, `pr-link`, `frame-link`, `bridge-session`, `artifact-comment-monitor`, `artifact-autoreact-ledger` | Session-scoped bookkeeping with no envelope. |
| File history | `file-history-snapshot`, `file-history-delta` | Backups behind the CLI's file-change tracking. |
| Forks | `fork-context-ref` | Points a forked agent at its parent session. |
| Workflow journal | `started`, `result` | Found under `subagents/workflows/wf_*`. |
| Legacy | `summary` | The title line from before `ai-title` existed. |

Content blocks are the Messages API set (`text`, `thinking`, `redacted_thinking`, `tool_use`, `tool_result`, `image`, `document`, `tool_reference`) plus Claude Code's own `fallback` marker for a mid-turn model switch.

## Drift scanner

`just drift` scans transcripts and reports everything the schema does not know about: line types, keys on known lines, content-block types, system subtypes, attachment kinds, and known lines that failed to parse. Each finding carries a count and the range of CLI versions it was seen under, so a new key can be dated. The report contains key names and counts only, never message content, which makes it safe to run over anything.

```sh
just drift                        # everything under ~/.claude/projects
just drift path/to/dir a.jsonl    # specific directories or files
just drift --json                 # machine-readable report
just drift --strict               # exit 1 on any finding
just drift --all                  # no 40-row cap per section
```

The scanner streams each file and splits on newline only. `node:readline` is the obvious tool and the wrong one: it also breaks on U+2028 and U+2029, which JSON permits unescaped inside strings, and real transcripts contain them.

After a Claude Code upgrade, run `just drift`, fold any findings into [`lines.ts`](apps/web/src/transcript/lines.ts) or [`blocks.ts`](apps/web/src/transcript/blocks.ts), and cover the new shape with a synthetic fixture in [`apps/web/test/`](apps/web/test/). Real transcripts carry private content and never belong in the repo.

## Development

Requirements: Node 24 (what CI's `lts/*` resolves to; anything from 22.18 on works, since the tests and the drift scanner run TypeScript directly through Node's built-in type stripping), pnpm 12, and optionally [just](https://github.com/casey/just).

```sh
pnpm install --frozen-lockfile
just dev
```

| Recipe | What it runs |
| --- | --- |
| `just dev` | Vite dev server for `apps/web` |
| `just build` | `tsc`, then `vite build` into `apps/web/dist` |
| `just check` | Typechecks the browser code and the Node-side scripts and tests |
| `just test` | `node --test` over the synthetic-fixture tests |
| `just drift [paths]` | The drift scanner described above |
| `just deploy` | Builds the site, then `cdk deploy --all` |
| `just infra synth`, `just infra diff` | CDK synth and diff without deploying |

Each recipe wraps a pnpm script in `apps/web` or `infra`, so `pnpm run <name>` in either package does the same thing.

```
apps/web/                 Vite + TypeScript, no framework
  src/main.ts             drop zone, folder picker, sidebar, view switching
  src/explorer.ts         folder scanning (File System Access API and drag-and-drop entries), file tree
  src/parser.ts           typed lines -> entries, tool results, session metadata
  src/renderer.ts         turns, activity folds, stats
  src/memory-viewer.ts    frontmatter and markdown for memory files
  src/transcript/         the schema: lines, message, blocks, parse, drift, conformance
  scripts/drift.ts        the drift CLI; scripts/jsonl.ts streams lines
  test/                   node --test, synthetic fixtures only
infra/                    AWS CDK: the site stack and the CI role stack
```

## Deployment

Two CDK stacks in [`infra/`](infra/), both pinned to one account in `us-east-1`:

- **SessionReaderStack** is the site: a private S3 bucket named for the domain, a CloudFront distribution reading it through origin access control, an ACM certificate validated through the `johncarmack.com` hosted zone, A and AAAA alias records, and a CloudFront Function that rewrites extensionless paths to `index.html`. A `BucketDeployment` uploads `apps/web/dist` and invalidates the distribution.
- **SessionReaderCiStack** is the deploy identity: an IAM role named `session-reader-github-deploy` that trusts GitHub's OIDC provider for pushes to `main` of this repository and is allowed to assume the CDK bootstrap roles. Its output is the value for the `AWS_DEPLOY_ROLE_ARN` repository variable.

[`deploy.yml`](.github/workflows/deploy.yml) runs on every push to `main` that touches something other than workflows, markdown, or gitignore files, and on manual dispatch. It assumes the role over OIDC, installs with a frozen lockfile, builds the site, and runs `cdk deploy --all`. The job is skipped entirely when the repository variable is unset, so a fork without AWS credentials stays green.

To stand this up in another account: change the domain and zone constants in [`session-reader-stack.ts`](infra/lib/session-reader-stack.ts), the account in [`bin/session-reader.ts`](infra/bin/session-reader.ts), and the repository and OIDC provider constants in [`session-reader-ci-stack.ts`](infra/lib/session-reader-ci-stack.ts). The OIDC subject pins the owner and repository by numeric ID as well as by name, so a transfer or rename means updating that constant and redeploying the CI stack. The account needs the GitHub OIDC provider and a CDK bootstrap already in place. Run `just deploy` once locally with your own credentials to create both stacks, set the role ARN output as the repository variable, and pushes to `main` take over from there.
