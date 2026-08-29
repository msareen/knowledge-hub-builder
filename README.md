# knowledge-hub-builder

<p align="center">
  <img src="images/demo.gif" alt="khb init in the shell, then an agent session: the ingest skill asks which bundle owns the material, runs khb ingest as a tool call, offers to catalog, writes the concept docs, then answers a question from them" width="600">
</p>

**KHB (Knowledge Hub Builder)** is a local, markdown-based knowledge base maintained with
Claude Code, Codex, or another coding agent.

Knowledge is divided into **bundles** owned by a person, team, project, or client. Each
bundle can contain many topics. A small outer index routes the agent to one bundle, and the
bundle index routes it to the relevant concept documents.

KHB keeps two jobs separate:

- `khb ingest` converts source files into markdown. It is mechanical and does not call a
  model.
- The agent catalogs that material into concepts, links, and indexes. This requires
  judgement and has no CLI command.

Full design: [SPEC.md](SPEC.md). Agent contract: [AGENTS.md](AGENTS.md). Common workflow
questions: [FAQ](document/faq.md).

## Quick Start

KHB requires [Bun](https://bun.sh).

```bash
bun install -g @msareen/knowledge-hub-builder
khb
```

On a machine with no hubs yet, `khb` walks you through the first one — where it lives, what
to call it, which agent opens it, and a first bundle. Every question has a default, so
holding Enter produces a working hub.

To do the same by hand:

```bash
khb init ~/my-knowledge --description "Personal knowledge"
cd ~/my-knowledge

khb new-bundle personal "My accounts, plans, records, and reference material"
```

Add sources to `bundles/personal/sources.yaml`:

```yaml
sources:
  - type: folder
    path: /absolute/path/to/documents
    exclude: [drafts/]      # optional — skip paths/globs before ingesting
  - type: files
    paths:
      - /absolute/path/to/one.pdf
      - /absolute/path/to/two.xlsx
  - type: web
    urls:
      - https://example.com/reference
```

Then either run the workflow directly:

```bash
khb ingest personal
```

or ask the agent:

> Ingest and catalog the personal bundle, then run the KHB lint.

The agent discovers the KHB workflow skills from the hub and performs the catalog pass
after ingestion.

Later, from any terminal, `khb` on its own takes you back to the hub and starts your agent
there — see [Moving between hubs](#moving-between-hubs).

## How It Works

### 1. Ingest

`khb ingest <bundle>` reads `sources.yaml` and writes extracted markdown under
`bundles/<bundle>/raw/`.

Supported out of the box, with no system tools and no further installation:

- text, markdown, CSV, JSON, and YAML
- PDF and DOCX
- ODT, XLSX, and PPTX
- OCR for images and scanned PDFs, applied automatically when a PDF has no text layer
- subtitle files (`.vtt`, `.srt`) — and a video or audio file with one beside it is read
  from the captions rather than transcribed, as one source rather than two

OCR ships with KHB: `@hyzyla/pdfium`, `sharp`, and `tesseract.js` are ordinary dependencies,
so installing KHB pulls them down whether or not you ever ingest a scan. That costs roughly
75 MB of WASM plus `sharp`'s native binaries — the price of an ingest that never stalls
waiting for a setup step.

One extractor is genuinely optional:

- audio and video transcription needs a transcriber on `PATH`. KHB prefers
  [`vno`](https://www.npmjs.com/package/@msareen/voice-notes-organizer)
  (`npm install -g @msareen/voice-notes-organizer`), which wraps whisper.cpp and installs
  its own ffmpeg and model, and falls back to `whisper` / `faster-whisper`
  (`pip install -U openai-whisper`). KHB checks `vno status` first: a vno that is installed
  but not yet set up leaves recordings pending with `run: vno setup` and holds up nothing
  else in the run. A recording that already has a `.vtt` or `.srt` beside
  it needs neither — those captions are read instead

Without it, KHB leaves a pending row in `log.md` and prints the required setup rather than
failing the run.

Every raw markdown file carries provenance:

```yaml
---
source: "/absolute/path/to/statement.pdf"
fetched: 2026-07-23T09:14:02Z
sha256: db2ee470c95d
extract_tool: "tesseract.js"
quality: low
---
```

`quality: low` means OCR or transcription may be inaccurate. The agent can return to the
original `source` during cataloging.

KHB also maintains `bundles/<bundle>/log.md`:

- unchanged source hashes are skipped on later runs;
- a source that moved or was renamed is recognised by its hash and its existing row is
  re-pointed at the new path, keeping its `raw` file and its `curated` value — it does not
  come back as a second row to catalog again;
- `raw` identifies the extracted file;
- an empty `raw` means extraction is pending;
- an empty `curated` means the raw file has not been cataloged.

Authenticated systems such as Confluence, Azure DevOps, or private git hosts remain an
agent integration boundary. Declare them in `sources.yaml`; the agent acquires them through
the available MCP server or CLI and preserves the same raw-file provenance shape.

### 2. Catalog

Ask the agent to catalog one bundle. It reads uncataloged rows from `log.md`, turns the raw
material into concept documents, and updates the bundle index.

A concept is one markdown file with OKF frontmatter:

```markdown
---
type: Playbook
title: Quarterly tax filing
description: Steps and deadlines for estimated quarterly tax.
tags: [tax, recurring]
---

# Steps

...

# Citations

- raw/folder/tax-notes.md
```

Only `type` is required. `title` and `description` are recommended. `tags`, when present,
must be a YAML list of strings.

The catalog workflow:

1. Reuses the bundle's existing vocabulary and directories.
2. Splits or merges source material by concept, not by source filename.
3. Links related concepts inside the same bundle.
4. Lists every concept in an `index.md`.
5. Fills the source row's `curated` value in `log.md`.
6. Runs `khb lint`.

When the runtime supports subagents, cataloging may process independent raw files in
parallel. The orchestrating agent remains the only writer of shared index and ledger files.

### 3. Query

Ask a question in natural language. The query workflow follows:

```text
outer.index.md -> bundles/<name>/index.md -> concept documents
```

The agent answers from curated concepts, not `raw/`. For a question that genuinely spans
bundles, it follows `refs.md` and enters the second bundle through its own index.

Indexes contain routing only. Knowledge belongs in concept documents.

## Bundles

A bundle is a unit of ownership, not a subject category. Examples:

- `personal`
- `team-payments`
- `client-acme`
- `project-atlas`

Create one only when you intend to:

```bash
khb new-bundle team-payments "Payments team roadmap, incidents, and vendor decisions"
```

KHB never creates, splits, or merges bundles based on their contents. Name the bundle when
you ingest: run `khb ingest` without one and it lists the hub's bundles and stops. Ask an
agent to ingest without naming a bundle and it asks you — existing bundle or new one, and for
an existing one whether to reuse the paths in its `sources.yaml` or take a new path. An
unnamed ingest lands somewhere by itself only when there is nothing to choose between: a hub
with no bundles gets a `default` bundle created on the spot, and a hub whose only bundle is
`default` uses it. Material moves out of `default` when you say who owns it.

Cross-bundle relationships belong in `refs.md`; concept documents must not link directly
into another bundle.

## Claude And Codex

KHB has one source of truth for agent behavior:

- `AGENTS.md` is the common contract. Codex loads it directly.
- `CLAUDE.md` imports `AGENTS.md` for Claude Code.
- `skills/<name>/SKILL.md` contains each canonical workflow.
- `.agents/skills/` contains Codex discovery adapters.
- `.claude/skills/` contains Claude discovery adapters.

The adapter files are small pointers, not copies of the workflows. Edit only the canonical
files under `skills/` when developing KHB.

`khb init` copies this managed contract into a hub. `khb upgrade` refreshes it without
changing `bundles/` or `outer.index.md`. `khb export` includes the same compatibility
layout in a standalone bundle export.

The refresh is also automatic: every command that works on a hub first compares the `khb`
version stamped in `khb.json` against the installed package, and upgrades the hub in place
if they differ, printing one line to stderr. So updating the package is enough — the hub's
contract docs can never be a version behind the CLI acting on them. Set
`KHB_NO_AUTO_UPGRADE=1` to suppress the check and leave the hub as it is.

## Commands

Commands can be run directly or requested through the matching agent skill.

| Command | Purpose |
|---|---|
| `khb init [dir] [--name N] [--description "…"]` | Create a hub |
| `khb upgrade` | Refresh package-owned contracts and skills (also runs automatically on version drift) |
| `khb new-bundle <name> ["scope"]` | Create and register a bundle |
| `khb ingest [bundle] [--force] [--skip-ocr] [--skip-audio]` | Acquire and extract declared sources |
| `khb lint` | Validate routing, bundle structure, and OKF metadata |
| `khb visualize [--port N] [--no-open]` (aliases: `vis`, `viz`) | Serve the live bundle graph on a random free port and open it in your default browser — pan/zoomable cross-bundle map, drill into a bundle for its folder-clustered concepts, rebuild-on-refresh, exits when you close the tab |
| `khb export <bundle> [dest]` | Export one standalone bundle |

Additional ingest flags:

- `--skip-ocr`
- `--skip-audio`

Run against a hub outside the current directory with `--hub <dir>` or `$KHB_HUB`.

### Moving between hubs

These four run **outside** any hub, from any terminal:

| Command | Purpose |
|---|---|
| `khb` | Open a hub. One registered hub asks; several show a list and take a pick; none walks you through creating the first |
| `khb list [--json]` | Every hub on this machine, with its description and path |
| `khb go <name\|N> [--path]` | Open one by name or list position. `--path` prints just the path, for `cd "$(khb go --path work)"` |
| `khb agent [name] [--command X] [--args "…"]` | Which agent `khb go` launches — `claude`, `codex`, anything on your PATH, or `none` to just print the path |
| `khb update [new-path] [--path\|-p] [--schema\|-s] [--from <old>] [--dry-run]` | Repair the hub: path references after a move, and/or backfill `sources.yaml` to the current schema. No flag runs both |
| `khb forget <name>` | Drop a hub from the list. The folder is untouched |

`khb go` prints the hub's path and then starts your agent there, so a bare `khb` from a
cold terminal ends with an agent open on the right folder. No program can change its
parent shell's directory, which is why the `cd` line is printed rather than performed.

The list lives in `~/.khb/hubs-config.json` (`%USERPROFILE%\.khb` on Windows). It holds
paths and one launch command — no knowledge — and fills itself in: any khb command run
inside a hub registers it, so hubs you already had show up without a migration step.
Delete the file and the next command in each hub puts it back.

A hub's name and description come from its own `khb.json`, so they travel with the hub
rather than living in one machine's list. Set them with `khb init --name --description`,
or edit those two keys in the marker later.

### `khb update` — repairing a hub

Two independent repairs, run together or apart:

```bash
khb update --dry-run    # what would change, both halves
khb update               # apply both
khb update --path        # only repoint paths after a move
khb update --schema      # only backfill sources.yaml to the current schema
```

**`--path`/`-p`** — after you move the folder, this repoints the shortcut list (a moved hub
shows as `MISSING` in `khb list` until you do) and rewrites the absolute paths recorded
*inside* the hub that named the old location: `sources.yaml` entries, `source:` headers in
`raw/`, `log.md` rows, `resource:` front matter. It needs no old path: the hub records where
it lives in its own `khb.json` (`path`), so any khb command run in a moved hub notices and
says so —

```
khb: this hub was at D:\kb\old and is now at D:\kb\new.
khb:   repair them:  khb update --path            (--dry-run to preview)
```

— and `--path` reads the old location straight out of the marker. That record travels with
the folder, so it works after `~/.khb` is deleted, on a second machine, or on a hub a
colleague handed you. Move a hub twice before repairing it and both former homes are
rewritten in one pass. For a hub last touched by a khb too old to have recorded a location,
the old path is worked out from the registry entry that now points at nothing, matched on
the identity stamp in `khb.json`. If it can't prove which entry that is, it asks; `--from
<old-path>` tells it outright.

The rewrite is a literal substitution with three guards: every spelling of the path moves
(native, forward-slashed, and JSON-escaped as `raw/` headers store it), each rewritten to
the same spelling of the new path; matches must end at a path boundary, so moving `…/old`
never touches a sibling `…/older`; and the new path is matched too and rewritten to itself,
which is what makes overlapping moves safe — lifting a hub out of its parent, or pushing it
down into a subdirectory of where it stood — and makes a second run a no-op.
`.git/`, `node_modules/` and the `.ingest-cache/` cache are skipped, as are binaries.

**`--schema`/`-s`** — a bundle's `sources.yaml` can predate a field khb's since learned about
(e.g. `exclude:`), with no way to discover it short of reading the docs. This backfills
missing optional fields with their default, per bundle, preserving your comments and
formatting. `khb upgrade` mentions when either half of `update` has something pending, as a
printed hint — it never runs `update` for you.

Both `khb update` and `khb ingest` state their whole plan before writing anything, then
report as they go — a position per file for work slow enough to matter, a live counter for
work that isn't. The counter goes to stderr, so redirected stdout stays clean.

Not to be confused with `khb upgrade`, which refreshes a hub's package-owned contract docs
and has nothing to do with moving anything.

To update the installed package:

```bash
bun update -g @msareen/knowledge-hub-builder
```

Each hub refreshes itself the next time you run any command in it. `khb upgrade` does the
same thing on demand, with a fuller report.

## Hub Layout

```text
khb.json
outer.index.md
AGENTS.md
CLAUDE.md
SPEC.md
skills/<name>/SKILL.md
.agents/skills/<name>/SKILL.md
.claude/skills/<name>/SKILL.md
bundles/<name>/
  index.md
  refs.md
  sources.yaml
  log.md
  <group>/<concept>.md
  raw/
```

The package owns the contract files and skill directories. You own `outer.index.md` and
everything under `bundles/`.

## Privacy

`raw/` and the extraction cache under `.ingest-cache/` are gitignored. `log.md` is committed and
records source paths, which may be absolute. Ignore `log.md` before the first commit if
those paths are sensitive.

`khb export` copies the complete bundle, including `log.md`.

KHB extraction runs locally and does not call a model. Agent cataloging and querying use
the model provider configured in Claude Code, Codex, or the active agent runtime.

## Development

This repository is both the npm package and a small KHB hub used to exercise the tooling.

```bash
bun install
bun run lint
bun scripts/cli.ts help
bun scripts/cli.ts init /tmp/scratch-hub
```

`khb.json`, `bundles/`, and `outer.index.md` are excluded from the published package by the
`files` allowlist in `package.json`.

## Lineage

KHB combines [Karpathy's LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
with [Google's Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf).
KHB adds the bundle router, cross-bundle reference rules, local ingestion tooling, and
standalone bundle export.
