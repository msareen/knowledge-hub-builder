---
type: Decision Log
title: KHB design decisions
description: Design decisions for KHB and their rationale.
---

# Design decisions

- **2026-08-04 — The OCR stack is bundled, not opt-in; transcription stays opt-in.** Settles
  the disagreement 59ff125 (2026-07-26) opened and flagged in its own message: that commit
  moved `@hyzyla/pdfium`, `sharp` and `tesseract.js` into `dependencies` while `README.md`,
  `SPEC.md` and `skills/ingest/SKILL.md` went on calling them optional deps the user installs
  on first need. The manifest wins; the three docs now say bundled. Reason: an ingest that
  halts on a scanned PDF to ask for a 75 MB install interrupts exactly the run that was going
  well, and OCR is not an exotic path — a corpus of real documents has scans in it. Paying
  ~75 MB of WASM plus `sharp`'s native binaries at install time, once, including for users
  who only ever ingest markdown, is the cheaper end of that trade. Whisper stays opt-in
  because it is a Python executable on `PATH`, which no JS dependency list can deliver.
  `extract.ts` keeps its dynamic imports and graceful degradation unchanged — that path is
  now unreachable in a normal install, and still correct for a pruned tree.
- **2026-08-04 — Ingest offers the catalog pass instead of implying it.** The ingest skill's
  hand-off used to tell the agent to "continue with the catalog skill", which read either as
  licence to curate unasked or, just as often, as advice an agent stopped short of taking.
  It now ends in an explicit offer naming the bundle and its uncurated row count, with the
  three answers spelled out — yes, not now, or a named subset — and the offer scoped to the
  bundle just ingested so a "yes" never rolls onward into another bundle's backlog.
  Reason: cataloging is a judgement pass over the user's material and the destination
  question (2026-08-04, below) established that the user answers those; but leaving a bundle
  at the ingest summary leaves it with a backlog and nothing citable, which is not a finished
  state either. An offer is the only ending that is neither of those failures. `AGENTS.md`
  carries the same rule so the runtimes that read it without loading the skill still get it.
- **2026-08-04 — A hub upgrades itself on version drift.** Every command that acts on a hub
  now compares the `khb` version stamped in `khb.json` against the installed package's
  `package.json` version, and runs the upgrade in place when they differ — one stderr line,
  then the command proceeds. `init` (no hub yet) and `upgrade` (that *is* the operation) are
  exempt, and `KHB_NO_AUTO_UPGRADE=1` opts out. A hub carrying a pre-rename marker name
  counts as drift too, so a legacy `bkr.json` is migrated on first contact rather than only
  by an explicit upgrade. Reason: the contract docs in a hub are *copies*, and a stale copy
  states an older protocol than the CLI implements with no way for an agent to tell which is
  current — the same hazard that made adapters pointers instead of duplicates. Leaving the
  refresh to the user's memory meant every `bun update -g` had a manual second half that
  nobody performs in every hub they own. The upgrade only ever touches package-owned paths,
  so doing it unprompted risks nothing the user wrote. The mechanism moved out of `init.ts`
  into `scripts/lib/upgrade.ts` so `cli.ts` can call it without importing a command module,
  and hub resolution gained a soft `findHub()` in `paths.ts` (util.ts's `HUB` still exits
  with guidance) because the check must stay silent where there is no hub.
- **2026-08-04 — Ingest asks for its destination; `default` narrows to the hub with no real bundle.**
  Amends the 2026-07-23 landing-bundle decision below. A bare `khb ingest` in a hub that has
  bundles now prints them and exits 1 instead of silently landing in `default`; the agent
  asks instead — an existing bundle or a new one — and then, for an existing bundle, whether
  to re-ingest the paths already in `sources.yaml` or take a new path. A named bundle
  ("re-ingest real-estate") is still run without a question. Reason: `default` was bought
  with the argument that ownership is a cheaper decision once the text exists, but where real
  bundles exist it defers the one question the user can always answer (whose material is
  this?) and hands cataloging a pile nobody has decided the owner of. `default` is kept for
  the case that argument actually covers — a hub with nothing to choose between, meaning **no**
  bundles (scaffolded on the spot) or `default` as the **only** bundle (used as it stands,
  since a one-option question is not a choice). Its scope line in `outer.index.md` says so.
  `scripts/lib/scaffold.ts` keeps `DEFAULT_BUNDLE` but only conjures it when `listBundles()`
  is empty; ingest's own bare-argument branch widens that to "empty or `[default]`", and the
  new `listBundles()` also lets the CLI show what the hub actually has when it refuses.
