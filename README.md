# knowledge-hub-builder

<p align="center">
  <img src="images/demo.gif" alt="Terminal demo: khb init creates a hub, new-bundle scaffolds a topic, ingest pulls sources into raw/, an agent routes a question through outer.index.md to a concept doc, and khb lint reports 0 errors" width="544">
</p>

**KHB — Knowledge Hub Builder.**

A personal knowledge base you build *with* an agent and query *through* one.

Knowledge lives in independent **bundles** (one topic each) joined by a thin router.
An agent answers by routing — outer index → one bundle's index → concept docs — instead
of grepping the whole tree. Content is plain markdown, so nothing here is locked in.

- **Why bundles?** They stay small enough to read fully, never collide, and can be worked
  in parallel or exported to travel alone.
- **Why an agent?** Ingestion is bulk and mechanical; curation is judgement. The scripts
  do the first, the agent does the second.

Full design: [SPEC.md](SPEC.md). Agent contract: [AGENT.md](AGENT.md).

## Prior art

KHB is a synthesis of two existing ideas:

- **[Karpathy's LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)**
  — the operating model. Rather than RAG-ing raw documents on every query, the LLM
  *maintains* a markdown wiki: immutable raw sources, an LLM-curated wiki layer, and a
  schema telling it how to work, driven by three operations — ingest, query, lint.
  KHB keeps all of it: `raw/` is the immutable layer, concept docs are the wiki,
  `AGENT.md` is the schema, and the `ingest`/`query`/`lint` skills are the three
  operations.
- **[Google's Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf)**
  — the file format. A concept is any non-reserved `.md` file with `type` frontmatter;
  grouping is free-form subdirectories; `index.md` gives progressive disclosure;
  `index.md`/`log.md`/`refs.md` are reserved. Bundles are OKF v0.1 conformant.

What KHB adds is the **bundle-of-bundles** layer: many small wikis instead of one
growing one, joined by a router, with cross-bundle links allowed only through `refs.md`.
A single wiki gets slower to navigate and more collision-prone as it grows; bounded
bundles stay readable, parallelizable, and individually exportable.

## Setup

Requires [Bun](https://bun.sh). Nothing else: PDF, DOCX and ODT extraction is built in.
Optional, only for the formats that genuinely need more: `bun add @hyzyla/pdfium sharp
tesseract.js` for OCR of scanned PDFs, and `whisper` for audio/video transcription.
`pdftotext` (poppler) / `pandoc` are used automatically if present, but never required.

Install the tooling once:

```bash
bun install -g @msareen/khb
```

Then create a **hub** wherever the knowledge should live — OneDrive, a synced folder, a
shared drive, a private repo:

```bash
khb init ~/OneDrive/my-knowledge
cd ~/OneDrive/my-knowledge
khb lint                             # should print 0 errors
```

The two halves stay separate, and that separation is the point:

| | holds | who owns it |
|---|---|---|
| the **package** (`@msareen/khb`) | the CLI and the rules | upgraded with `bun update -g` |
| the **hub** (`khb init`) | `outer.index.md` + `bundles/` — your knowledge | you |

Nothing you write ever lands inside the package. `khb init` copies the agent contract
(`AGENT.md` plus the `skills/` protocols) into the hub, so an agent
opened on that folder finds its rules without knowing where `khb` is installed. Those
copies are package-owned — don't hand-edit them; `khb upgrade` refreshes them in place
and never touches `bundles/` or `outer.index.md`.

```
  npm registry                          your machine

  ┌────────────────────┐                ┌──────────────────────────────────────────┐
  │ @msareen/khb       │ bun install    │ khb CLI (global, on $PATH)               │
  │ (the package)      │ ───────▶       │                                          │
  │                    │ bun update     │ finds a hub by walking up to khb.json    │
  └────────────────────┘                └──────────────────────────────────────────┘
                                                            │
                                                            │ khb init <dir>
                                                            │ (copies contract docs in,
                                                            │  never copies your data out)
                                                            ▼
                  ┌──────────────────────────────────────────────────────────┐
                  │ the hub  (~/OneDrive/my-knowledge, a repo, ...)          │
                  │                                                          │
                  │ khb.json                 marker khb walks up to          │
                  │ CLAUDE.md → AGENT.md   ┐ contract, package-owned,        │
                  │ SPEC.md                ┤ refreshed by khb upgrade        │
                  │ skills/<name>/SKILL.md ┘                                 │
                  │ outer.index.md            router, you + agent maintain   │
                  │ bundles/<name>/           your knowledge, yours alone    │
                  │                                                          │
                  └──────────────────────────────────────────────────────────┘
```

Open the hub folder in Claude Code (or any agent) — `CLAUDE.md` → `AGENT.md` takes it
from there. Run `khb` from anywhere inside the hub; it finds the hub by walking up to
`khb.json`. From outside, pass `--hub <dir>` or set `$KHB_HUB`.

Your hub is a normal folder — `git init` it, sync it, or leave it be. Multiple hubs are
fine (personal + work); they don't know about each other.

---

## Tutorial 1 — build a knowledge base

### Step 1. Create a bundle

One bundle = one topic you'd want answered in isolation. Err toward *fewer, broader*
bundles at first; splitting later is cheap, merging is not.

```bash
khb new-bundle finances "Personal finances: accounts, budgets, tax"
```

This scaffolds `bundles/finances/` and registers it in `outer.index.md`. Fill in that
row's "Route here when" column — it's how the agent decides to enter this bundle, so
write it as a trigger ("question mentions money, budget, tax, a specific account"), not
as a description.

### Step 2. Point it at your sources

Edit `bundles/finances/sources.yaml`:

```yaml
sources:
  - type: folder
    path: /abs/path/to/finance-docs
  - type: web
    urls:
      - https://example.com/tax-guide
```

Nothing is copied yet — this only declares provenance.

### Step 3. Acquire

You never type `khb ingest` yourself — you ask in chat ("ingest the finances bundle"),
the `ingest` skill fires, and the agent runs the command on your behalf:

```
 you                    agent                          khb CLI              filesystem
  │  "ingest finances"    │                                │                     │
  ├──────────────────────▶│                                │                     │
  │                       │  loads skills/ingest/SKILL.md  │                     │
  │                       │  — the phases, in one file     │                     │
  │                       │                                │                     │
  │                       │  khb ingest finances           │                     │
  │                       ├───────────────────────────────▶│                     │
  │                       │                                │  read sources.yaml  │
  │                       │                                ├────────────────────▶│
  │                       │                                │  fetch/copy sources │
  │                       │                                ├────────────────────▶│
  │                       │                                │  write raw/*, log.md│
  │                       │                                ├────────────────────▶│
  │                       │◀───────────────────────────────┤ done + log summary  │
  │                       │                                │                     │
  │                       │  (scans + audio only) runs     │                     │
  │                       │  khb catalog --ocr / whisper ──┼────────────────────▶│
  │                       │                                │                     │
  │                       │  curates raw/ → concept docs ──┼────────────────────▶│
  │                       │  updates index.md + log.md     │                     │
  │                       │                                │                     │
  │                       │  khb lint                      │                     │
  │                       ├───────────────────────────────▶│                     │
  │◀──────────────────────┤  "0 errors, curated N docs"    │                     │
```

Text files land in `bundles/finances/raw/` with a `source:`/`fetched:` provenance header.
PDF, DOCX and ODT are extracted by `khb` itself and reused from the hash-keyed cache that
`khb catalog` fills, so nothing converts twice. Only the expensive formats stay explicit:
scanned PDFs need `khb catalog --ocr`, audio and video need a Whisper pass the agent runs —
see the table in the [ingest skill](skills/ingest/SKILL.md).

Every acquisition is written to `bundles/finances/log.md`, the ingest ledger. Re-running
skips sources whose content hash hasn't changed (`--force` overrides). `raw/` is
gitignored; `log.md` is committed, so the record survives deleting `raw/`.

### Step 4. Curate — the part that matters

Ask the agent: **"curate the finances bundle."**

`raw/` is not knowledge, it's evidence. Curation distills it into **concept docs** — one
idea per markdown file, anywhere in the bundle, with frontmatter:

```markdown
---
type: Playbook
title: Quarterly tax filing
description: Steps and deadlines for filing estimated quarterly tax.
tags: [tax, recurring]
---

# Steps
...

# Citations
- raw/folder/tax-notes.md
```

`type` is required; everything else is recommended. Group files into whatever
subdirectories fit (`accounts/`, `playbooks/`, `notes/`) — structure carries no meaning.

Then the two bookkeeping rules that make queries work:
- list each new doc in the bundle's `index.md` — **an unindexed doc is invisible to
  queries**, and lint will flag it;
- fill its `curated` column in `log.md`. Rows with an empty `curated` are your backlog.

Not every raw file deserves a concept doc. Curate selectively.

### Step 5. Verify

```bash
khb lint        # structure, frontmatter, index coverage, ref targets
khb visualize   # → visualizer/graph.html, bundles as nodes, refs as edges
```

Fix every lint error before moving on. Warnings are advisory.

### Step 6. When a second bundle is involved

Bundles never link into each other inline — that's a lint error. If `finances` needs
something from `travel`, add a row to `bundles/finances/refs.md` naming the bundle and
the reason. Queries follow refs; content stays put.

---

## Tutorial 2 — query it

Just ask in natural language: **"what's my quarterly tax deadline?"**

The agent follows the [query skill](skills/query/SKILL.md): `outer.index.md` picks exactly one bundle, that
bundle's `index.md` routes to concept docs, and the answer comes from concept docs only —
never from `raw/` — with file paths cited.

For a cross-bundle question ("how did travel spending affect my Q3 budget?") it resolves
one side fully, follows `refs.md` into the other bundle **through that bundle's own
index**, and joins the two answers in its response rather than in the files.

Two symptoms worth acting on:
- **The agent picked the wrong bundle** → your "Route here when" hint in `outer.index.md`
  is weak. Fix it there.
- **The agent grepped instead of navigating** → something isn't in an index. Fix the
  index, not the query.

---

## Bulk ingest — when you don't know the bundles yet

The flow above is bundle-first. Dumping a large mixed corpus (a whole Documents folder)
is the reverse: the bundle set is an *output* of looking at the data.

```bash
khb triage /abs/path/to/corpus      # indexes IN PLACE — copies 0 bytes
```

This writes `inbox/manifest.jsonl` (path, size, sha256, head snippet per file) and reports
duplicate groups by content hash. The agent reads the manifest — snippets only, not the
corpus — proposes a bundle set, you approve, then:

```bash
khb new-bundle <each approved bundle>
# agent writes inbox/routing.yaml assigning paths to bundles
khb route                            # merges into each bundle's sources.yaml
khb ingest <bundle>                  # then per bundle, as in Tutorial 1
```

`inbox/` is gitignored scratch. A file appearing under two bundles gets one owner plus a
`refs.md` entry — never a second copy. Details in the
[ingest skill](skills/ingest/SKILL.md).

---

## Commands

### You run this one

There's no hub yet for a skill to live in, so this is the one command you (or the
agent, if you just ask in chat) run directly instead of through a skill:

| Command | Purpose |
|---|---|
| `khb init [dir]` | create a hub (default: current directory) |

### The agent runs the rest, via skills

Once a hub exists, `AGENT.md` + `skills/` are in place, and every other command is
triggered by the matching skill (see [skills/](skills)), each one a single self-contained
`SKILL.md` holding its whole protocol — the agent runs the `khb`
CLI on your behalf. You never type these yourself:

| Command | Purpose | Skill |
|---|---|---|
| `khb upgrade` | refresh the hub's package-owned contract docs after a `khb` update | — (run ad hoc when you ask to update) |
| `khb new-bundle <name> ["scope"]` | scaffold a bundle + register it in `outer.index.md` | `new-bundle` |
| `khb ingest <bundle> [--force]` | acquire declared sources → `raw/`, update `log.md` | `ingest` |
| `khb triage <path...>` | index a bulk corpus in place → `inbox/manifest.jsonl` | `ingest` |
| `khb route` | apply `inbox/routing.yaml` → each bundle's `sources.yaml` | `ingest` |
| `khb lint` | validate structure against [the L1–L9 rules](skills/lint/SKILL.md) | `lint` |
| `khb visualize` | regenerate `visualizer/graph.html` | `visualize` |
| `khb export <bundle> [dest]` | standalone copy that works alone with any agent | `export` |

Global flag: `--hub <dir>` runs a command against a hub you aren't standing in.

## Hub layout

```
khb.json              the marker — how khb recognises this folder as a hub
outer.index.md        the router — bundles only, no knowledge
AGENT.md              common contract every agent reads first        ┐ package-owned,
SPEC.md               the full design                                ┤ refreshed by
skills/<name>/SKILL.md  one self-contained protocol per workflow,    ┘ `khb upgrade`
                        also injected into exports
bundles/<name>/
  index.md            routing into this bundle (routing only, no content)
  refs.md             the only way out of this bundle
  sources.yaml        declared ingestion sources
  log.md              ingest ledger: source → hash → raw → curated
  <group>/*.md        concept docs
  raw/                uncurated acquired material (gitignored)
```

## Working on KHB itself

This repo is the package. It is also its own hub — `khb.json` at the root, with
`bundles/meta/` holding KHB's design decisions and backlog — so the tooling can be
exercised in place:

```bash
bun install
bun run lint                         # == khb lint, against this repo's own hub
bun scripts/cli.ts init /tmp/scratch-hub   # try the CLI without installing it
```

`khb.json`, `bundles/` and `outer.index.md` are excluded from the published tarball by
the `files` allowlist in `package.json` — the package ships no knowledge.

## Privacy

`raw/` and `inbox/` are gitignored. `log.md` **is committed and records absolute source
paths** — if those paths are themselves sensitive, gitignore it before your first commit.
`khb export` copies the whole bundle directory, `log.md` included.
