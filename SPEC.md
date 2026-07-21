# KHB — Specification

**KHB — a knowledge hub builder**, distributed as `@msareen/khb`. Install the tooling once; run `khb init` wherever the knowledge should
live (OneDrive, a shared drive, a private repo) to create a **hub**. KHB supplies the
rules and tooling and holds no knowledge; the hub holds all of it and is yours.

A personal knowledge system built as a **bundle of bundles**: independent knowledge bundles
joined by a thin router, navigable by any coding/knowledge agent (Claude, Codex, or other).
Agent-facing files are agent-agnostic — no vendor-specific conventions in content, only in
optional entry-point shims (`CLAUDE.md` / `AGENTS.md` may symlink or point to `AGENT.md`).

Lineage: the operating model (immutable raw sources → LLM-curated wiki → schema, driven
by ingest/query/lint) is [Karpathy's LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f);
the file format is [Google's OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) v0.1.
KHB's own contribution is the bundle-of-bundles layer over both — see §1.

## 1. Core ideas

1. **Bundle** — a self-contained topic unit owning its content and ingestion sources.
   Bundles are *lean*: the common rules (AGENT.md, query.md, lint.md) live once at the
   hub root, not duplicated per bundle. When a bundle must travel alone,
   `khb export <bundle>` produces a standalone folder with the common patterns
   injected — independence on demand rather than boilerplate everywhere.
2. **Bundle of bundles** — the hub root is itself a bundle whose content is *routing*, not
   knowledge. `outer.index.md` is the router: it points at bundles and larger topics, and
   details route downward into a bundle's own `index.md`.
3. **One primary bundle, splits are earned** — every hub is created with a primary bundle
   (`bundles/main/`, named in `khb.json` as `primary`). Material with no routing decision
   attached lands there, whole. Distinctions live in concept `type`/`tags`/subdirectories,
   which cost nothing and can be revised once you have actually read the corpus; a bundle
   costs an index, a `sources.yaml`, a `refs.md` and a routing line, so it is created when a
   topic has grown enough to need one — never guessed from filenames before ingestion.
   The promotion is a second cataloging pass, over knowledge this time instead of raw files:
   `khb recatalog` reads the curated bundle's front matter and link graph, `khb split` moves
   a tag out. The unit that moves is the **link closure**, never the tag alone — see §5b.
4. **No collation by copying** — when two topics must be combined, content is never merged
   across bundles. Instead: the requesting bundle records a **reference** (`refs.md`), and the
   query resolves by *querying into* the other bundle. This keeps bundles independent and
   collision-free. Two agents can work the two bundles in parallel and join results at the end.
5. **Ingest, don't wiki-sprawl** — external material (folders on disk, Confluence, Azure
   DevOps, internet links) is pulled *into* a bundle by ingesters rather than being linked as
   living parts of the wiki. The wiki stays canonical; sources are provenance.
6. **Extract to markdown** — binary/opaque formats (PDF, DOCX, audio) are converted to
   markdown by extractors so every bundle's knowledge is plain, greppable text. Audio uses
   whisper. Extraction is incremental — formats are added one by one.
7. **Query writes back** — a query has two folds: answer the question, then decide whether
   the answer is itself knowledge. A comparison, an analysis, a connection you had to
   reason out is worth as much as an ingested source and should not evaporate into chat
   history. It is filed into the owning bundle as a concept doc — preferably by rebuilding
   the doc that already owns the topic — carrying `derived_from` provenance. Ingestion
   makes the hub grow with what you feed it; fold 2 makes it grow with what you ask it.
   Protocol in `query.md`.
8. **Bun** is the scripting language for all tooling and third-party interfaces.

## 2. Two directories, one of them yours

KHB is two things that must not be confused: an installed **package** (tooling, no
knowledge) and a **hub** (knowledge, no tooling). Nothing you write ever lands in the
package, and the package is never a place to keep bundles.

### 2a. The hub — created by `khb init`, lives wherever you want

```
my-knowledge/                  # ~/OneDrive/my-knowledge, a private repo, a share…
├── khb.json                   # THE MARKER — how `khb` finds this hub; version + `primary` bundle
├── outer.index.md             # THE router — bundle-of-bundles index
├── bundles/
│   ├── main/                  # the primary bundle — created by `khb init`, the default landing place
│   └── <bundle>/              # OKF bundle, lean: content + routing, no agent boilerplate
│       ├── index.md           # OKF index: progressive disclosure of this bundle
│       ├── refs.md            # cross-bundle references (the ONLY way out of a bundle)
│       ├── sources.yaml       # ingestion sources for this bundle
│       ├── log.md             # ingest ledger: source → sha256 → raw → curated
│       ├── <group>/           # free-form subdirectories of concept .md files
│       │   ├── index.md       #   (each may carry its own index)
│       │   └── <concept>.md
│       └── raw/               # ingested/extracted material, pre-curation (gitignored)
├── inbox/                     # phase-0 triage scratch (gitignored)
├── visualizer/graph.html      # generated
│
│   ── below: package-owned copies, refreshed by `khb upgrade`, never hand-edited ──
├── AGENT.md                   # agent entry point: how to navigate the whole space
├── CLAUDE.md                  # Claude shim — points at AGENT.md, nothing more
├── SPEC.md                    # this file
├── query.md                   # cross-bundle query protocol
├── ingest.md                  # ingestion protocol: acquire → raw/, curate → concept docs
├── lint.md                    # structural rules (enforced by the linter)
└── skills/                    # agent-agnostic workflow skills (query, ingest, lint, …)
```

The contract docs are *copied into* the hub rather than read from the package because an
agent is opened on the hub folder and must find its rules there, without knowing where
`khb` is installed. They are package-owned: `khb upgrade` overwrites them in place and
leaves `bundles/` and `outer.index.md` alone.

### 2b. The package — `@msareen/khb`, installed once

```
@msareen/khb/
├── package.json               # bin: khb → scripts/cli.ts
├── scripts/
│   ├── cli.ts                 # subcommand dispatch; owns the global --hub flag
│   ├── init.ts                # khb init / khb upgrade
│   ├── new-bundle.ts          # scaffold from .bundle_template, register in outer.index.md
│   ├── export.ts              # bundle + common patterns → standalone shareable folder
│   ├── lint.ts                # enforce lint.md across the hub
│   ├── visualize.ts           # emit visualizer/graph.html from indexes + refs
│   ├── triage.ts / route.ts   # phase-0 bulk corpus handling
│   ├── recatalog.ts / split.ts # late split: tag+link census, then the move
│   ├── ingest/                # folder.ts, files.ts, web.ts → bundle/raw
│   └── lib/
│       ├── paths.ts           # package-side paths — importing it never needs a hub
│       └── util.ts            # hub resolution + shared helpers
├── .bundle_template/          # copied by `khb new-bundle`
├── templates/hub/             # copied by `khb init`
└── AGENT.md, query.md, …      # the masters that `khb init`/`upgrade` copy into hubs
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
  It contains **no knowledge**, only routing. An agent always starts at `AGENT.md`, which
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
- **Collation protocol** (also in `query.md`): to answer a question spanning bundles A and B:
  1. Resolve in A. Note where A's `refs.md` points to B.
  2. Open B **through its own index.md** — never jump straight to a B note from A's text.
  3. Join the two answers in the response, not in the files. If the joined insight is
     durable, fold 2 files it into the *one* bundle that owns the question, in that
     bundle's own vocabulary, with a `refs.md` entry for the other side — never into both.
  Parallelizable: agent 1 handles A, agent 2 handles B, results merged by the orchestrator.
- Inline links from a note in A directly into a note in B are a lint error. Notes may say
  "see refs → <bundle>", nothing more specific. This is what keeps bundles independent.

## 5. Ingestion

A bulk corpus enters through phase 0: `khb triage <path...>` indexes it in place (no
copies) and merges the readable files into the **primary bundle's** `sources.yaml`. That is
the whole path — no clustering, no routing file, no bundle set to invent before anything can
move. `--to <bundle>` picks a different single bundle, for a boundary that is real before
you have read anything. `khb extract` optionally pre-converts the corpus so unreadable files
surface before you commit to ingesting. Everything else is decided later, after curation, by
recataloging (§5b). Full protocol in `ingest.md`.

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

Ingested material lands in `raw/<type>/…` with a provenance header (source URL/path,
fetched-at). Raw material is input for curation into concept docs — never cited as
canonical directly. Re-running ingestion overwrites `raw/` idempotently.

**Scripting philosophy: script only what's trivial and deterministic.** Folder and web
ingestion are scripted (`khb ingest`). Confluence and ADO are reached through their
MCP servers or official CLIs by the agent itself, following the conventions in
`AGENT.md §Ingestion` — no API wrapper code to maintain here. If bulk, repeated,
agent-free refresh of a source ever becomes a real need, promote it to a script then.

## 5b. Recataloging — splitting a bundle after curation

Phase 0 gets material in; recataloging decides, later and with evidence, that part of a
bundle has become a topic of its own.

- `khb recatalog [bundle]` reads every concept doc's front matter plus the in-bundle link
  graph and writes `inbox/recatalog/<bundle>.json`: docs, tags (with co-occurrence and
  types), link-connected components, and per-tag **closure**.
- **Closure is the load-bearing idea.** Concept docs link to each other, and a doc without
  the docs it links to is not knowledge, it is a fragment. So the movable unit is the
  link-connected component: the tag's docs, plus everything reachable from them,
  transitively. A tag whose closure equals the tag is a bundle waiting to happen; a tag
  whose closure is most of the bundle is a cross-cutting thread and must stay a tag.
- `khb split <from> <new> --tag T` moves the closure and rewires everything mechanical:
  both `index.md` files, `refs.md` in both directions, and the `log.md` rows, `raw/` files
  and `sources.yaml` paths for sources whose entire curated output moved (a source cited by
  docs on both sides stays put — one owner, plus a ref). Dry-run unless `--apply`.
- Because whole components move, no link can break. `--only-tagged` deliberately overrides
  that and cuts edges; the resulting dangling links are lint L12, to be rewritten as prose
  plus a `refs.md` pointer. Nothing rewrites a doc's prose automatically — that is curation.

## 6. Extraction

Extraction is cheap and deterministic, so `khb` owns it: the common formats are handled by
bundled pure-JS libraries with no system install, and the results are cached hub-wide by
content hash (`inbox/extracted/<sha256>.md`). Only the formats that cost real time stay as
an explicit, agent-invoked pass with the `<file>.md` + provenance-header convention.

| Format | Tool | Where it runs | Status |
|---|---|---|---|
| PDF | `unpdf` (pdf.js), `pdftotext` if present | in `khb` | v1 |
| DOCX | `mammoth`, `pandoc` if present | in `khb` | v1 |
| ODT | `fflate` + content.xml | in `khb` | v1 |
| scanned PDF | `pdfium` + `tesseract.js` (WASM) | `khb extract --ocr`, opt-in deps | v1 |
| Audio, video | Whisper (`openai-whisper` / `faster-whisper`) | agent-invoked | v1 |
| PPTX, XLSX | `fflate` (both are zip+XML, same shape as ODT) | — | backlog |

## 7. Lint

`khb lint` enforces (details in `lint.md`):
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
question → AGENT.md → outer.index.md → bundle/index.md → concept docs → answer
                                    ↘ (spanning?) refs.md → other bundle via ITS index
answer (durable?) → propose → rebuild owning concept doc | new concept doc
(+ index entry, derived_from) → khb lint
new material → sources.yaml → ingest (script or MCP/CLI) → raw/ → curate into
concept docs (+ index entries) → khb lint
```
