---
type: Decision Log
description: Design decisions for BKR and their rationale.
---

# Design decisions

- **2026-07-20 — Package + hub split; shipped as `@msareen/bkr`.** Supersedes the
  clone-is-the-hub decision below. `bun install -g @msareen/bkr` installs tooling only;
  `bkr init <dir>` creates a hub (`bkr.json` + `outer.index.md` + `bundles/`) anywhere.
  Hub resolution: `--hub` > `$BKR_HUB` > nearest ancestor with `bkr.json`. Reason: a
  clone forces personal knowledge to live inside the tool's git history and makes
  updating a merge; the split makes them independent, and multiple hubs per install
  become free. `scripts/lib/paths.ts` (package side) is separated from `util.ts` (hub
  side) so `bkr init` can run before any hub exists. The contract docs are *copied* into
  each hub rather than read from the package, because an agent is opened on the hub
  folder and must find its rules there; `bkr upgrade` refreshes those copies and leaves
  `bundles/`+`outer.index.md` untouched. This repo stays its own hub (`bundles/meta`),
  excluded from the tarball by the `files` allowlist.
- **2026-07-20 — The clone is the hub (no hub-root indirection).** *(superseded above.)* BKR is cloned into
  wherever the knowledge should live (OneDrive, shared drive); `bundles/` sits inside the
  clone. Rejected for now: a `--hub`/`$BKR_HUB`/`bkr.json` root resolved separately from
  the repo. Reason: the indirection touches every script and buys nothing until someone
  runs two hubs from one checkout. Revisit if that happens, or if `git pull upstream`
  conflicts on `outer.index.md` become a routine nuisance — those are the two symptoms
  that would justify the split.
- **2026-07-20 — Named BKR.** Repo `bundle-knowledge-router`, package/CLI `bkr`,
  expansion *Bundled Knowledge Routing*, described as a *knowledge hub builder (KHB)*.
  Reason: "thinkspace" named a mood, not a mechanism, and collided with note-taking apps.
  BKR names the two things this adds over its parents — bundling and routing — while KHB
  names the job the repo does. "Routing" not "Router" because `outer.index.md` is already
  *the* router; naming the whole system after one file would make the term ambiguous.
- **2026-07-20 — Prior art credited.** Operating model from Karpathy's LLM Wiki
  (immutable raw → LLM-curated wiki → schema, driven by ingest/query/lint); file format
  from Google's OKF v0.1. BKR's own contribution is the bundle-of-bundles layer.
- **2026-07-20 — `README.md` is the human entry point.** Setup + a build/query tutorial,
  aimed at a person; `AGENT.md` stays the agent contract and the protocols stay the
  single source of truth. Reason: every root doc addressed agents, so a newcomer had no
  on-ramp. README links to the protocols rather than restating rules.
- **2026-07-19 — Triage before routing (phase 0).** Bulk corpora are indexed in place
  into a gitignored `inbox/manifest.jsonl` (path, size, sha256, head snippet) and routed
  to bundles via `inbox/routing.yaml` → `bun run route`. Reason: bundle-first ingest
  can't express "I don't know the bundles yet," and a global staging `raw/` would
  duplicate the corpus. Nothing is copied until a bundle owns it.
- **2026-07-19 — `log.md` as ingest ledger.** OKF's reserved-but-unused `log.md` becomes
  the per-bundle record of source → hash → raw → curated. Reason: acquisition and
  curation had no memory — re-ingest redid everything, and pending binary extractions
  were lost between runs. Committed, so it survives `raw/` deletion; the `curated`
  column is agent-owned and never overwritten by the script.
- **2026-07-19 — `.bundle_template/raw/`.** Template ships `raw/.gitkeep` documenting the
  expected layout and provenance header. `.gitkeep` not `README.md` so lint L8 (which
  checks only `.md` under `raw/`) doesn't warn on every new bundle.

- **2026-07-19 — Claude compatibility layer.** `CLAUDE.md` is a shim importing
  `AGENT.md`. Workflow skills live agent-agnostically in root `skills/` only —
  no `.claude/skills` wrappers; all agents (Claude included) read `skills/` directly.
- **2026-07-19 — ingest.md protocol.** Ingestion documented as its own root file:
  phase 1 acquire → `raw/` (with provenance), phase 2 agent curates → concept docs.
  Included in exports.
- **2026-07-19 — OKF v0.1 alignment.** A concept is any non-reserved `.md` file with
  `type` frontmatter, not a dedicated folder. Free-form subdirectory grouping,
  OKF-style bullet indexes, untyped markdown cross-links, permissive consumption.

- **2026-07-18 — Bundle of bundles.** Independent bundles + thin router (`outer.index.md`)
  instead of one deep wiki tree. Reason: agents route in two hops, bundles stay
  parallelizable and collision-free.
- **2026-07-18 — Collation by reference, not by copy.** Cross-topic questions resolve via
  `refs.md` → other bundle's index. Content is never merged across bundles.
- **2026-07-18 — Agent-agnostic.** `AGENT.md` everywhere; `CLAUDE.md`/`AGENTS.md` are
  optional shims pointing at it. Works for Claude, Codex, or any agent.
- **2026-07-18 — Bun for all tooling.** Single runtime for ingesters, extractors, lint,
  visualizer.
