---
type: Decision Log
title: KHB design decisions
description: Design decisions for KHB and their rationale.
---

# Design decisions

- **2026-08-24 — `khb upgrade` registers and locates its hub like every other in-hub
  command.** `cli.ts` runs `registerHub`/`touchHub` and `recordLocation` before each in-hub
  command and exempts `upgrade`, on the grounds that upgrade performs the contract refresh
  itself. That reasoning covers the refresh and nothing else, and the exemption cost two
  things. A hub you only ever ran `khb upgrade` in never reached `khb list` or `khb go` —
  the self-registering-on-first-use promise in `registry.ts` had a hole in it. Worse, a hub
  upgraded as the first command after a move lost the move: `stamp()` merges `location(hub)`
  over the marker, so the old `path` was overwritten without ever being appended to
  `movedFrom`, leaving `khb update --path` with nothing to repair from and the user back to
  the `--from <old path>` argument the marker exists to eliminate. Both are now done in
  `init.ts`'s upgrade branch, in `cli.ts`'s order — register, record, *then* stamp, since
  the stamp is what destroys the evidence.

- **2026-08-24 — Ignore patterns for generated directories are anchored.** `export/` and
  `inbox/` in both `.gitignore` and `templates/hub/gitignore` are now `/export/` and
  `/inbox/`. Without the leading slash a directory pattern matches at *any* depth, so
  `export/` also matched `skills/export/`, `.claude/skills/export/` and
  `.agents/skills/export/` — meaning every hub `khb init` has ever created was silently
  ignoring its own export skill, and committing the hub dropped those three files without
  saying so. Confirmed by `git status --ignored` on a fresh hub before and after. `git
  ls-files -i -c` is the check that catches this class of mistake; it belongs in the eye of
  anyone editing either file. `bundles/*/raw/`, `.claude/settings.local.json` and
  `visualizer/graph.html` were never affected — a pattern containing a slash is already
  anchored to the file it lives in. Also added to the repo's own list: `.claude/worktrees/`,
  `*.tgz`, and the usual OS leftovers.

- **2026-08-24 — An unknown option is an error, everywhere.** Every subcommand now ends its
  flag parsing with `rejectUnknownFlags` (`lib/args.ts`), so anything flag-shaped that a
  command does not understand exits 1 with the usage line instead of surviving into the
  positional arguments. Silence there was not neutral: `khb export mybundle --force`
  exported into a directory literally named `--force`, and `khb visualize --port abc` served
  on a random port because `Number("abc")` is `NaN` and nobody checked. Only `ingest` had a
  bespoke version of this check; it now uses the shared one, as does `--port`, which is
  validated as a real port. `takeOpt` moved into `lib/args.ts` too — `hubs.ts` and `init.ts`
  had a copy each — and gained `--name=value` alongside `--name value`. The rule the
  implementation must keep: the guard runs *after* every `take*` for that command, since it
  works by inspecting what is left over. Getting that wrong is silent in the opposite
  direction, and it briefly rejected `khb update --from`, a real flag consumed one line too
  late. Exit codes themselves were already right and are unchanged: 0 for success, 1 for a
  usage error or a failure, with an unextractable source staying a pending `log.md` row
  rather than a failed run.

