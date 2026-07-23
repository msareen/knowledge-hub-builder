# knowledge-hub-builder

<p align="center">
  <img src="images/demo.gif" alt="Terminal demo: khb init creates a hub, new-bundle scaffolds a bundle, ingest pulls sources into raw/, an agent routes a question through outer.index.md to a concept doc, and khb lint reports 0 errors" width="544">
</p>

**KHB — Knowledge Hub Builder.**

A personal knowledge base you build *with* an agent and query *through* one.

Knowledge lives in independent **bundles** — one per owner: you, a team, a project, a
client — joined by a thin router. Each holds as many topics as its owner does.
An agent answers by routing — outer index → one bundle's index → concept docs — instead
of grepping the whole tree. Content is plain markdown, so nothing here is locked in.

- **Why bundles?** They stay small enough to read fully, never collide, and can be worked
  in parallel or exported to travel alone.
- **Why an agent?** Getting bytes into text is mechanical; deciding what the text means is
  judgement. `khb ingest` does the first and stops; the agent does the second.

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

Requires [Bun](https://bun.sh). Nothing else: PDF, DOCX, ODT, XLSX and PPTX extraction is
built in. Two optional add-ons cover the formats that genuinely need more —
`bun add @hyzyla/pdfium sharp tesseract.js` for OCR of scanned PDFs and images, and
`pip install -U openai-whisper` for audio and video. Without them those files are recorded
as pending rather than failing the run. `pdftotext` (poppler) / `pandoc` are used
automatically if present, but never required.

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

A bundle is a **logical unit you define** — yourself, a team, a project, a client. It is
not a subject: one bundle carries as many topics as its owner has, organized inside it with
subdirectories. Err toward *fewer, broader* bundles; a scope line listing several topics is
normal, not a signal to split.

```bash
khb new-bundle finances "Personal finances: accounts, budgets, tax"
khb new-bundle team-payments "Payments team: roadmap, incidents, vendor evals"
```

Nothing splits a bundle on its own. If you later want a slice carved out into its own
bundle, you ask for it — no ingest, catalog or query step will reorganize your bundles
behind your back.

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

### Step 3. Ingest — bytes to text

You never type `khb ingest` yourself — you ask in chat ("ingest the finances bundle"),
the `ingest` skill fires, and the agent runs the command on your behalf:

```
 you                    agent                          khb CLI              filesystem
  │  "ingest finances"    │                                │                     │
  ├──────────────────────▶│                                │                     │
  │                       │  loads skills/ingest/SKILL.md  │                     │
  │                       │                                │                     │
  │                       │  khb ingest finances           │                     │
  │                       ├───────────────────────────────▶│                     │
  │                       │                                │  read sources.yaml  │
  │                       │                                ├────────────────────▶│
  │                       │                                │  fetch/copy sources │
  │                       │                                ├────────────────────▶│
  │                       │                                │  extract everything:│
  │                       │                                │  pdf docx xlsx pptx │
  │                       │                                │  ocr images/scans   │
  │                       │                                │  whisper audio/video│
  │                       │                                ├────────────────────▶│
  │                       │                                │  write raw/*, log.md│
  │                       │                                ├────────────────────▶│
  │                       │◀───────────────────────────────┤ counts + what failed│
  │                       │                                │                     │
  │                       │  (Confluence/ADO/git only)     │                     │
  │                       │  pulls via MCP/CLI → raw/ ─────┼────────────────────▶│
  │◀──────────────────────┤  "N files in raw/, M pending"  │                     │
```

Everything lands in `bundles/finances/raw/` as markdown with a provenance header naming the
original file, the tool that read it, and whether the result is trustworthy:

```yaml
---
source: /abs/path/to/statement.pdf
fetched: 2026-07-23T09:14:02Z
sha256: db2ee470c95d
extract_tool: tesseract.js
quality: low          # OCR guessed at this — re-read the source if it looks wrong
---
```

That header is why ingest is its own step. Extraction is sometimes lossy, and the next step
must always be able to walk back to the original bytes rather than curating garbled text.

Every acquisition is written to `bundles/finances/log.md`, the ingest ledger. Re-running
skips sources whose content hash hasn't changed (`--force` overrides). Extracted text is
cached hub-wide by content hash, so the same PDF in two bundles converts once. `raw/` is
gitignored; `log.md` is committed, so the record survives deleting `raw/`.

**Ingest never interprets content.** It ends the moment the text exists.

### Step 4. Catalog — the part that matters

Ask the agent: **"catalog the finances bundle."**

`raw/` is not knowledge, it's evidence. Cataloging distills it into **concept docs** — one
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

Group files into whatever subdirectories fit (`accounts/`, `playbooks/`, `notes/`) —
structure carries no meaning.

#### The frontmatter schema

Frontmatter is the machine-readable half of a concept: it's what routing, filtering and any
index generator read, so `khb lint` validates it as data rather than glancing at it.

| Field | Required | Type | What it's for |
|---|---|---|---|
| `type` | **yes** | string, free-form | What kind of thing this is — `Metric`, `Playbook`, `Runbook`, `Decision Log`. No closed list; use your domain's words |
| `title` | recommended | string | Display name. Missing → lint warning |
| `description` | recommended | string | One line, reused verbatim in index entries. Missing → lint warning |
| `tags` | optional | **list of strings** | Filtering. Must be `[a, b]` — `"a, b"` is one opaque tag and lint errors on it |
| `resource` | optional | URI | Canonical location of the underlying asset, if there is one |
| `timestamp` | optional | ISO-8601 | When the concept was written or last held true |

Unknown keys are legal — OKF v0.1 is permissive — but lint warns on them, because `titel:`
is a typo that silently drops a field rather than failing loudly. Malformed YAML is an
error: a frontmatter block that doesn't parse loses *every* field at once.

This is [OKF v0.1](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf),
not a KHB invention, so your concepts stay readable by anything else that speaks OKF.

One raw file usually becomes *several* concepts: a 40-page contract is a dozen ideas, and
three meeting transcripts about one decision are a single idea. That splitting and merging
is the whole job, and it's why this step needs a model and step 3 doesn't. The agent fans
cheap Haiku subagents across the raw files to do it in parallel.

Then the two bookkeeping rules that make queries work:
- list each new doc in the bundle's `index.md` — **an unindexed doc is invisible to
  queries**, and lint will flag it;
- fill its `curated` column in `log.md`. Rows with an empty `curated` are your backlog.

Not every raw file deserves a concept doc. Most corpora are 80% receipts and boilerplate;
declining a file is a real outcome, recorded as `declined` in the ledger.

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

### The hub gets denser as you use it

Sometimes answering means joining two concepts that were never joined before — and that
join is worth more than the single answer it just produced. When the agent judges the
synthesis durable, it offers to keep it:

> *"Answering that meant combining `accounts/joint-account.md` with
> `playbooks/quarterly-tax.md`. Save it as `playbooks/joint-account-tax-split.md`, linked
> to both? "*

On yes it writes the concept, links it **both ways** so the original docs point at the
synthesis too, registers it in `index.md`, and records it in `log.md` with the question as
its source. Next time, the same question is answered directly from a doc.

It always asks. A knowledge base that silently accumulates restated one-off answers is
worse than one that stays thin.

Two symptoms worth acting on:
- **The agent picked the wrong bundle** → your "Route here when" hint in `outer.index.md`
  is weak. Fix it there.
- **The agent grepped to read rather than to route** → something isn't in an index. Fix the
  index, not the query.

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
| `khb ingest [bundle] [--force]` | acquire + extract declared sources → `raw/`, update `log.md` | `ingest` |
| `khb lint` | validate structure against [the L1–L9 rules](skills/lint/SKILL.md) | `lint` |
| `khb visualize` | regenerate `visualizer/graph.html` | `visualize` |
| `khb export <bundle> [dest]` | standalone copy that works alone with any agent | `export` |

Global flag: `--hub <dir>` runs a command against a hub you aren't standing in.
`khb ingest` also takes `--skip-ocr` and `--skip-audio` for a fast first pass over a corpus
full of scans or recordings. Its bundle argument is optional: with none it uses a `default`
bundle, creating it if the hub has none, so material always has somewhere to land when you
don't yet know which bundle should own it.

There is deliberately **no `khb catalog`**. Cataloging is pure judgement — reading a
document and deciding what ideas are in it — so it lives entirely in
[the catalog skill](skills/catalog/SKILL.md) with no command behind it. The dividing line
throughout: `khb` converts bytes to text, the agent decides what the text means.

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