- **2026-07-19 — Concept layer (OKF-style).** Bundles gain optional `concepts/`: atomic,
  one-concept-per-file units with typed relations, bundle-local. Notes stay narrative.
- **2026-07-19 — Lean bundles + export.** No per-bundle AGENT.md/query.md/lint.md;
  common patterns live once at root. Template moved to `.bundle_template/` outside
  `bundles/`. `bun run export <bundle>` injects common patterns for standalone sharing.
- **2026-07-19 — Script only the trivial.** Confluence/ADO via MCP/CLI by the agent;
  PDF/DOCX/whisper as documented CLI conventions. Scripts kept: lint, new-bundle,
  export, visualize, folder/web ingest.
- **2026-07-18 — Ingest external sources.** Folder/Confluence/ADO/web pulled into
  `raw/` with provenance instead of living inside the wiki.
- **2026-07-21 — Query is two-fold; answers file back.** Fold 1 answers, fold 2 decides
  whether the answer is itself knowledge and writes it into the owning bundle as a concept
  doc with `derived_from` provenance — preferring to *rebuild* the doc that already owns
  the topic over adding a near-duplicate. Reason: a comparison or connection synthesized in
  chat is worth as much as an ingested source; without fold 2 the hub only compounds at the
  rate you feed it. Proposed to the user before writing, since revisions overwrite curated
  knowledge. Protocol in `query.md`.
- **2026-07-21 — Lint checks derived answers (L10/L11).** Docs filed back by query fold 2
  carry `derived_from`; lint verifies the sources resolve inside the bundle, that the doc
  links at least one of them inline, and warns when a source's `timestamp` is newer than
  the derived doc's — the synthesis may have been superseded. Warnings, not errors: a stale
  derivation is still knowledge, it just needs rechecking. Reason: without it, fold 2 grows
  a layer of second-hand docs that silently drift from the docs they summarize.
- **2026-07-21 — One primary bundle; splits are earned.** `bkr init` now scaffolds
  `bundles/main/` and records it as `primary` in `bkr.json`; `bkr triage <path...>` routes
  the corpus straight into it. Separation comes from concept `type`/`tags` at curation, and
  a tag graduates to a bundle via `bkr new-bundle` once it has the docs to justify one.
  Reason: phase 0 demanded a bundle set *before* anyone had read the material — the one
  moment you are least equipped to name bundles — and blocked every first ingest on
  clustering. The catalog → `routing.yaml` → `bkr route` flow survives behind
  `bkr triage --no-route` for corpora that must be split up front (separate clients,
  confidentiality, parallel agents). `--to <bundle>` is the single-non-primary middle ground.
- **2026-07-21 — Recataloging: the split happens after curation, by link closure.**
  `bkr recatalog [bundle]` reads a curated bundle's front matter + link graph into
  `inbox/recatalog/<bundle>.json` and prints a tag census; `bkr split <from> <new> --tag T`
  performs the move (docs, both indexes, refs both ways, log rows + raw/ + sources paths),
  dry-run by default. Reason: bundles are best chosen from knowledge, not filenames, so the
  cataloging pass belongs *after* ingestion as well as before. The load-bearing rule is that
  the movable unit is the link-connected component, not the tag: a concept doc without the
  docs it links to is a fragment, so a tag whose closure exceeds itself is a cross-cutting
  thread and must stay a tag. Moving whole components means no link can break; `--only-tagged`
  overrides it and the cut links surface as lint L12. Prose is never rewritten mechanically —
  that is curation.
- **2026-07-21 — Lint L12: in-bundle links must resolve (warning).** A doc that leaves the
  bundle leaves its inbound links pointing at nothing, and those are not L6 errors because
  they no longer name a bundle at all. Found by testing `bkr split --only-tagged`, which
  claimed lint would catch the cut links when nothing did.
- **2026-07-21 — Dropped the pre-ingest cluster flow.** Deleted `bkr catalog-merge`,
  `bkr route`, `inbox/routing.yaml`, `bkr triage --no-route` and `skills/catalog`;
  `bkr catalog` lost its labeling half and became `bkr extract` (pre-convert a triaged
  corpus into the hash-keyed cache, report what is unreadable, opt-in OCR). Reason: that
  flow picked the bundle set from machine-labeled 4KB snippets *before* curation — the
  weakest evidence available for the most consequential decision in a hub — and it now
  duplicates a better mechanism. Corpora land in the primary bundle (`bkr triage`, or
  `--to` for a boundary that already exists), and bundles are carved out afterwards from
  curated docs and their link graph (`bkr recatalog` / `bkr split`). One way in, one way to
  split. `auto-catalog-plan.md` keeps the rationale record.
- **2026-07-21 — Renamed BKR → KHB (`@msareen/khb`, CLI `khb`).** The old expansion was
  *Bundled Knowledge Routing*; routing-as-the-headline no longer describes the tool, so the
  name is now just what it always did: a **knowledge hub builder**. Package, `bin`, hub
  marker (`bkr.json` → `khb.json`), env var (`$KHB_HUB`) and all docs moved. Hubs created
  as BKR still resolve — both markers are accepted, and `khb upgrade` renames the file in
  place, preserving `created` and `primary`. Entries above this line predate the rename and
  use the current command names; the 2026-07-20 naming entry is left as written.