- **2026-07-26 — One common contract, native discovery for Claude and Codex.**
  `AGENTS.md` is the only common contract; the accidental singular `AGENT.md` is retired
  and removed by `khb upgrade`. Claude imports `AGENTS.md` through `CLAUDE.md`, while Codex
  reads it directly. Canonical workflow bodies remain in root `skills/`; thin adapters in
  `.claude/skills/` and `.agents/skills/` make those workflows automatically discoverable
  without duplicating their instructions. Model names and tool calls are not part of the
  common protocols: catalog uses runtime-provided subagents when available and falls back
  to sequential work. Init, upgrade, export, and the npm package all carry the same layout.
- **2026-07-23 — Frontmatter is validated as data (L9 hardened, L8 extended).** L9 checked
  only that a frontmatter block existed and carried a non-empty `type`; everything else the
  catalog pass writes — `title`, `description`, `tags`, `resource`, `timestamp` — was
  declared in `AGENTS.md`, written on every concept, and then read by nothing and checked by
  nothing. A doc with `titel:` or `tags: "a, b"` linted clean. L9 now parses the block
  (malformed YAML is an error, since it loses every field at once), errors on a non-list
  `tags`, and warns on missing `title`/`description`, a non-ISO `timestamp`, and unknown
  keys. L8 likewise now requires a non-empty `source:` in raw provenance and checks
  `quality:` reads `high|low`. Prompted by a question about GitHub Docs' frontmatter
  conventions; those fields themselves (`versions`, `redirect_from`, `showMiniToc`) were
  deliberately **not** adopted — they are static-site rendering directives for one docs
  pipeline, not knowledge metadata. What transferred was the discipline: a documented field
  set, enforced at lint time and written down in the README, rather than a convention that
  drifts. Value types stay free-form — `type` has no closed enum, unlike GitHub's.
- **2026-07-23 — A bundle is a logical unit, not a topic.** Supersedes "one topic per
  bundle" wherever it appeared (`SPEC.md` core idea 1, `README.md`, `skills/new-bundle`).
  A bundle is defined by whoever owns its material — a person, a team, a project, a client
  — and holds as many topics as that owner has, grouped by subdirectory. Reason: the old
  rule ("if the scope sentence needs *and*, make two bundles") shatters exactly the unit
  that matters. A team's roadmap, incidents and vendor notes share a custodian, a context
  and an access story; splitting them by subject scatters one person's world across the
  router and makes every question a cross-bundle join. Subject is what `type`, `tags` and
  subdirectories are for — inside a bundle, where classification is cheap and reversible.
  Corollary, now stated in `AGENTS.md` and repeated in the catalog skill: **no workflow
  creates, splits or merges bundles on its own initiative.** Cataloging classifies concepts
  and links them within one bundle; heterogeneous contents are the expected case, not a
  defect to fix. An agent restructures bundles only when explicitly told to.
- **2026-07-23 — `default` is the landing bundle when none is named.** *(Narrowed 2026-08-04
  to hubs with no bundle other than `default` — see the top of this list; elsewhere ingest
  asks.)* `khb ingest`
  with no
  bundle argument targets `bundles/default/`, scaffolding it if the hub has none. Dropping
  phase 0 left the first ingest in a fresh hub with nowhere to put bytes — it exited 1 and
  told you to go create a bundle, which is the routing question the user often can't answer
  before reading the material. `default` answers it provisionally: content lands, gets
  cataloged normally, and material leaves it only when the user says which bundle owns it
  (amended 2026-07-23 by the bundle-is-a-logical-unit decision above). Deliberately
  *not* a revival of triage — there is no manifest, no routing table, no second pipeline,
  just one conventional bundle name. Only `default` is auto-created; a misspelled explicit
  bundle still errors, since that is a typo rather than a request. Scaffolding moved out of
  `new-bundle.ts` into `scripts/lib/scaffold.ts` so both entry points build identical bundles.
