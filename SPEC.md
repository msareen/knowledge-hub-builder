# BKR — Specification

**BKR — Bundled Knowledge Routing.** A knowledge hub builder: clone it into wherever the
knowledge should live (OneDrive, a shared drive) and build the hub inside that clone.
BKR supplies the rules and tooling; `bundles/` is yours.

A personal knowledge system built as a **bundle of bundles**: independent knowledge bundles
joined by a thin router, navigable by any coding/knowledge agent (Claude, Codex, or other).
Agent-facing files are agent-agnostic — no vendor-specific conventions in content, only in
optional entry-point shims (`CLAUDE.md` / `AGENTS.md` may symlink or point to `AGENT.md`).

Lineage: the operating model (immutable raw sources → LLM-curated wiki → schema, driven
by ingest/query/lint) is [Karpathy's LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f);
the file format is [Google's OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) v0.1.
BKR's own contribution is the bundle-of-bundles layer over both — see §1.

## 1. Core ideas

1. **Bundle** — a self-contained topic unit owning its content and ingestion sources.
   Bundles are *lean*: the common rules (AGENT.md, query.md, lint.md) live once at the
   repo root, not duplicated per bundle. When a bundle must travel alone,
   `bun run export <bundle>` produces a standalone folder with the common patterns
   injected — independence on demand rather than boilerplate everywhere.
2. **Bundle of bundles** — the repo root is itself a bundle whose content is *routing*, not
   knowledge. `outer.index.md` is the router: it points at bundles and larger topics, and
   details route downward into a bundle's own `index.md`.
3. **No collation by copying** — when two topics must be combined, content is never merged
   across bundles. Instead: the requesting bundle records a **reference** (`refs.md`), and the
   query resolves by *querying into* the other bundle. This keeps bundles independent and
   collision-free. Two agents can work the two bundles in parallel and join results at the end.
4. **Ingest, don't wiki-sprawl** — external material (folders on disk, Confluence, Azure
   DevOps, internet links) is pulled *into* a bundle by ingesters rather than being linked as
   living parts of the wiki. The wiki stays canonical; sources are provenance.
5. **Extract to markdown** — binary/opaque formats (PDF, DOCX, audio) are converted to
   markdown by extractors so every bundle's knowledge is plain, greppable text. Audio uses
   whisper. Extraction is incremental — formats are added one by one.
6. **Bun** is the scripting language for all tooling and third-party interfaces.

## 2. Directory layout

```
bundle-knowledge-router/
├── README.md            # human entry point: setup + build/query tutorial
├── SPEC.md              # this file
├── AGENT.md             # agent entry point: how to navigate the whole space
├── outer.index.md       # THE router — bundle-of-bundles index
├── query.md             # cross-bundle query protocol
├── ingest.md            # ingestion protocol: acquire → raw/, curate → concept docs
├── lint.md              # structural rules (enforced by scripts/lint.ts)
├── package.json         # Bun project
├── CLAUDE.md            # Claude shim — points at AGENT.md, nothing more
├── skills/              # agent-agnostic workflow skills (query, ingest, lint, …)
├── .bundle_template/    # copied by scripts/new-bundle.ts — lives outside bundles/
├── bundles/
│   └── <bundle>/        # OKF bundle, lean: content + routing, no agent boilerplate
│       ├── index.md     # OKF index: progressive disclosure of this bundle
│       ├── refs.md      # cross-bundle references (the ONLY way out of a bundle)
│       ├── sources.yaml # ingestion sources for this bundle
│       ├── <group>/     # free-form subdirectories of concept .md files
│       │   ├── index.md #   (each may carry its own index)
│       │   └── <concept>.md
│       └── raw/         # ingested/extracted material, pre-curation (gitignore-able)
├── scripts/
│   ├── new-bundle.ts    # scaffold a bundle from .bundle_template, register in outer.index.md
│   ├── export.ts        # bundle + common patterns → standalone shareable folder
│   ├── lint.ts          # enforce lint.md across all bundles
│   ├── visualize.ts     # emit visualizer/graph.html from indexes + refs
│   └── ingest/
│       ├── folder.ts    # local folder → bundle/raw
│       └── web.ts       # internet links → bundle/raw
└── visualizer/
    └── graph.html       # generated — bundle graph, self-contained
```

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

BKR additions on top of OKF: `refs.md` (reserved; the only cross-bundle
pointer), `sources.yaml` (ingestion provenance), `raw/` (uncurated ingested material,
exempt from OKF conformance), and the outer bundle-of-bundles router.

## 4. Cross-bundle references and collation

- A bundle may only reach outside itself through its `refs.md`. Each entry names the target
  bundle, the reason, and optionally the specific note.
- **Collation protocol** (also in `query.md`): to answer a question spanning bundles A and B:
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

Ingested material lands in `raw/<type>/…` with a provenance header (source URL/path,
fetched-at). Raw material is input for curation into concept docs — never cited as
canonical directly. Re-running ingestion overwrites `raw/` idempotently.

**Scripting philosophy: script only what's trivial and deterministic.** Folder and web
ingestion are scripted (`bun run ingest`). Confluence and ADO are reached through their
MCP servers or official CLIs by the agent itself, following the conventions in
`AGENT.md §Ingestion` — no API wrapper code to maintain here. If bulk, repeated,
agent-free refresh of a source ever becomes a real need, promote it to a script then.

## 6. Extraction

Same philosophy: existing CLIs do the work, the agent invokes them and applies the
`<file>.md` sibling + provenance-header convention (commands in `AGENT.md`). Roadmap,
one format at a time:

| Format | Tool | Status |
|---|---|---|
| PDF | `pdftotext` (poppler) | v1 |
| DOCX | pandoc or mammoth | v1 |
| Audio | whisper CLI (installed locally) | v1 |
| PPTX, XLSX, images/OCR | later | backlog |

## 7. Lint

`bun run lint` enforces (details in `lint.md`):
- every bundle has `index.md`, `refs.md`, `sources.yaml`
- every bundle is registered in `outer.index.md`; nothing in `outer.index.md` is dangling
- every concept doc is listed in an index and carries OKF frontmatter (`type` required)
- `refs.md` targets exist; no cross-bundle inline links from concept docs
- index files contain links only (routing, not content)

## 8. Visualizer

`bun run visualize` scans `outer.index.md`, every bundle `index.md`, and every `refs.md`,
and emits `visualizer/graph.html` — a single self-contained HTML file: bundles as nodes,
refs as directed edges, note counts as node size. No server, open in any browser.

## 9. Agent workflow summary

```
question → AGENT.md → outer.index.md → bundle/index.md → concept docs
                                    ↘ (spanning?) refs.md → other bundle via ITS index
new material → sources.yaml → ingest (script or MCP/CLI) → raw/ → curate into
concept docs (+ index entries) → bun run lint
```