- **2026-08-24 — `vno` is the preferred transcriber, whisper the fallback.** Audio and video
  now go to `vno` (@msareen/voice-notes-organizer) where it is **set up**, and to
  `whisper`/`faster-whisper` only where it is not. Installed is not the same as usable, so
  the probe is `vno status --json` — a command that reports and installs nothing, exits
  non-zero when ffmpeg or whisper.cpp or a model is missing, and names the blockers. That
  makes a half-installed vno an amber gate rather than a red one, and never a discovery made
  one silent per-file failure at a time: whisper takes over if it is there, the recordings
  otherwise pend like any other unavailable extractor, the rest of the corpus is ingested
  either way, and both the printed line and the `log.md` reason say `run: vno setup` instead
  of the wrong `npm install -g`. khb does not run `vno setup` itself — installing software
  nobody asked it to install is not a conversion step. An older vno that predates `status`
  would fail that check for the wrong reason, so a non-JSON answer falls back to the plain
  presence test and vno is used anyway. It is whisper.cpp under a wrapper, so it
  is markedly faster on the same audio and picks up whatever acceleration the machine has,
  it installs its own ffmpeg and model rather than asking khb to, and it hands back WebVTT —
  which, now that the caption reader exists, means a transcript with `## h:mm:ss` anchors
  instead of the flat text the Python whisper's `--output_format txt` produces. No change to
  the §Division-of-labor line: still a local binary doing a reproducible conversion,
  contacting no model, so it stays on the CLI side. Invoked as
  `vno t <file> -o <cache path> --no-open`, with stdin closed on purpose: vno offers to
  install a missing dependency and gates that offer on `isTTY`, so a closed stdin turns a
  prompt nobody could answer into printed instructions. `-o` matters for a second reason —
  without it vno leaves the transcript beside the recording, i.e. inside the user's corpus,
  where the next ingest would read it back as a sidecar. Success is judged by the output
  file existing, not by the exit code, which is 0 even when vno reports a missing file or an
  unusable dependency. The whisper path is untouched apart from being moved into its own
  function; `--translate` is deliberately not wired up, since choosing a language for a
  document is interpretation, not conversion.

- **2026-08-24 — A recording and its caption sidecar are one source.** `talk.vtt` (or
  `talk.en.vtt`, or `talk.srt`) next to `talk.mp4` is that recording's words, written down by
  someone who could hear it. Before this, the two were unrelated files: the media went to
  whisper for minutes of CPU and came back `quality: low`, while the sidecar hit `kindOf`'s
  `skip` branch and landed in `log.md` with an empty `raw` — the accurate transcript
  discarded, the worse one flagged for manual verification. Now `.vtt`/`.srt` are a `caption`
  kind with a real extractor (cue indices and timecodes stripped, `<v Name>` kept as a
  speaker label, the rolling repetition of auto-generated captions collapsed, a `## h:mm:ss`
  heading per five minutes so a passage stays findable in the recording), and `acquireFile`
  prefers a sidecar over whisper. The pair gets one ledger row, under the recording; the
  sidecar gets none. Three consequences, each deliberate: the row's hash covers both files,
  so correcting a caption re-ingests the recording instead of leaving it "unchanged,
  skipped"; the extraction cache is keyed on the sidecar's own hash, so the same captions
  beside a re-encoded video reuse the entry; and the sidecar is read even under
  `--skip-audio`, which exists to skip minutes of CPU, not to skip free text. Two languages
  on disk is a choice about audience, so khb transcribes instead and leaves both files for a
  human to point at — the same reason `identify()` refuses to guess between ambiguous move
  candidates. A caption whose recording this source does not visit (excluded, or not listed)
  stays an ordinary source with its own row, which is what keeps a `files:` source naming
  only the `.vtt` from acquiring nothing at all.