- **2026-07-23 — Ingest / catalog / query re-cut into three sharp jobs.** Supersedes the
  2026-07-19 triage decision below and the "script only the trivial" scope from
  2026-07-19.
  - **Ingest is one flat mechanical phase.** `khb ingest <bundle>` acquires *and* fully
    extracts into `raw/`, then stops. Everything locally convertible is converted in that
    one pass — text, PDF, DOCX, ODT, plus new XLSX and PPTX parsers, tesseract OCR for
    scans *and* bare images, and local whisper for audio/video. Reason: extraction had
    been split across `khb ingest`, `khb catalog --ocr` and an agent-run whisper pass, so
    ingesting a mixed corpus was a multi-round negotiation and half of it reliably got
    forgotten. OCR and whisper moved *into* khb without breaking the division of labor —
    the line is conversion vs. interpretation, not cheap vs. expensive, and both are local
    binaries producing reproducible output.
  - **Provenance carries `extract_tool` and `quality`.** Lossy routes (OCR, ASR) are
    marked `quality: low` rather than hidden, and the raw header always names the original
    file. That is the whole reason acquisition is separate from interpretation: a bad OCR
    is a re-read of the source, not a re-think of the concept written on top of it.
  - **Catalog now means curation, one bundle at a time.** `raw/` → concept docs with OKF
    frontmatter, links, and index entries, fanned out over economical subagents with one
    hard rule: subagents write concept docs, the orchestrator alone writes `index.md`,
    `log.md` and `refs.md`. There is deliberately **no `khb catalog` command** — nothing
    about the step is mechanical.
  - **Phase 0 deleted entirely.** `khb triage`, `khb route`, the old batch-labeling
    `khb catalog`, `khb catalog-merge`, `inbox/manifest.jsonl` and `inbox/routing.yaml`
    are gone; `scripts/lib/progress.ts` went with them. Ingest is bundle-first, always:
    you name the bundle before you name the source. Reason: bundle discovery from an
    unknown corpus was a whole second pipeline serving a one-off case, and it made the
    common path read as "phase 1 of 3". `inbox/` survives only as the extraction cache.
  - **Query may write back.** When answering requires synthesizing across concepts and the
    result is durable, the agent *proposes* a new concept, and on confirmation writes it,
    links it in both directions, indexes it, and logs it with the question as its source.
    Never silent — a hub that accumulates restated one-off answers is worse than a thin
    one. Reason: the join between two concepts was being recomputed on every ask and
    thrown away each time.
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
  unaffected — `SKILL.md` is plain markdown that `AGENTS.md` links by path, so an agent
  with no skill mechanism reads it as an ordinary doc. Knock-ons: `MANAGED` in
  `scripts/lib/paths.ts` and the `files` allowlist drop the three docs, and `bkr export`
  now injects `AGENTS.md` + the whole `skills/` folder instead of the four root files.
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
  aimed at a person; `AGENTS.md` stays the agent contract and the protocols stay the
  single source of truth. Reason: every root doc addressed agents, so a newcomer had no
  on-ramp. README links to the protocols rather than restating rules.
- **2026-07-19 — Triage before routing (phase 0).** *(superseded 2026-07-23 — removed.)* Bulk corpora are indexed in place
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
  `AGENTS.md`. Workflow skills live agent-agnostically in root `skills/` only —
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
- **2026-07-18 — Agent-agnostic.** One common agent contract everywhere, with optional
  runtime shims pointing at it. Superseded by the 2026-07-26 discovery decision.
- **2026-07-18 — Bun for all tooling.** Single runtime for ingesters, extractors, lint,
  visualizer.
- **2026-07-19 — Concept layer (OKF-style).** Bundles gain optional `concepts/`: atomic,
  one-concept-per-file units with typed relations, bundle-local. Notes stay narrative.
- **2026-07-19 — Lean bundles + export.** No per-bundle AGENTS.md/query.md/lint.md;
  common patterns live once at root. Template moved to `.bundle_template/` outside
  `bundles/`. `bun run export <bundle>` injects common patterns for standalone sharing.
- **2026-07-19 — Script only the trivial.** Confluence/ADO via MCP/CLI by the agent;
  PDF/DOCX/whisper as documented CLI conventions. Scripts kept: lint, new-bundle,
  export, visualize, folder/web ingest.
- **2026-07-18 — Ingest external sources.** Folder/Confluence/ADO/web pulled into
  `raw/` with provenance instead of living inside the wiki.
