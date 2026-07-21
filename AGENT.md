# AGENT.md — entry point for any agent

You are inside a **KHB hub** — a bundle-of-bundles knowledge system. Full design: `SPEC.md`.

The hub is this folder: `khb.json`, `outer.index.md`, and `bundles/`. The knowledge is
here; the `khb` tooling is installed separately and holds none of it. This file and its
siblings (`SPEC.md`, `query.md`, `ingest.md`, `lint.md`, `skills/`) are package-owned
copies refreshed by `khb upgrade` — never edit them, edit bundle content instead.

## How to navigate

1. Start at `outer.index.md`. Pick exactly one bundle for the question. Do not browse.
2. If that doesn't settle it, escalate per `query.md`: grep the bundle `index.md` files,
   then concept front matter, then **ask the user** which bundle. Never guess silently.
3. Enter the bundle via its `index.md`, then read only the concepts/notes it routes you to.
4. After answering, run fold 2 of `query.md`: a durable answer — a comparison, an
   analysis, a connection — gets filed back as a concept doc (usually by rebuilding the
   existing doc that owns the topic), proposed to the user first. Queries write too.

This file is the single common contract — bundles carry no per-bundle agent rules.

## Hard rules

- **One bundle at a time.** If a question spans two bundles, follow the collation protocol
  in `query.md`: resolve in the first bundle, follow its `refs.md` to the second, and enter
  the second **through its own index.md**. Never deep-link from one bundle's notes into
  another's. Join answers in your response, not in the files.
- **Indexes are routing only.** Never add knowledge content to `outer.index.md` or any
  `index.md` — add a concept doc and link it from the index.
- **Writing (OKF v0.1):** a concept = one markdown file, anywhere in the bundle except
  reserved names (`index.md`, `log.md`, `refs.md`) and `raw/`. Group concepts in
  subdirectories that fit the domain (`tables/`, `metrics/`, `notes/`, …). Every
  concept doc starts with front matter — `type` is required:

  ```yaml
  ---
  type: Metric            # free-form: Table, Playbook, Decision Log, Reference, …
  title: Display name
  description: One-line summary (reused by index generators)
  resource: <canonical URI of the underlying asset, if any>
  tags: [a, b]
  timestamp: 2026-07-19T00:00:00Z
  ---
  ```

  List every concept in an `index.md` (`* [Title](path.md) - description`). Link
  concepts to each other with plain markdown links, `/path/from/bundle/root.md`
  preferred; relationship meaning goes in the surrounding prose.
- **Cross-bundle relationships** go in `refs.md` only — never inline links across bundles.
- **Decisions:** if this hub has a `meta` bundle, any change to how the hub itself works
  gets a dated line in `bundles/meta/notes/decisions.md`.
- **`raw/` is not canonical.** It's ingested source material awaiting curation. Cite
  concept docs; use `raw/` only when curating.
- **New bundle:** `khb new-bundle <name>` — never hand-copy `_template`.
- After structural edits run `khb lint` and fix what it reports.

## Tooling

Run `khb` from anywhere inside the hub — it finds the hub by walking up to `khb.json`.
From outside, pass `--hub <dir>` or set `$KHB_HUB`.

| Command | Purpose |
|---|---|
| `khb lint` | validate structure against `lint.md` |
| `khb upgrade` | refresh this hub's package-owned contract docs |
| `khb visualize` | regenerate `visualizer/graph.html` |
| `khb new-bundle <name>` | scaffold + register a bundle |
| `khb triage <path...>` | index a bulk corpus in place (no copies) → primary bundle |
| `khb extract [--ocr]` | pre-convert a triaged corpus into the extraction cache |
| `khb recatalog [bundle]` | tag + link-graph census of a *curated* bundle → `inbox/recatalog/` |
| `khb split <from> <new> --tag T` | promote a tag into its own bundle, link closure intact |
| `khb ingest <bundle>` | pull sources from `sources.yaml`; maintains the `log.md` ledger |
| `khb export <bundle> [dest]` | standalone copy: bundle + common patterns, shareable alone |

## Ingestion

Follow `ingest.md`: phase 0 triage a bulk corpus — by default it lands whole in the hub's
**primary bundle** (`khb.json` → `primary`, normally `main`), and separation comes from
concept `type`/`tags` at curation, not from bundles invented up front. `--to <bundle>` is
the only up-front alternative, for a boundary that is real before you have read anything —
a client, a confidentiality level. A tag earns its own bundle later, via
`khb recatalog` (census: what each tag would cost to split) and `khb split` (the move).
Splits go by **link closure**, never by tag alone — a doc drags whatever it links to, and
whatever that links to; `khb split` handles this, `--only-tagged` overrides it and leaves
dangling links for you to rewrite. Phase 1 acquire into `raw/` (scripted for folder/files/web,
MCP/CLI for the rest, provenance header always), phase 2 curate `raw/` into concept docs and
register them in the bundle's `index.md`. Each bundle's `log.md` is the durable ledger
of what has been acquired and curated — keep its `curated` column current.

## Parallel work

Two agents may work two different bundles concurrently — bundles are independent by
construction. Do not have two agents write the same bundle simultaneously.
