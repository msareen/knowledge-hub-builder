# AGENTS.md — common contract for Claude, Codex, and other agents

You are inside a **KHB hub** — a bundle-of-bundles knowledge system. Full design: `SPEC.md`.

The hub is this folder: `khb.json`, `outer.index.md`, and `bundles/`. The knowledge is
here; the `khb` tooling is installed separately and holds none of it. This file and its
siblings (`SPEC.md`, `skills/`) are package-owned copies refreshed by `khb upgrade` —
never edit them, edit bundle content instead. Every workflow protocol lives wholly inside
`skills/<name>/SKILL.md`: query, ingest, catalog, lint, new-bundle, export, visualize.
Those files are plain markdown — any agent can read one directly, whether or not its
runtime has a notion of "skills".

## What a bundle is

A bundle is a **logical unit defined by its owner** — a person, a team, a project, a client
— not a subject classification. It holds as many topics as its owner has; topics are
organized inside it with subdirectories. A bundle whose contents look heterogeneous is
working as intended.

Creating, splitting or merging bundles is a human decision, always. Never do it on your own
initiative, in any workflow, however obviously a subject seems to want its own home. On
explicit instruction, carve one out and move the files; otherwise leave the shape alone.

## How to navigate

1. Start at `outer.index.md`. Pick exactly one bundle for the question. Do not browse.
2. If that doesn't settle it, escalate per `skills/query/SKILL.md`: grep the bundle
   `index.md` files, then concept front matter, then **ask the user** which bundle.
   Never guess silently.
3. Enter the bundle via its `index.md`, then read only the concepts/notes it routes you to.

This file is the single common contract — bundles carry no per-bundle agent rules.
Claude loads it through `CLAUDE.md`; Codex loads it directly.

## Hard rules

- **One bundle at a time.** If a question spans two bundles, follow the collation protocol
  in `skills/query/SKILL.md`: resolve in the first bundle, follow its `refs.md` to the
  second, and enter the second **through its own index.md**. Never deep-link from one bundle's notes into
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
- **New bundle:** `khb new-bundle <name>` — never hand-copy `.bundle_template`.
- After structural edits run `khb lint` and fix what it reports.

## Division of labor — khb vs agent

One hard boundary governs every workflow and every future change to the tooling:

- **`khb` converts bytes to text.** Hashing, caching, file plumbing, ledger-keeping, and
  *every* local extractor: PDF/DOCX/ODT/XLSX/PPTX libraries, tesseract OCR for scans and
  images, whisper for audio and video. All of it deterministic, offline, and free of
  charge. It **never contacts a model** — not directly, not by shelling out.
- **The agent decides what the text means.** Splitting a document into concepts, labeling
  and linking them, curating `raw/` into the wiki, escalating a bad OCR to a vision read,
  and judging when a query has produced a new concept worth keeping.

The line is *conversion vs. interpretation*, not cheap vs. expensive: tesseract and whisper
belong in `khb` despite costing real CPU, because their output is reproducible and needs no
judgement. The split exists so every intelligent decision is auditable — it leaves a
provenance header and a `log.md` row. When extending khb, keep conversion in the CLI and
interpretation in an agent pass. Never add a `khb … --auto-label` / `--summarize` flag that
calls a model; that rots the boundary.

## Where skills live — one canonical file, thin adapters

A skill exists **once**, in `skills/<name>/SKILL.md`, and that one file carries the entire
protocol. Runtimes that have a notion of "skills" discover it through a parallel adapter
that only points at it:

```
skills/<name>/SKILL.md            ← canonical: the whole protocol
.claude/skills/<name>/SKILL.md    ← adapter: frontmatter + a link
.agents/skills/<name>/SKILL.md    ← adapter: frontmatter + a link
```

Each adapter is the same handful of lines — nothing else belongs in one:

```markdown
---
name: <name>
description: <one line; this is what the runtime matches on when deciding to load the skill>
---

Read and follow the [canonical workflow](../../../skills/<name>/SKILL.md) in full; treat all
of its instructions as part of this skill.
```

The `../../../` climbs from `.claude/skills/<name>/` back to the hub root. The two adapters
are byte-identical to each other; only the canonical file differs from them.

**Adding a hub-specific skill** follows the same shape — create all three files, keep
`<name>` identical across them, and put every instruction in the canonical file only. The
adapter `description` is a triggering surface, so write it as *when to reach for this*, not
as a summary of what it does; the canonical file's own frontmatter can be longer and more
precise, since it is read after the decision to load has been made.

Never let protocol text drift into an adapter: two copies of a workflow means an agent can
load the stale one and have no way to tell. If a runtime needs something the link cannot
express, extend the canonical file and keep the adapter a pointer.

`khb upgrade` refreshes all three trees, so the built-in skills are package-owned — but it
overwrites paths it ships and does not delete unknown ones, so a skill you add to a hub
under a name khb does not use survives upgrades intact.

## Tooling

Run `khb` from anywhere inside the hub — it finds the hub by walking up to `khb.json`.
From outside, pass `--hub <dir>` or set `$KHB_HUB`.

| Command | Purpose |
|---|---|
| `khb lint` | validate structure against `skills/lint/SKILL.md` |
| `khb upgrade` | refresh this hub's package-owned contract docs — runs by itself whenever `khb.json`'s stamped version differs from the installed khb, so these docs always match the CLI |
| `khb visualize` | regenerate `visualizer/graph.html` |
| `khb new-bundle <name>` | scaffold + register a bundle |
| `khb ingest <bundle>` | acquire + extract every source in `sources.yaml` → `raw/`; maintains `log.md`. Name the bundle — with none it lists the hub's bundles and stops, unless there is nothing to choose between (no bundles, or only `default`), where it uses `default` |
| `khb export <bundle> [dest]` | standalone copy: bundle + common patterns, shareable alone |

There is no `khb catalog` command — cataloging is entirely a judgement pass.

## Ingest, then catalog — two steps, in that order

**Ingest** (`skills/ingest/SKILL.md`) is mechanical and flat: `khb ingest <bundle>` pulls
every declared source into `raw/` as markdown with a provenance header, extracting
everything it can locally — text, PDF, DOCX, ODT, XLSX, PPTX, images by OCR, audio and
video by whisper. Sources behind an authenticated API (Confluence, ADO, git hosts) you pull
yourself via MCP/CLI into the same `raw/` shape. Ingest never interprets content.

When the user has not named a bundle, **ask** which existing bundle owns the material or
whether to start a new one, and for an existing bundle ask whether to re-ingest what its
`sources.yaml` already declares or to take a new path. Never choose a destination silently.
The single exception is a hub with nothing to choose between: with no bundles at all an
unnamed ingest lands in `default`, created on the spot, and where `default` is the only
bundle it lands there as it stands.

When a run finishes, **offer the catalog pass** for the bundle just ingested — report what
landed and how many rows are uncurated, then ask before curating anything. Neither stopping
silently at the summary nor cataloging unasked is right.

**Catalog** (`skills/catalog/SKILL.md`) is the judgement half, one bundle at a time: read
each `raw/` file, split it into concepts, give each OKF frontmatter, link them, register
them in `index.md`. When the runtime supports parallel agents, fan them out over the raw
files; only the orchestrating agent writes `index.md`, `log.md` and `refs.md`.

Each bundle's `log.md` is the durable ledger across both steps — rows with an empty
`curated` column are the catalog backlog, so keep it current. A raw file carrying
`quality: low` came from OCR or a transcript: distrust it, and re-read the original named in
its `source:` header when the text looks wrong.

## Parallel work

Two agents may work two different bundles concurrently — bundles are independent by
construction. Do not have two agents write the same bundle simultaneously.
