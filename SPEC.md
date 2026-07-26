# KHB — Specification

**KHB — Knowledge Hub Builder.** Distributed as
`@msareen/knowledge-hub-builder`. Install the tooling once; run `khb init` wherever the knowledge should
live (OneDrive, a shared drive, a private repo) to create a **hub**. KHB supplies the
rules and tooling and holds no knowledge; the hub holds all of it and is yours.

A personal knowledge system built as a **bundle of bundles**: independent knowledge bundles
joined by a thin router, navigable by any coding/knowledge agent (Claude, Codex, or other).
The common contract and canonical workflows are agent-agnostic. Runtime-specific shims
only handle discovery: Codex reads `AGENTS.md` and `.agents/skills/`; Claude imports the
contract through `CLAUDE.md` and discovers `.claude/skills/`.

Lineage: the operating model (immutable raw sources → LLM-curated wiki → schema, driven
by ingest/query/lint) is [Karpathy's LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f);
the file format is [Google's OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) v0.1.
KHB's own contribution is the bundle-of-bundles layer over both — see §1.

## 1. Core ideas

1. **Bundle** — a self-contained *logical* unit owning its content and ingestion sources.
   What makes a bundle is a human decision about ownership, not a classification of subject
   matter: a person, a team, a client, a project. One bundle holds as many topics as its
   owner has — a team bundle carries its roadmap, its incidents and its vendor notes
   together, grouped by subdirectory, because they share a custodian and a context.
   Bundles are never split automatically; splitting is an explicit instruction, never a
   default behavior of ingest, catalog or query.
   Bundles are *lean*: the common rules (AGENTS.md and the `skills/` protocols) live once
   at the hub root, not duplicated per bundle. When a bundle must travel alone,
   `khb export <bundle>` produces a standalone folder with the common patterns
   injected — independence on demand rather than boilerplate everywhere.
2. **Bundle of bundles** — the hub root is itself a bundle whose content is *routing*, not
   knowledge. `outer.index.md` is the router: it points at bundles and larger topics, and
   details route downward into a bundle's own `index.md`.
3. **No collation by copying** — when two topics must be combined, content is never merged
   across bundles. Instead: the requesting bundle records a **reference** (`refs.md`), and the
   query resolves by *querying into* the other bundle. This keeps bundles independent and
   collision-free. Two agents can work the two bundles in parallel and join results at the end.
4. **Ingest, don't wiki-sprawl** — external material (folders on disk, Confluence, Azure
   DevOps, internet links) is pulled *into* a bundle by ingesters rather than being linked as
   living parts of the wiki. The wiki stays canonical; sources are provenance.
5. **Acquisition and interpretation are separate steps.** `khb ingest` converts bytes to
   markdown in `raw/` and stops. `catalog` — an agent pass, no command — turns that text
   into concepts. Splitting them means a bad extraction is a re-run, not a re-think, and
   every concept traces back through a provenance header to the original file.
6. **Extract to markdown, locally** — binary/opaque formats (PDF, DOCX, XLSX, images,
   audio) are converted to markdown so every bundle's knowledge is plain, greppable text.
   Every extractor is local and deterministic: pure-JS libraries, tesseract WASM, whisper.
   Lossy routes (OCR, ASR) are marked `quality: low` rather than hidden.
7. **Bun** is the scripting language for all tooling and third-party interfaces.

## 2. Two directories, one of them yours

KHB is two things that must not be confused: an installed **package** (tooling, no
knowledge) and a **hub** (knowledge, no tooling). Nothing you write ever lands in the
package, and the package is never a place to keep bundles.

### 2a. The hub — created by `khb init`, lives wherever you want

```
my-knowledge/                  # ~/OneDrive/my-knowledge, a private repo, a share…
├── khb.json            # THE MARKER — how `khb` finds this hub; records its version
├── outer.index.md             # THE router — bundle-of-bundles index
├── bundles/
│   └── <bundle>/              # OKF bundle, lean: content + routing, no agent boilerplate
│       ├── index.md           # OKF index: progressive disclosure of this bundle
│       ├── refs.md            # cross-bundle references (the ONLY way out of a bundle)
│       ├── sources.yaml       # ingestion sources for this bundle
│       ├── log.md             # ingest ledger: source → sha256 → raw → curated
│       ├── <group>/           # free-form subdirectories of concept .md files
│       │   ├── index.md       #   (each may carry its own index)
│       │   └── <concept>.md
│       └── raw/               # ingested/extracted material, pre-curation (gitignored)
├── inbox/extracted/           # hub-wide extraction cache, keyed by content hash (gitignored)
├── visualizer/graph.html      # generated
│
│   ── below: package-owned copies, refreshed by `khb upgrade`, never hand-edited ──
├── AGENTS.md                  # common contract; Codex discovers this directly
├── CLAUDE.md                  # Claude shim — imports AGENTS.md
├── .agents/skills/<name>/     # Codex discovery adapter → canonical skill
├── .claude/skills/<name>/     # Claude discovery adapter → canonical skill
├── SPEC.md                    # this file
└── skills/<name>/SKILL.md     # one self-contained workflow protocol per folder:
                               #   query      routing, reading, and query-time learning
                               #   ingest     acquire + extract → raw/ (mechanical)
                               #   catalog    raw/ → concept docs (subagent fan-out)
                               #   lint       structural rules L1–L9
                               #   new-bundle / export / visualize
```

The contract docs are *copied into* the hub rather than read from the package because an
agent is opened on the hub folder and must find its rules there, without knowing where
`khb` is installed. They are package-owned: `khb upgrade` overwrites them in place and
leaves `bundles/` and `outer.index.md` alone.

### 2b. The package — `@msareen/knowledge-hub-builder`, installed once

```
@msareen/knowledge-hub-builder/
├── package.json               # bin: khb → scripts/cli.ts
├── scripts/
│   ├── cli.ts                 # subcommand dispatch; owns the global --hub flag
│   ├── init.ts                # khb init / khb upgrade
│   ├── new-bundle.ts          # scaffold from .bundle_template, register in outer.index.md
│   ├── export.ts              # bundle + common patterns → standalone shareable folder
│   ├── lint.ts                # enforce skills/lint/SKILL.md across the hub
│   ├── visualize.ts           # emit visualizer/graph.html from indexes + refs
│   ├── ingest/                # folder.ts / files.ts / web.ts → acquire.ts → bundle/raw
│   └── lib/
│       ├── extract.ts         # every local extractor + the content-hash cache
│       ├── ledger.ts          # log.md read/write
│       ├── paths.ts           # package-side paths — importing it never needs a hub
│       └── util.ts            # hub resolution + shared helpers
├── .bundle_template/          # copied by `khb new-bundle`
├── templates/hub/             # copied by `khb init`
└── AGENTS.md, skills/, …      # the masters that `khb init`/`upgrade` copy into hubs
```

### 2c. Hub resolution

`khb` locates the hub in this order, and refuses to guess if none is found:

1. `--hub <dir>` on the command line;
2. `$KHB_HUB`;
3. the nearest ancestor of the working directory containing `khb.json`.

Rule 3 is the normal path: `cd` anywhere inside the hub and run `khb lint`. One
consequence worth stating — a hub is identified by its marker file, not its name, so
hubs may be renamed or moved freely, and nested hubs resolve to the innermost one.

## 3. Routing model

- `outer.index.md` lists every bundle with a one-line scope and "route here when" hints.
  It contains **no knowledge**, only routing. An agent always starts at `AGENTS.md`, which
  sends it to `outer.index.md`, which sends it into exactly one bundle.
- Inside a bundle, `index.md` routes to concept docs and subdirectory indexes
  (progressive disclosure, OKF §6). Same rule: index = routing only.
- Keep hops shallow: outer index → bundle index → (subdirectory index →) concept.
  If a bundle needs deep index chains, consider splitting it into two bundles.

## 3b. Concept model (OKF v0.1)

Bundle content follows the [Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) v0.1:

- A **concept** is any non-reserved `.md` file in the bundle — not a special folder.
  Concept ID = its path without `.md`. It may describe a tangible asset (table, API)
  or an abstract idea (metric, decision, playbook).
- **Front matter**: `type` required (free-form, e.g. `Metric`, `Playbook`); `title`,
  `description`, `resource`, `tags`, `timestamp` recommended; extra keys allowed.
- **Grouping** is free-form subdirectories chosen per domain (`tables/`,
  `references/metrics/`, `notes/`, …) — structure carries no fixed semantics.
- **Indexes**: `index.md` may appear in any directory for progressive disclosure
  (`* [Title](path.md) - description`). `log.md` optionally records history.
- **Links** between concepts are plain markdown links (bundle-root form
  `/tables/x.md` preferred); relationship semantics live in prose, not link types.
  Broken links are tolerated (not-yet-written knowledge).
- Conventional body headings: `# Schema`, `# Examples`, `# Citations`.

KHB additions on top of OKF: `refs.md` (reserved; the only cross-bundle
pointer), `sources.yaml` (ingestion provenance), `raw/` (uncurated ingested material,
exempt from OKF conformance), and the outer bundle-of-bundles router.

## 4. Cross-bundle references and collation

- A bundle may only reach outside itself through its `refs.md`. Each entry names the target
  bundle, the reason, and optionally the specific note.
- **Collation protocol** (also in `skills/query/SKILL.md`): to answer a question spanning bundles A and B:
  1. Resolve in A. Note where A's `refs.md` points to B.
  2. Open B **through its own index.md** — never jump straight to a B note from A's text.
  3. Join the two answers in the response, not in the files.
  Parallelizable: agent 1 handles A, agent 2 handles B, results merged by the orchestrator.
- Inline links from a note in A directly into a note in B are a lint error. Notes may say
  "see refs → <bundle>", nothing more specific. This is what keeps bundles independent.

## 5. Ingestion

Each bundle declares its sources in `sources.yaml`:

```yaml
sources:
  - type: folder      # local disk
    path: /abs/path/to/project-x
  - type: web
    urls:
      - https://example.com/design-doc
  # Confluence and ADO are listed for the record but ingested by the agent
  # via MCP/CLI, not by scripts — see "scripting philosophy" below.
  - type: confluence
    space: PROJX
  - type: ado
    org: myorg
    project: ProjectX
```

`khb ingest <bundle>` is **one flat phase**: it walks every scripted source, extracts what it
can, and writes `raw/<type>/<file>.md` with a provenance header. It does not interpret
content — that is §5b. Re-running is incremental: a source whose content hash is unchanged
and whose `raw/` copy still exists is skipped; `--force` re-acquires.

The bundle argument is optional. With none, ingest targets `default` and scaffolds it if the
hub has no such bundle, so a hub with zero bundles still has a landing path. Only that name
is auto-created — an explicit name that doesn't resolve is an error, not a scaffold request.
`default` is a holding area, not a tier: its contents are cataloged like any bundle's. Its
material moves only when a human says which bundle should own it — a topic emerging inside
it is not itself a reason to move anything.

Every raw file carries its origin, so a lossy extraction is always recoverable:

```yaml
---
source: /abs/path/to/original.pdf
fetched: 2026-07-23T09:14:02Z
sha256: db2ee470c95d
extract_tool: tesseract.js
quality: low          # high = real text; low = OCR or transcript, verify against source
---
```

**Scripting philosophy: script every deterministic conversion, script no API wrappers.**
Folder, files and web are scripted, as is every extractor (§6). Confluence, ADO and git
hosts are reached through their MCP servers or official CLIs by the agent, which writes into
the same `raw/` shape — no API wrapper code to maintain here. If agent-free refresh of one
of those ever becomes a real need, promote it to a script then.

## 5b. Catalog

Turning `raw/` into concept docs is a separate, agent-only step — `skills/catalog/SKILL.md`,
with no CLI command, because nothing about it is mechanical. Per bundle: read each raw file,
split it into concepts, give each OKF frontmatter, link them, register them in `index.md`,
and fill the `curated` column of `log.md`. Parallelized by fanning cheap subagents over the
raw files, with one hard rule — subagents write concept docs, the orchestrator alone writes
`index.md`, `log.md` and `refs.md`.

## 6. Extraction

Extraction is deterministic, so `khb` owns all of it. Common formats use bundled pure-JS
libraries with no system install; results are cached hub-wide by content hash
(`inbox/extracted/<sha256>.md`) and reused across bundles. Nothing here contacts a model:
tesseract and whisper are local binaries, expensive in CPU but reproducible, which is what
puts them on the CLI side of the §Division-of-labor line.

| Format | Tool | Deps | Quality |
|---|---|---|---|
| PDF | `unpdf` (pdf.js), `pdftotext` if present | bundled | high |
| DOCX | `mammoth`, `pandoc` if present | bundled | high |
| ODT, PPTX | `fflate` + XML | bundled | high |
| XLSX | `fflate` → one markdown table per sheet | bundled | high |
| scanned PDF | `pdfium` + `tesseract.js` (WASM) | opt-in, ~75 MB | low |
| Images (png/jpg/webp/tif) | `tesseract.js` | opt-in, ~75 MB | low |
| Audio, video | `whisper` / `faster-whisper` | opt-in, pip | low |

Missing optional deps degrade to a ledger row with an empty `raw` and a printed install
hint — never to a failed run. `quality: low` output is a standing invitation for the catalog
pass to re-read the original: a vision read of a chart or a scanned table recovers what OCR
drops, and rewrites the raw file with `extract_tool: claude-vision`.

## 7. Lint

`khb lint` enforces (details in `skills/lint/SKILL.md`):
- every bundle has `index.md`, `refs.md`, `sources.yaml`
- every bundle is registered in `outer.index.md`; nothing in `outer.index.md` is dangling
- every concept doc is listed in an index and carries OKF frontmatter (`type` required)
- `refs.md` targets exist; no cross-bundle inline links from concept docs
- index files contain links only (routing, not content)

## 8. Visualizer

`khb visualize` scans `outer.index.md`, every bundle `index.md`, and every `refs.md`,
and emits `visualizer/graph.html` — a single self-contained HTML file: bundles as nodes,
refs as directed edges, note counts as node size. No server, open in any browser.

## 9. Agent workflow summary

```
build:  sources.yaml → khb ingest → raw/*.md (+ provenance, + log.md row)
                     → catalog (agent) → concept docs + index.md entries + curated column
                     → khb lint

query:  question → AGENTS.md → outer.index.md → bundle/index.md → concept docs
                           ↘ (spanning?) refs.md → other bundle via ITS index
                           ↘ (durable synthesis?) propose a new concept → on confirm,
                             write it, link it both ways, index it, log it
```

The query arm writing back is what makes the hub denser with use rather than merely larger:
a question answered by joining two concepts leaves that join behind for the next one. It is
always proposed and never silent — see `skills/query/SKILL.md`.
