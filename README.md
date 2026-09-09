# session-reader

Claude Code writes every session to a `.jsonl` under `~/.claude/projects/<project>/`, with its memory markdown next door. Good luck reading one raw. Drop it here instead, or drop the whole folder, and get a conversation with each turn's tool calls and thinking folded under the answer. Live at [session-reader.johncarmack.com](https://session-reader.johncarmack.com/).

Nothing leaves the browser. The site is static files on S3 behind CloudFront, and there is no backend to send anything to. Dropped files are read with the File API and uploaded nowhere. The only outbound requests are the page's own assets and one Google Fonts stylesheet. A transcript is your code and your half-finished thoughts. It stays on your machine.

## Using it

Drop a `.jsonl` on the landing page, or drop a folder. Drag-and-drop works in every current browser. **Browse** opens a folder picker where the File System Access API exists (Chromium) and a single-file picker everywhere else, so on Safari and Firefox, drag the folder in.

A folder is scanned recursively. Every `.jsonl` goes in the **Sessions** tab and every `.md` in the **Memory** tab, which only shows up when there are memory files. The tree mirrors the folder, so dropping all of `~/.claude/projects` gives one node per project with its sessions and its `memory/`. Each session shows the date range of the conversation (read from the head and tail of the file, not by parsing the whole thing) and its size on disk.

A session renders as numbered turns:

- Your **message**, as chat. Any `<system-reminder>` the CLI injected into it is folded into a collapsed System block, so what you typed stays readable.
- Whatever Claude said before its first tool call ("let me check"), as chat.
- One collapsed **activity** block for the middle of the turn: tool calls with inputs and results, thinking, any text in between. Tool results cut at 6,000 characters with a click for the rest. Errors are marked.
- The **closing text**, the actual answer, as chat.

A metadata bar shows the date range, working directory, git branch, CLI version, and permission mode. A stats line at the bottom counts turns, tool calls, and duration. Memory files render their frontmatter (name, description, type) as a header over the markdown. The theme follows your OS.

## How a transcript is read

Anthropic calls the session format internal and says it can change without notice. I believe them. So the schemas in [`apps/web/src/transcript/`](apps/web/src/transcript/) expect to be wrong about the next release, and are built to report the difference instead of dying on it:

- One zod/mini schema per known line type (24), per content block (9), and for the user and assistant message shapes. zod/mini instead of full zod saved about 18 kB gzipped.
- A field is required only when the reader cannot work without it.
- Known shapes strip unknown keys from the typed value, and the drift walker reports them. Unknown line types and block types fall through to loose catch-alls that keep every key, so the reader keeps working on a CLI it has never seen.
- A known type with a bad shape fails loudly. It is never quietly reclassified as unknown.
- [`conformance.ts`](apps/web/src/transcript/conformance.ts) asserts at compile time that every content block and message type in `@anthropic-ai/sdk` satisfies the schema. An SDK release that renames a field the reader depends on fails `tsc`, not the page.

Verified drift-free against every transcript I have from Claude Code 2.1.153 through 2.1.266 (1,250 files, 421k lines), plus the legacy `summary` line and the per-message cost fields from older releases.

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

`just drift` reads transcripts and reports everything the schema doesn't know: line types, keys on known lines, block types, system subtypes, attachment kinds, and known lines that failed to parse. Each finding carries a count and the range of CLI versions it was seen under, so a new key can be dated. The report is key names and counts. Never content. Run it over anything.

```sh
just drift                        # everything under ~/.claude/projects
just drift path/to/dir a.jsonl    # specific directories or files
just drift --json                 # machine-readable report
just drift --strict               # exit 1 on any finding
just drift --all                  # no 40-row cap per section
```

The scanner streams each file and splits on newline only. `node:readline` is the obvious tool and the wrong one: it also breaks on U+2028 and U+2029, which JSON permits unescaped inside strings, and real transcripts contain them.

After a Claude Code upgrade: `just drift`, fold the findings into [`lines.ts`](apps/web/src/transcript/lines.ts) or [`blocks.ts`](apps/web/src/transcript/blocks.ts), and cover the new shape with a synthetic fixture in [`apps/web/test/`](apps/web/test/). Real transcripts never go in the repo. Private content, see above.

## Development

Node 24 (what `lts/*` resolves to in CI; 22.18 or later works, since the tests and the scanner run TypeScript straight through Node's type stripping), pnpm 12, and [just](https://github.com/casey/just) if you want the recipes.

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

Every recipe wraps a pnpm script in `apps/web` or `infra`. `pnpm run <name>` in either package does the same thing.

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

[`ci.yml`](.github/workflows/ci.yml) typechecks both packages on every pull request and every push to `main`. That's the whole check for now.

## Deployment

Two CDK stacks in [`infra/`](infra/), pinned to one account in `us-east-1`:

- **SessionReaderStack** is the site: a private S3 bucket named for the domain, a CloudFront distribution reading it through origin access control, an ACM certificate validated through the `johncarmack.com` zone, A and AAAA aliases, and a CloudFront Function that rewrites extensionless paths to `index.html`. A `BucketDeployment` uploads `apps/web/dist` and invalidates the distribution.
- **SessionReaderCiStack** is the deploy identity: an IAM role, `session-reader-github-deploy`, that trusts GitHub's OIDC provider for pushes to `main` of this repo and may assume the CDK bootstrap roles. Its output is the value for the `AWS_DEPLOY_ROLE_ARN` repository variable.

[`deploy.yml`](.github/workflows/deploy.yml) runs on every push to `main` that touches something other than workflows, markdown, or gitignore files, and on manual dispatch. It assumes the role over OIDC, installs with a frozen lockfile, builds, and runs `cdk deploy --all`. If the repository variable is unset the job is skipped, so a fork with no AWS account stays green.

To run this in your own account: change the domain and zone in [`session-reader-stack.ts`](infra/lib/session-reader-stack.ts), the account in [`bin/session-reader.ts`](infra/bin/session-reader.ts), and the repository and OIDC provider constants in [`session-reader-ci-stack.ts`](infra/lib/session-reader-ci-stack.ts). The OIDC subject pins owner and repo by numeric ID as well as by name, so a transfer or rename means updating that constant and redeploying the CI stack. The account needs the GitHub OIDC provider and a CDK bootstrap already. Run `just deploy` once with your own credentials to create both stacks, set the role ARN output as the repository variable, and pushes to `main` take it from there.
