# AGENT.md — entry point for any agent

You are inside **BKR**, a bundle-of-bundles knowledge system. Full design: `SPEC.md`.

## How to navigate

1. Start at `outer.index.md`. Pick exactly one bundle for the question. Do not browse.
2. Enter the bundle via its `index.md`, then read only the concepts/notes it routes you to.

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
- **Decisions:** any change to root files (`SPEC.md`, `lint.md`, `query.md`, this file)
  gets a line in `bundles/meta/notes/decisions.md`.
- **`raw/` is not canonical.** It's ingested source material awaiting curation. Cite
  concept docs; use `raw/` only when curating.
- **New bundle:** `bun run new-bundle <name>` — never hand-copy `_template`.
- After structural edits run `bun run lint` and fix what it reports.

## Tooling (Bun)

| Command | Purpose |
|---|---|
| `bun run lint` | validate structure against `lint.md` |
| `bun run visualize` | regenerate `visualizer/graph.html` |
| `bun run new-bundle <name>` | scaffold + register a bundle |
| `bun run triage <path...>` | index a bulk corpus in place (no copies) → `inbox/manifest.jsonl` |
| `bun run route` | apply `inbox/routing.yaml` → `files` sources in each bundle |
| `bun run ingest <bundle>` | pull sources from `sources.yaml`; maintains the `log.md` ledger |
| `bun run export <bundle> [dest]` | standalone copy: bundle + common patterns, shareable alone |

## Ingestion

Follow `ingest.md`: phase 0 triage a bulk corpus into a manifest when the bundle set
isn't known yet, phase 1 acquire into `raw/` (scripted for folder/files/web, MCP/CLI for
the rest, provenance header always), phase 2 curate `raw/` into concept docs and
register them in the bundle's `index.md`. Each bundle's `log.md` is the durable ledger
of what has been acquired and curated — keep its `curated` column current.

## Parallel work

Two agents may work two different bundles concurrently — bundles are independent by
construction. Do not have two agents write the same bundle simultaneously.
