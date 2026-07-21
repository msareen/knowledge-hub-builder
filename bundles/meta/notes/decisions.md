---
type: Decision Log
description: Design decisions for BKR and their rationale.
---

# Design decisions

- **2026-07-22 — Renamed BKR → KHB throughout.** Supersedes the 2026-07-20 naming
  decision below. CLI `bkr` → `khb`, package `@msareen/bkr` → `@msareen/khb`,
  `$BKR_HUB` → `$KHB_HUB`, and the expansion is now *Knowledge Hub Builder*, matching
  the repo. Reason: the repo, the marker and the CLI each answered to a different name.
  Two strings deliberately did **not** change: `LEGACY_MARKERS` still contains
  `bkr.json`, and `khb upgrade` still reads a `bkr` version field out of an old marker
  (`before.khb ?? before.bkr`) — both are on-disk state in hubs we don't own, so
  renaming them would strand those hubs rather than migrate them.
- **2026-07-22 — README leads with a generated terminal GIF.** `images/demo.gif`, built
  by `images/make-demo-gif.py` from output transcribed off a real session, so it can be
  regenerated when the CLI changes and never drifts into showing invented output.
  `images/` is outside the `files` allowlist, so the GIF never ships in the tarball.
- **2026-07-22 — Hub marker renamed `bkr.json` → `khb.json`.** The marker is what
  every command walks up the tree to find, so renaming it orphans hubs created by an
  earlier version — including from `bkr upgrade`, which must resolve a hub before it can
  fix anything. `LEGACY_MARKERS` in `scripts/lib/paths.ts` keeps the old name resolvable
  and `bkr upgrade` renames the file it finds, so a hub carries a legacy name at most
  once. `markerIn()` lives in `paths.ts`, not `util.ts`: `bkr init` needs it before a hub
  exists, and importing `util.ts` resolves a hub or exits.
- **2026-07-21 — Protocols live inside the skills, not beside them.** `query.md`,
  `ingest.md` and `lint.md` were folded wholesale into `skills/query/SKILL.md`,
  `skills/ingest/SKILL.md` and `skills/lint/SKILL.md`; the root copies are gone. The
  skills had been thin pointers at root protocol docs, so every workflow cost two file
  reads and the contract surface was duplicated in two places that could drift. A skill
  folder is now the unit: one `SKILL.md` holds its whole procedure. Agent-agnosticism is
  unaffected — `SKILL.md` is plain markdown that `AGENT.md` links by path, so an agent
  with no skill mechanism reads it as an ordinary doc. Knock-ons: `MANAGED` in
  `scripts/lib/paths.ts` and the `files` allowlist drop the three docs, and `bkr export`
  now injects `AGENT.md` + the whole `skills/` folder instead of the four root files.
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
