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

The whole path, and where the money goes. `khb` does the mechanical half — deterministic,
offline, contacts no model, costs nothing to run. An agent does the interpreting half, and
that is the half that spends tokens.

```
   MECHANICAL — khb only. Deterministic, offline, contacts no model, costs no tokens.
  ═══════════════════════════════════════════════════════════════════════════════════

   khb init
        │      the hub: khb.json · outer.index.md · bundles/
        ▼
   khb new-bundle <name> "<scope>"                                    ×N, as needed
        │      one bundle per *owner* — a person, a team, a client, a project.
        │      Topics live in subdirectories inside a bundle, not in bundles of
        │      their own. Name none and material lands in `default`.
        │      → index.md · refs.md · sources.yaml · log.md
        ▼
   edit bundles/<name>/sources.yaml                          ← your decision, one file
        │      folders, files, urls (+ optional exclude:). Nothing is copied yet.
        ▼
   khb ingest <bundle>
        │      every declared source → bundles/<name>/raw/*.md, one log.md row each
        │      text · PDF · DOCX · ODT · XLSX · PPTX · OneNote · OCR · whisper · captions
        │      files embedded in a document are unpacked and ingested in their own right
        │      re-runs skip anything whose content hash has not changed
        ▼
  ═══════════════════════════════════════════════════════════════════════════════════
   JUDGEMENT — an agent, following the skills in skills/. This is what spends tokens.
  ═══════════════════════════════════════════════════════════════════════════════════

   catalog        (no command — ask your agent to catalog the bundle)
        │      raw/*.md → concept docs with front matter, linked, listed in index.md,
        │      and log.md's `curated` column filled in
        │      COST scales with the corpus: every raw file is read once. The expensive
        │      step, and the only one that turns text into knowledge.
        ▼
   query          (no command — just ask)
        │      outer.index.md ─► one bundle's index.md ─► only the concepts it points at
        │      spanning two bundles: resolve in the first, follow refs.md, enter the
        │      second through its own index.md; join the answers in the reply.
        │      COST is bounded by routing, not by hub size — two hops, then a handful
        │      of files. That is what the router is for.
        ▼
     an answer, cited to concept docs (never to raw/)

   ANY TIME, MECHANICAL:  khb lint · khb doctor · khb visualize · khb export · khb upgrade
```

So: ingest as much as you like for free, spend judgement once per source when cataloging,
and per question when querying.

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

Two extractors are genuinely optional:

- audio and video transcription needs a transcriber on `PATH`. KHB prefers
  [`vno`](https://www.npmjs.com/package/@msareen/voice-notes-organizer)
  (`npm install -g @msareen/voice-notes-organizer`), which wraps whisper.cpp and installs
  its own ffmpeg and model, and falls back to `whisper` / `faster-whisper`
  (`pip install -U openai-whisper`). KHB checks `vno status` first: a vno that is installed
  but not yet set up leaves recordings pending with `run: vno setup` and holds up nothing
  else in the run. A recording that already has a `.vtt` or `.srt` beside
  it needs neither — those captions are read instead
- OneNote sections (`.one`) need
  [pyOneNote](https://github.com/DissectMalware/pyOneNote) on a local python
  (`pip install -U https://github.com/DissectMalware/pyOneNote/archive/master.zip`). KHB
  finds it on `python`, `python3` or `py`. One section becomes one markdown file: pages in
  section order as `##` headings, subpages nested by their own level, each page's current
  revision only, with tables, lists and creation timestamps. Files embedded in the notes are
  unpacked beside it, linked, and ingested as sources of their own — so an attached PDF is
  read at `quality: high` and an attached screenshot is OCR'd, each with its own ledger row.
  Ink and freeform layout are not recoverable, so the section text stays `quality: low`

Without them, KHB leaves a pending row in `log.md` and prints the required setup rather than
failing the run.

`khb init --with-onenote` will install pyOneNote for you at setup time — the one moment
you're asking KHB to prepare things. It is opt-in and forgiving in every direction: no
python, no pip, a distro python that refuses a global install (it retries with `--user`), no
network — any of those prints the `pip` line to run later and **still creates the hub**.
Nothing else in KHB ever installs software on its own; an ingest that finds no pyOneNote
pends those rows and tells you what to run.

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
| `khb doctor` | Read-only report: version, location, per-bundle counts, catalog backlog, transcriber |
| `khb visualize [--port N] [--no-open]` (aliases: `vis`, `viz`) | Serve the live bundle graph on a random free port and open it in your default browser — pan/zoomable cross-bundle map, drill into a bundle for its folder-clustered concepts, rebuild-on-refresh, exits when you close the tab |
| `khb export <bundle> [dest]` | Export one standalone bundle |

Run against a hub outside the current directory with `--hub <dir>` or `$KHB_HUB`.

Output is colour-coded when the stream is a terminal — headings, the commands you can
type next, paths, and the difference between an error, a warning and a clean result.
`NO_COLOR=1` turns it off, `FORCE_COLOR=1` keeps it through a pipe, and a redirected
stdout is plain text either way.

### `khb doctor` — what state is this hub in?

A single read-only report. It writes nothing and repairs nothing; each finding names the
command that does.

```text
Hub            name, description, stamped version vs installed, location, registered
Machine config where it is, the agent it names, how many hubs, schema findings
Bundles        per bundle: concepts, raw/ files, log.md rows, catalog backlog, pending
Extraction     which formats are bundled, and whether a transcriber is ready
Findings       what needs attention, each with its fix
```

Every check existed already, spread across the margins of commands that each knew one of
them — a move is announced by whatever you happen to run next, the `khb update` hint comes
out of `khb upgrade`, the uncurated row count out of `khb ingest`, and the transcriber probe
only ever spoke during a run that needed it. `doctor` asks for the whole picture without
changing anything to get it.

It is not a validator: `khb lint` still owns structure and OKF conformance, and `doctor`
points at it rather than repeating a rule.

### Moving between hubs

These run **outside** any hub, from any terminal:

| Command | Purpose |
|---|---|
| `khb` | Open a hub. One registered hub asks; several show a list and take a pick; none walks you through creating the first |
| `khb list [--json]` | Every hub on this machine, with its description and path |
| `khb go [name\|N] [--path] [--no-agent] [--agent X] [--respond\|-r] [--file\|-f <path>]` | Open one by name or list position. `--path` prints just the path, for `cd "$(khb go --path work)"`; `--no-agent` prints the path and the `cd` line without launching anything; `--agent X` launches `X` for this run only, leaving the configured default alone; `--respond`/`-r` (or naming a `--file`/`-f`) carries the session's answer back out as a file — see below |
| `khb agent [name\|none] [--command X] [--args "…"] [--respond-args "…"]` | Which agent `khb go` launches — `claude`, `codex`, anything on your PATH, or `none` to just print the path. `--respond-args` sets how that agent is re-invoked to continue a session for `khb go --respond` |
| `khb update [new-path] [--path\|-p] [--schema\|-s] [--from <old>] [--dry-run]` | Repair the hub: path references after a move, and/or backfill `sources.yaml` to the current schema. No flag runs both |
| `khb forget <name> [more…]` | Drop one or more hubs from the list. The folders are untouched. With no name it points you at `khb list` for the names |
| `khb config [view\|edit\|check\|fix\|path]` | The config file itself — see below |

`khb go` prints the hub's path and then starts your agent there, so a bare `khb` from a
cold terminal ends with an agent open on the right folder. No program can change its
parent shell's directory, which is why the `cd` line is printed rather than performed.

The list lives in `~/.khb/hubs-config.json` (`%USERPROFILE%\.khb` on Windows; `$KHB_HOME`
overrides the directory, for a portable install or a test run). It holds
paths and one launch command — no knowledge — and fills itself in: any khb command run
inside a hub registers it, so hubs you already had show up without a migration step.
Delete the file and the next command in each hub puts it back.

A hub's name and description come from its own `khb.json`, so they travel with the hub
rather than living in one machine's list. Set them with `khb init --name --description`,
or edit those two keys in the marker later.

### `khb go --respond` — carrying a session's answer back out

`khb go` spawns your agent with its working directory set to the hub, not to wherever you
ran `khb go` from — so when you close the session and land back in your own shell, nothing
from it comes with you. `--respond`/`-r` fixes that: once the interactive session ends,
khb re-invokes the same agent non-interactively, continuing that session, and asks it to
write a complete, coherent account of what was discussed — not a bullet summary — to a
file in the directory you originally ran `khb go` from. Name the file with `--file`/`-f`;
without one, khb generates `khb-response-<hub>-<timestamp>.md`. Naming a `--file` implies
`--respond` — you don't need both.

Leave off `-r` entirely and khb asks `Save a response to a file? [y/N]` after the session
closes (default no, and skipped on a non-interactive terminal). Pass `-f` alone to save to
that name without being asked.

How to continue a session non-interactively is per-agent and configurable via
`khb agent <name> --respond-args "…"` (shipped defaults: `claude -p --continue` and
`codex exec resume --last`). Anthropic's own docs note `--continue` in `-p` mode can
occasionally start a fresh session instead of truly resuming — a known flakiness in the
agent, not something khb can paper over.

The respond call never asks the agent to write a file at all — every attempt at that ran
into the same wall: a non-interactive continuation has no way to satisfy the one-time
approval most agents require for a file write, and that gate fires on any path the session
hasn't touched before, inside the hub or out. There's no file path that dodges it. Instead,
khb leans on what `-p`/`exec` print mode is actually built for: printing the final answer
to stdout, with no filesystem tool involved at all. The agent is asked to simply answer in
full, and khb captures that output itself and writes it to the destination — nothing for a
permission gate to block.

### `khb config` — the file itself

The list is plain JSON and always has been editable by hand. These five reach it without
hunting for the path, and say something when a hand edit has gone wrong:

```bash
khb config              # or 'view' — the path, the file, and a findings count
khb config edit         # open it in whatever this machine opens .json with
khb config check        # validate it against the schema
khb config fix          # repair what can be repaired mechanically
khb config fix --dry-run --prune   # preview; --prune also drops dead shortcuts
khb config path         # just the path, for cat "$(khb config path)"
```

The reason `check` exists: `loadConfig` is forgiving on purpose — it ignores keys it does
not know and treats an unparseable file as an empty one, so a damaged registry never
blocks `khb lint` in a hub that is fine. The cost is silence. A `defaultagent` typo does
nothing at all, a pasted duplicate makes `khb forget` look broken, and a stray comma
loses you every shortcut with no message anywhere. `check` names each of those, `fix`
repairs the mechanical ones — canonicalizing paths, merging duplicate entries, dropping
keys the schema does not define, re-deriving a name or description that has drifted from
the hub's own `khb.json` — and leaves anything needing a decision to you, with the
command that settles it.

`khb doctor` runs the same checks and prints the same fixes, so a hub health check covers
the machine config too. Doctor never writes; `khb config fix` is the half that does.

Two things `fix` will not do on its own: drop a shortcut whose folder has gone (that is
`--prune`, or `khb forget` — a missing path can be an unplugged drive, and a moved hub
wants `khb update --path`, not forgetting), and rename a hub. A name is re-derived from
each hub's own `khb.json` every time a command runs there, so renaming the entry would
be undone on the next command — the rename belongs in the marker.

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
