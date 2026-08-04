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

khb init ~/my-knowledge
cd ~/my-knowledge

khb new-bundle personal "My accounts, plans, records, and reference material"
```

Add sources to `bundles/personal/sources.yaml`:

```yaml
sources:
  - type: folder
    path: /absolute/path/to/documents
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

## How It Works

### 1. Ingest

`khb ingest <bundle>` reads `sources.yaml` and writes extracted markdown under
`bundles/<bundle>/raw/`.

Supported out of the box, with no system tools and no further installation:

- text, markdown, CSV, JSON, and YAML
- PDF and DOCX
- ODT, XLSX, and PPTX
- OCR for images and scanned PDFs, applied automatically when a PDF has no text layer

OCR ships with KHB: `@hyzyla/pdfium`, `sharp`, and `tesseract.js` are ordinary dependencies,
so installing KHB pulls them down whether or not you ever ingest a scan. That costs roughly
75 MB of WASM plus `sharp`'s native binaries — the price of an ingest that never stalls
waiting for a setup step.

One extractor is genuinely optional:

- audio and video transcription needs a `whisper` or `faster-whisper` executable on `PATH`
  (`pip install -U openai-whisper`)

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
| `khb init [dir]` | Create a hub |
| `khb upgrade` | Refresh package-owned contracts and skills (also runs automatically on version drift) |
| `khb new-bundle <name> ["scope"]` | Create and register a bundle |
| `khb ingest [bundle] [--force]` | Acquire and extract declared sources |
| `khb lint` | Validate routing, bundle structure, and OKF metadata |
| `khb visualize [--port N] [--no-open]` (aliases: `vis`, `viz`) | Serve the live bundle graph on a random free port and open it in your default browser — pan/zoomable cross-bundle map, drill into a bundle for its folder-clustered concepts, rebuild-on-refresh, exits when you close the tab |
| `khb export <bundle> [dest]` | Export one standalone bundle |

Additional ingest flags:

- `--skip-ocr`
- `--skip-audio`

Run against a hub outside the current directory with `--hub <dir>` or `$KHB_HUB`.

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

`raw/` and the extraction cache under `inbox/` are gitignored. `log.md` is committed and
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