- **2026-08-10 — `khb update-path` renamed `khb update`, and gains a schema-repair half.**
  Reverses the 2026-08-07 naming decision below ("update and upgrade differ by one letter and
  agree on nothing") — that objection held while `update` would have meant only path repair,
  a bare synonym for the longer name it replaced. It no longer applies once `update` does two
  distinct jobs neither of which belongs to `upgrade`: `--path`/`-p` is the old path-repair
  logic unchanged (`lib/relocate.ts`, `lib/registry.ts`), and the new `--schema`/`-s` backfills
  a bundle's `sources.yaml` to the current field set (`lib/schema.ts`) — the gap the `exclude:`
  field just exposed, where an existing bundle has no way to discover a newly added optional
  field short of reading the docs. No flag runs both. Schema diffing has no persisted version
  anywhere; it's a fresh presence check against `SOURCES_SCHEMA` every run, the same pattern
  `MANAGED`/`RETIRED` already use for contract docs. Edits go through the `yaml` package's
  `Document` API rather than parse-then-stringify, so a hand-written comment survives a field
  being added around it — reserializing the whole document can still reformat unrelated
  flow-style content elsewhere in the same file, a cosmetic side effect, not a correctness one.
  `khb upgrade` now prints a hint when either half of `update` has something pending, mirroring
  the existing move-detected hint's style: a suggestion, never a prompt, since `upgrade` already
  runs unattended inside unrelated commands on version drift and a blocking question there would
  interrupt work that has nothing to do with either repair. `takeFlag` (`lib/args.ts`) grew
  multi-name support (`--schema`/`-s`) — the first short flags for a subcommand's own options in
  this codebase.

- **2026-08-09 — `sources.yaml` gains `exclude:`; asking about it stays agent-side.**
  `folder`/`files` sources can now declare `exclude: string[]` — plain path prefixes or
  glob patterns (auto-detected by `* ? [`), each checked against both the file's absolute
  path and its path relative to the source (basename, for `files`), so either form the user
  writes works. Matching uses Bun's built-in `Bun.Glob`, so no new dependency. Filtering is
  post-walk only (`scripts/ingest/exclude.ts`, used by `folder.ts`/`files.ts`) rather than
  pruning directories during the walk — `folder.ts` already enumerates the whole tree
  up front by design, and pruning correctly for patterns like `node_modules/**` (which
  doesn't match the directory itself) is real extra complexity for a perf case not in
  evidence. The interactive half — asking "anything to exclude? (default: no)" — is *not*
  a CLI prompt: `khb ingest` stays pure argv, exit-1-on-ambiguity, no stdin reads, matching
  every other command. That question lives in `skills/ingest/SKILL.md` §2 alongside the
  reuse-vs-replace question already there, with the same rule: don't run `khb ingest`
  until it's answered. Reason: khb converts bytes to text; deciding whether to ask a human
  and what to do with the answer is interpretation, so it belongs in the agent-read
  protocol, not the binary.

- **2026-08-07 — A hub records its own location in `khb.json`, and overlapping moves are
  rewritten rather than refused.** `khb update-path` could only work out where a hub used to
  be by asking the machine registry which of its entries had gone missing — an outside
  witness, and a fragile one: delete `~/.khb`, open the hub on a second machine, or hand the
  folder to a colleague and the evidence is gone, leaving `--from <the path you must now
  remember>` as the only way through. The marker is the one thing that travels *with* the
  folder, so it now carries a `path` key (canonical, plus `pathAs` for the spelling khb was
  invoked through when the two differ). Every khb command run in a hub compares it against
  where the hub actually is; a mismatch is the move, announced on the spot with the one
  command that repairs it, and the stale location goes into `movedFrom` until `update-path`
  works it off — so a hub moved twice before anyone repairs it has both former homes rewritten
  in one pass. The key is inert: nothing reads it but this repair. That is the point — it
  costs a string and removes an argument the user had no way to reconstruct. It is written
  only when it changes, so the common case leaves `khb.json` and anyone's `git status` alone,
  and it is deliberately recorded *before* the version-drift check restamps the marker, which
  would otherwise overwrite the old location before anything read it.

  The same work retired the third guard claimed in the entry below. Refusing overlapping
  old/new paths outright rejected two perfectly ordinary moves — a hub lifted out of its
  parent (`…/kb/hub` → `…/kb`, the case that prompted this) and one pushed down into a
  subdirectory of where it stood. Only the second direction was ever dangerous, and for a
  specific reason: the old path occurs inside every reference that is *already* correct, so
  each would have the move applied to it a second time. The fix is smaller than the refusal —
  the new path is added to the substitution table mapped to itself, and longest-match-first
  ordering lets that identity claim those positions before the shorter old path can. Overlap
  became safe in both directions, and the whole command became idempotent as a side effect:
  a second run rewrites nothing. What remains refused is old and new naming the same
  directory, where there is no move to repair at all.

- **2026-08-07 — A bare `khb` with no hubs opens a wizard, and every mechanical pass reports
  progress.** Two halves of the same principle: khb should not make the user go and read
  something to get past a state khb can already see. On a fresh machine `khb` had been
  printing three lines of guidance and stopping, which asks someone who has just installed
  the tool to leave for the docs before doing anything — so it now asks the five questions
  `khb init` takes as flags and builds the hub. Critically it calls the same `createHub()`
  extracted for the purpose (`lib/create.ts`), so there is no second creation path to drift;
  agents are *detected* by probing `--version` rather than offered blind; a path that is
  already a hub is adopted into the list rather than overwritten; and with no terminal —
  or under `--path`, where a script is asking for a path — it falls back to the old
  guidance rather than blocking on a prompt nobody sees. The same reasoning covers the
  long walks: `khb ingest` already announced its plan and each file before doing the work
  (`lib/log.ts`), but `update-path` scanned a whole hub in silence, which is
  indistinguishable from a hang. It now shares that module, with a new `ticker()` for units
  too fast and numerous to deserve a line each. The ticker writes to **stderr** and
  repaints at ~12fps, degrading to a milestone line every 500 units with no terminal —
  so redirected stdout stays clean and complete while a CI log still shows movement.
  Still no `--quiet` anywhere: the per-unit line is the audit trail for a pass that
  rewrites files.

- **2026-08-07 — `khb update-path` repairs a moved hub, and stays a conversion.** A hub folder
  that moves breaks two things: the machine shortcut list points at nothing, and every
  absolute path recorded *inside* the hub that named the old location dangles —
  `sources.yaml`, `source:` headers in `raw/`, `log.md` rows, `resource:` front matter.
  Rewriting those is a byte-identical prefix swap with no judgement in it, so it belongs in
  the CLI and not in an agent pass; an agent reading each file to decide would be slower and
  less reliable at the one thing a regex is exact about. Three guards make it safe to run
  unattended: every spelling of a path is matched and rewritten to *the same* spelling
  (native, forward-slashed, and JSON-escaped as `raw/` headers store it), so an escaped
  source stays escaped; matches must end at a path boundary, so moving `…/old` never touches
  a sibling `…/older`; and overlapping old/new paths are refused rather than half-applied
  (superseded — see the entry above, which rewrites them safely instead). The old path is
  inferred on **proof** — the `created` stamp minted once at `khb init`,
  now mirrored into each registry entry as an identity fingerprint — while a bare name match
  is only circumstantial and gets put to the user as a question. Two consequences fell out
  of building it: registry paths are now canonicalized through `realpath`, because
  `C:\Users\MANASV~1\…` and `C:\Users\Manasvi Sareen\…` are one directory under two true
  names and were listing as two hubs; and a hub named after its old folder is renamed after
  the new one, unless its marker states a name of its own. Named `update-path` rather than
  the shorter `update` it was first built as: `update` and `upgrade` differ by one letter
  and agree on nothing, and a hyphen is cheap next to a user running the wrong one.

- **2026-08-07 — One shortcut list per machine, at `~/.khb/hubs-config.json`.** Hub
  resolution (`--hub` → `$KHB_HUB` → walk up for the marker) all presumes you already know
  where the hub is; from a cold terminal in an unrelated folder, nobody does, and a person
  with a personal, a work and a client hub has three paths to keep in their head. So khb
  now keeps a per-machine file of hub paths plus one preferred agent command, and a bare
  `khb` picks a hub and launches that agent with the hub as its cwd. Three constraints kept
  it from rotting the package/hub split: the file holds **paths only, never knowledge** — it
  is disposable, and every command run inside a hub re-registers it, so it rebuilds itself
  and needed no migration or `khb register`; the **hub stays the authority on its own
  identity**, with `name` and `description` read out of its `khb.json` so they travel with a
  hub that is moved or cloned, and `khb upgrade` now merges the marker rather than replacing
  it so those keys (and anything else a user put there) survive; and the four commands over
  it (`list`, `go`, `agent`, `forget`) are the **only** ones that skip hub resolution and the
  version drift check, since running outside a hub is their entire purpose. `khb go` prints
  a `cd` line rather than performing it — no child process can move its parent shell — and
  passes the path to the agent as cwd, which is what actually gets you there.

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
