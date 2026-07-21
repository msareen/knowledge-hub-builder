# khb

**KHB — a knowledge hub builder.**

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
  `AGENT.md` is the schema, and `ingest.md`/`query.md`/`lint.md` are the three operations.
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

That hub already contains `bundles/main/` — the **primary bundle**. Everything lands there
unless you say otherwise, so there is nothing to design before your first ingest.

The two halves stay separate, and that separation is the point:

| | holds | who owns it |
|---|---|---|
| the **package** (`@msareen/khb`) | the CLI and the rules | upgraded with `bun update -g` |
| the **hub** (`khb init`) | `outer.index.md` + `bundles/` — your knowledge | you |

Nothing you write ever lands inside the package. `khb init` copies the agent contract
(`AGENT.md`, `query.md`, `ingest.md`, `lint.md`, `skills/`) into the hub, so an agent
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
                  │ query.md / ingest.md   ┤ refreshed by khb upgrade        │
                  │ lint.md / skills/       ┘                                │
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

### Step 1. Pick a bundle

One bundle = one topic you'd want answered in isolation. Err toward *fewer, broader*
bundles; splitting later is cheap, merging is not. You already have `main`, and using it is
a fine answer — create a second bundle when a topic is clearly its own thing from the start:

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
  │                       │  reads ingest.md for the plan  │                     │
  │                       │                                │                     │
  │                       │  khb ingest finances            │                     │
  │                       ├───────────────────────────────▶│                     │
  │                       │                                │  read sources.yaml  │
  │                       │                                ├────────────────────▶│
  │                       │                                │  fetch/copy sources │
  │                       │                                ├────────────────────▶│
  │                       │                                │  write raw/*, log.md│
  │                       │                                ├────────────────────▶│
  │                       │◀───────────────────────────────┤ done + log summary  │
  │                       │                                │                     │
  │                       │  (scans + audio only) runs      │                     │
  │                       │  khb extract --ocr / whisper ───┼────────────────────▶│
  │                       │                                │                     │
  │                       │  curates raw/ → concept docs ───┼────────────────────▶│
  │                       │  updates index.md + log.md      │                     │
  │                       │                                │                     │
  │                       │  khb lint                        │                     │
  │                       ├───────────────────────────────▶│                     │
  │◀──────────────────────┤  "0 errors, curated N docs"     │                     │
```

Text files land in `bundles/finances/raw/` with a `source:`/`fetched:` provenance header.
PDF, DOCX and ODT are extracted by `khb` itself and reused from a hash-keyed cache, so
nothing converts twice (`khb extract` can fill that cache ahead of time when you want to
find unreadable files before committing a corpus). Only the expensive formats stay explicit:
scanned PDFs need `khb extract --ocr`, audio and video need a Whisper pass the agent runs —
see the table in [ingest.md](ingest.md).

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

The agent follows [query.md](query.md): `outer.index.md` picks exactly one bundle, that
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

The flow above is bundle-first. Dumping a large mixed corpus (a whole Documents folder) is
the reverse — and the answer is *don't decide yet*:

```bash
khb triage /abs/path/to/corpus      # indexes IN PLACE — copies 0 bytes
khb ingest main                     # acquire it, then curate as in Tutorial 1
```

Triage writes `inbox/manifest.jsonl` (path, size, sha256, head snippet per file), reports
duplicate groups by content hash, and merges the readable files into the primary bundle's
`sources.yaml`. No bundle set, no routing file, no clustering pass.

The distinctions get made where you actually have the evidence — in the concept docs, at
curation time:

```yaml
---
type: BigQuery Table
title: Orders
description: One row per completed customer order.
tags: [sales, revenue]
---
```

A tag costs nothing and can be rewritten once you've read the material; a bundle costs an
index, a `sources.yaml`, a `refs.md` and a routing line. So tags come first — and later,
when the bundle has grown mixed, you re-catalog it and let the evidence pick the split:

```bash
khb recatalog main                      # tag + link census of the curated bundle
```
```
  tag                  docs  closure  types / co-occurs
  sales                14    14       BigQuery Table, Metric  |  revenue(9)
  ops                  3     31 (+28) Runbook  |  sales(1)
```

Read the **closure**, not the doc count: concept docs link to each other, so pulling a tag
pulls what it links to, and what those link to. `sales` closes on itself — it is a bundle.
`ops` would drag 28 unrelated docs with it — it is a thread through this bundle, so it stays
a tag. When one closes cleanly:

```bash
khb split main sales-analytics --tag sales            # dry run: shows exactly what moves
khb split main sales-analytics --tag sales --apply
```

That moves the docs, both `index.md` files, `refs.md` in both directions, and the `log.md`
rows, `raw/` files and `sources.yaml` paths whose provenance moved with them — with every
link intact, because whole components move.

The only up-front choice worth making is a boundary that already exists — a client, a
confidentiality level, a corpus two agents will work in parallel:

```bash
khb triage /abs/path/to/corpus --to client-b
```

There is no clustering step and no routing file: KHB once shipped one (machine-labeled
snippets → a proposed bundle set) and it was removed, because it decided the most important
thing from the weakest evidence available. `inbox/` is gitignored scratch. A file appearing under two bundles gets one owner plus a
`refs.md` entry — never a second copy. Details in [ingest.md](ingest.md).

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
triggered by the matching skill (see [skills/](skills)) — the agent runs the `khb`
CLI on your behalf. You never type these yourself:

| Command | Purpose | Skill |
|---|---|---|
| `khb upgrade` | refresh the hub's package-owned contract docs after a `khb` update | — (run ad hoc when you ask to update) |
| `khb new-bundle <name> ["scope"]` | scaffold a bundle + register it in `outer.index.md` | `new-bundle` |
| `khb ingest <bundle> [--force]` | acquire declared sources → `raw/`, update `log.md` | `ingest` |
| `khb triage <path...> [--to <bundle>]` | index a bulk corpus in place → primary bundle's `sources.yaml` | `ingest` |
| `khb extract [--ocr]` | pre-convert a triaged corpus into the extraction cache | `ingest` |
| `khb recatalog [bundle]` | tag + link-graph census of a curated bundle → `inbox/recatalog/` | `recatalog` |
| `khb split <from> <new> --tag T` | promote a tag into its own bundle, link closure intact | `recatalog` |
| `khb lint` | validate structure against [lint.md](lint.md) | `lint` |
| `khb visualize` | regenerate `visualizer/graph.html` | `visualize` |
| `khb export <bundle> [dest]` | standalone copy that works alone with any agent | `export` |

Global flag: `--hub <dir>` runs a command against a hub you aren't standing in.

## Hub layout

```
khb.json              the marker — how khb recognises this folder as a hub
outer.index.md        the router — bundles only, no knowledge
AGENT.md              common contract every agent reads first        ┐ package-owned,
query.md / ingest.md / lint.md    protocols, also injected into exports │ refreshed by
skills/               thin agent-facing pointers at the protocols above ┘ `khb upgrade`
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
