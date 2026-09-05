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
6. **Extract to markdown, locally** — binary/opaque formats (PDF, DOCX, XLSX, OneNote,
   images, audio) are converted to markdown so every bundle's knowledge is plain, greppable
   text. Every extractor is local and deterministic: pure-JS libraries, tesseract WASM,
   whisper.cpp, pyOneNote.
   Lossy routes (OCR, ASR, OneNote) are marked `quality: low` rather than hidden.
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
├── .ingest-cache/extracted/   # hub-wide extraction cache, keyed by content hash (gitignored)
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

Copies drift, so the copy is kept honest by the CLI rather than by the user's memory.
`khb.json` stamps the version that wrote the hub's copies; before running any command that
touches a hub, `khb` compares that stamp to the installed package version and, if they
differ, performs the upgrade in place and says so on stderr. Only `init` (no hub yet) and
`upgrade` (which is the operation) skip the check, and `KHB_NO_AUTO_UPGRADE=1` disables it.
The invariant it buys: **a hub's contract docs always state the same version as the `khb`
acting on them** — an agent can never read a protocol the CLI no longer implements.

### 2b. The package — `@msareen/knowledge-hub-builder`, installed once

> **None of the following is in your hub.** This section describes the *installed tool*,
> which lives in your global package directory — not in the folder you are working in. A
> hub contains exactly what §2a lists: `khb.json`, `outer.index.md`, `bundles/`, and the
> package-owned contract docs. There is no `scripts/` and no `package.json` in a hub, so
> paths below are package-internal and will not resolve from the hub root. To run the tool,
> call `khb <command>` — never reach for a file in this tree.

```
@msareen/knowledge-hub-builder/     # installed once, globally — NOT part of a hub
├── package.json               # bin: khb → scripts/cli.ts
├── scripts/
│   ├── cli.ts                 # subcommand dispatch; --hub flag; the version drift check
│   ├── init.ts                # khb init / khb upgrade
│   ├── hubs.ts                # khb list / go / agent / update / forget — the only
│   │                          #   commands that run outside a hub
│   ├── new-bundle.ts          # scaffold from .bundle_template, register in outer.index.md
│   ├── export.ts              # bundle + common patterns → standalone shareable folder
│   ├── lint.ts                # enforce skills/lint/SKILL.md across the hub
│   ├── doctor.ts              # read-only state report; writes nothing, repairs nothing
│   ├── visualize.ts           # serve the live bundle graph from indexes + refs
│   ├── config.ts              # khb config: view / edit / check / fix the machine config
│   ├── ingest/                # folder.ts / files.ts / web.ts → acquire.ts → bundle/raw
│   └── lib/
│       ├── args.ts            # argv helpers; what they consume they remove, leaving positionals
│       ├── color.ts           # semantic terminal colour; one palette per stream
│       ├── config-check.ts    # the machine config's schema: findings + the repairs for them
│       ├── create.ts          # making a hub, shared by `khb init` and the first-run wizard
│       ├── extract.ts         # every local extractor + the content-hash cache
│       ├── graph.ts           # graph data for the visualizer — read-only, never writes
│       ├── graph-page.ts      # the visualizer's browser UI, rendered from that data
│       ├── ledger.ts          # log.md read/write
│       ├── log.ts             # progress reporting: each unit announces itself before it runs
│       ├── paths.ts           # package-side paths — importing it never needs a hub
│       ├── registry.ts        # ~/.khb/hubs-config.json: where this machine's hubs are
│       ├── relocate.ts        # khb update --path's path rewriter — pure text, no judgement
│       ├── scaffold.ts        # bundle creation + lookup, shared by new-bundle and ingest
│       ├── schema.ts          # khb update --schema: sources.yaml field diff/apply
│       ├── upgrade.ts         # the refresh itself: `khb upgrade` and the drift check
│       └── util.ts            # hub resolution + shared helpers
├── pyscripts/                 # the only non-Bun code, spawned as a subprocess, never
│   └── onenote.py             #   imported: the `.one` parser (needs pyOneNote's object model)
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

### 2d. The machine registry — `~/.khb/hubs-config.json`

Rules 1–3 all assume you already know where the hub is. From a cold terminal in an
unrelated folder, you don't — and a person with a personal hub, a work hub and a client
hub has three paths to remember. So khb keeps **one file per machine** recording where the
hubs on it are:

```
~/.khb/                        # %USERPROFILE%\.khb on Windows; $KHB_HOME overrides
└── hubs-config.json
```

```json
{
  "version": 1,
  "defaultAgent": "claude",
  "agents": { "claude": { "command": "claude", "args": [] },
              "codex":  { "command": "codex",  "args": [] } },
  "hubs": [
    { "name": "my-knowledge", "description": "Personal — work + home",
      "path": "D:\\code\\my-knowledge", "added": "…", "lastUsed": "…" }
  ]
}
```

Three properties define it:

- **It is a shortcut list, never knowledge.** It holds paths and one launch command.
  Delete it and nothing is lost — the next command run inside each hub puts it back.
- **It fills itself in.** Every khb command that resolves a hub registers it, so hubs made
  before the registry existed appear the first time anything is run in them. There is no
  migration and no `register` command to remember. `khb forget <name> [more…]` drops one or more
  shortcuts and never touches the folders. Every target is resolved before any is removed,
  so list positions still mean what they meant when the command was typed.
- **The hub is the authority on its own identity.** `name` and `description` are read out
  of the hub's `khb.json` (`khb init --name --description`, or edit the file), so a hub
  moved to another machine or cloned by a colleague describes itself the same way there.
  Only when the marker says nothing does khb fall back to the folder name and a summary of
  the bundles inside. `khb upgrade` merges rather than replaces the marker, so keys khb
  does not own survive an upgrade.

The commands over it are `khb list`, `khb go`, `khb agent`, `khb update`, `khb forget` and
`khb config` — the only ones that run **outside** a hub, and therefore the only ones that
skip hub resolution and the version drift check. A bare `khb` is `khb go`: one hub asks to open it,
several show the list and take a pick, none prints the help.

`khb go` ends by launching your configured agent with the hub as its working directory.
No process can change its parent shell's directory, so `khb go` prints the `cd` line for
the human and passes the path to the agent as cwd — `khb go --path <name>` prints only the
path, for `cd "$(khb go --path work)"`. `khb agent none` turns the launch off entirely.

**The file is hand-editable, so it is also checked.** `loadConfig` is deliberately
forgiving — unknown keys ignored, a file that will not parse treated as empty — which is
right at load time and wrong as the only feedback anyone gets: a typo'd `defaultagent`
silently does nothing, and broken JSON silently costs you every shortcut. So the schema
is stated once, in `lib/config-check.ts`, as findings with repairs attached. `khb config
check` lists them, `khb config fix` applies the mechanical ones, and `khb doctor` reports
them without writing. A finding carries a repair only when the fix loses nothing:
canonicalizing a path, merging a duplicate entry, re-deriving a stale name from the hub's
own marker. Anything needing a human decision — which of two same-named hubs to rename,
whether a missing folder was deleted or is on an unplugged drive — is reported with the
command to run and left alone.

Every path stored in or compared against the registry is canonicalized first (`realpath`,
case-folded on Windows). One directory has several true names — `C:\Users\MANASV~1\…` and
`C:\Users\Manasvi Sareen\…` are the same folder, as is anything reached through a symlink —
and without this a single hub lists twice and `khb update --path` cannot tell it has already
been repaired.

### 2e. `khb update` — repairing a hub

Two independent repairs, selectable together or apart:

```
khb update [new-path] [--path|-p] [--schema|-s] [--from <old-path>] [--dry-run]
```

No flag runs both. `--path`/`-p` repairs a moved hub; `--schema`/`-s` backfills a bundle's
`sources.yaml` to the current field set (§ scripts/lib/schema.ts). They are unrelated repairs
that happen to share a plan-then-write-then-report shape, so one command with two switches
beat two commands that would each need the same hub-resolution and dry-run plumbing.

#### `--path` — a hub that moved

Moving a hub folder breaks two things, and this half fixes both:

1. **The shortcut list** still points at the old folder. `khb list` marks it `MISSING`.
2. **Absolute paths recorded inside the hub** that named the old location — `sources.yaml`
   entries, `source:` headers in `raw/`, `log.md` rows, `resource:` front matter — are now
   dangling.

Run from inside the moved hub, or name it. Nothing else is needed, because **the hub records
its own location**. `khb.json` carries a `path` key — canonical, plus `pathAs` for the
spelling khb was invoked through when the two differ — and any khb command run in a hub
compares it against where the hub actually is. A mismatch is the move, stated by the only
witness that travelled with the folder:

```
khb: this hub was at D:\kb\old and is now at D:\kb\new.
khb:   absolute paths recorded inside it still name the old location.
khb:   repair them:  khb update --path            (--dry-run to preview)
```

The old location moves into `movedFrom`, where it waits until `--path` works it off.
A hub moved twice before anyone repaired it lists both former homes and all of them are
rewritten in the one pass. The key costs a string and is inert — nothing reads it but this
repair — but it is what makes the repair need no arguments, and it survives what the registry
does not: a deleted `~/.khb`, a first run on a second machine, a folder handed to a colleague.

Failing that — a hub last touched by a khb too old to have recorded a location — the old path
is *inferred, on proof only*: each registry entry records the `created` stamp from the hub's
marker, minted once at `khb init`, so the dead entry carrying this hub's stamp is provably the
same hub. A mere name match is circumstantial and is put to the user as a question rather than
acted on. `--from` settles it either way, and is still the answer when the move predates all
of this.

The rewrite itself is a **conversion, not an interpretation**, which is what keeps it in the
CLI rather than in an agent pass (§ AGENTS.md, division of labor): the same substring in
and out, no judgement about what a path means. Three properties make it safe to run
unattended:

- **Every spelling moves.** A path appears natively (`D:\a\b`), forward-slashed (`D:/a/b`),
  and backslash-escaped inside JSON (`D:\\a\\b`, how `raw/` headers and `log.md` store a
  source). All are matched, and each is rewritten to *the same spelling* of the new path, so
  a JSON-escaped source stays JSON-escaped.
- **Matches end at a path boundary.** Moving `…/old` never touches `…/older`, a sibling
  whose name merely starts the same way.
- **The new path is shielded from itself.** It is matched too, and rewritten to itself. That
  is what makes an *overlapping* move safe — a hub lifted out of its parent (`…/kb/hub` →
  `…/kb`) or pushed down into a subdirectory of where it stood (`…/kb` → `…/kb/hub`). In the
  second case the old path occurs inside every already-correct reference, and without the
  shield each would have the move applied to it a second time. Claiming those matches for an
  identity rewrite also makes the whole command idempotent: run it twice and the second run
  changes nothing. Only old and new naming *the same directory* is refused, there being no
  move to repair.

`.git/`, `node_modules/` and the `.ingest-cache/` extraction cache are not walked; binary files and
anything over 8 MB are skipped. `--dry-run` reports the file-by-file hit count and writes
nothing.

Like `khb ingest`, it states the whole plan before writing anything and reports progress as
it walks (§2g).

#### `--schema` — a bundle's `sources.yaml` predates a field

A `sources.yaml` written before a field existed (e.g. `folder`/`files` sources gained
`exclude:`) has no way to discover it short of reading the docs. `scripts/lib/schema.ts`
holds the current, optional, backfillable field list per source `type`; this half diffs
every bundle's `sources.yaml` against it and, for anything missing, stages a default value —
or, for a field the schema has since deprecated, stages its removal. Comment-preserving:
it edits the parsed YAML document node-by-node (the `yaml` package's `Document` API) rather
than reserializing from scratch, so hand-written comments and structure in an untouched part
of the file survive. The one caveat is cosmetic, not correctness: re-serializing the whole
document can normalize whitespace in *other*, unrelated flow-style content in the same file.

There is no persisted schema version anywhere — the "schema" is just this file's current
shape, diffed fresh on every run, the same way `khb upgrade`'s `MANAGED`/`RETIRED` lists are
static and re-checked rather than tracked historically. `--dry-run` prints the changes and
writes nothing; otherwise it applies immediately, same convention as `--path`.

`khb upgrade` prints a one-line hint when either half of `update` has something pending —
never a prompt, since `upgrade` already runs unattended inside unrelated commands on version
drift, and a blocking question there would interrupt work that has nothing to do with either
repair.

The name says what it does, now that it does two things belonging to neither `khb upgrade`
(package-owned contract docs only) nor to a single-purpose `update-path`. The original
one-letter-from-`upgrade` objection to the shorter name held while `update` meant only path
repair; a second, unrelated repair under the same verb resolves it — `update` repairs what
the user's own bundles record, `upgrade` refreshes what the package owns, and the two no
longer read as near-synonyms.

### 2f. First run — the wizard

A bare `khb` on a machine with no hubs has a terminal in front of it and knows the one
thing the user needs to hear, so it asks rather than referring them to the docs. Five
questions, every one with a default that Enter accepts: where the hub goes, what to call
it, a one-line description, which agent opens it, and a first bundle.

Three things keep it honest:

- **It asks only what `khb init` takes as flags**, and calls the same `createHub()`. A hub
  born in the wizard is byte-identical to one made by hand — there is no second creation
  path to drift.
- **Agents are detected, not guessed.** `claude` and `codex` are probed with `--version`
  and the ones present are marked; the first found is the default. Any other command can be
  typed instead, or `none`.
- **A path that is already a hub is adopted, not overwritten.** The machine simply had not
  heard of it, so it joins the list under its own name and the wizard stops there.

No terminal, or `--path` (a script asking for a path), falls back to three lines of
guidance. `khb list` on an empty machine likewise reports rather than starts a
conversation.

### 2g. Progress on the mechanical passes

`khb`'s half of the split is the deterministic half, and some of it is slow: a scanned PDF
is seconds per page, a video minutes per file, and a hub that has accumulated thousands of
raw documents takes a visible moment to walk. A silent process is indistinguishable from a
hung one, so every mechanical pass reports (`scripts/lib/log.ts`):

- **The plan, before any work.** Which hub, which bundle, which extractors are armed, how
  many sources — or for `update --path`, the old path, the new path, and whether anything
  will be written; for `update --schema`, which bundles and fields. A `--hub`/`$KHB_HUB`
  run can target a folder you did not expect, and that must be visible before the first
  write, not after.
- **Position within the run.** `[3/57]` per unit where a unit is slow enough to deserve its
  own line (ingest's per-file extraction), and a single rewritten counter line where the
  units are fast and numerous (`update --path` checking files).
- **An outcome per unit, and a closing summary** with wall-clock time.

The transient counter writes to **stderr** and repaints at ~12fps; with no terminal it
degrades to a milestone line every 500 units. So `khb … > out.txt` keeps clean, complete
stdout, and a CI log still shows the walk moving. There is no `--quiet`: the per-unit line
is the audit trail for a pass that rewrites files, and a run you have to repeat to find out
what it did is worse than a noisy one.

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
    exclude: [drafts/]      # optional — skip paths/globs before ingesting
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

**A source is identified by its bytes, not its path.** When a file turns up at an unseen
path, khb looks for a row with the same hash whose own path has since vanished; exactly one
match means the file moved, and that row is re-pointed at the new path — keeping its `raw/`
file (never renamed, because concepts cite it) and its `curated` value, and correcting the
raw file's `source:` header. Without this, moving a file reads as a deletion plus an
unrelated arrival: a duplicate raw file, a duplicate row with an empty `curated`, and
eventually a duplicate concept for material already cataloged. A source's `raw/` filename is
likewise fixed for life, so a file that moves and *then* changes re-extracts over the same
file rather than stranding the one its citations point at.

Two look-alikes are deliberately excluded, since both would rewire provenance on a guess: a
**copy** (the twin's path still exists — two real sources, both ingested) and an **ambiguous**
match (several vanished rows share the hash). Each is reported and left to judgement.

A bundle is a logical unit its owner defines, so the destination is a human decision. An
explicit name that doesn't resolve is an error, not a scaffold request; a bare `khb ingest`
in a hub that has real bundles prints them and stops, because the CLI cannot ask. The agent
asks instead (`skills/ingest/SKILL.md` §1–2): which existing bundle, or a new one; then, for
an existing bundle, whether to re-ingest its declared `sources.yaml` paths or take a new path.

`default` survives as the fallback for a hub with nothing to choose between: a bare
`khb ingest` scaffolds it and lands there when there are **no bundles at all**, and uses it
when it is the **only** bundle — a one-option question is not a choice, and the first ingest
anyone runs should not fail for want of a destination. It is not an option once a real bundle
exists — that was the earlier design, and it bought a pile of material whose ownership
nobody had decided, which is exactly the decision cataloging then has to make blind.
`default` is a holding area, not a tier: its contents are cataloged like any bundle's, and
they move only when a human says which bundle should own them.

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
(`.ingest-cache/extracted/<sha256>.md`) and reused across bundles. Nothing here contacts a model:
tesseract and whisper are local binaries, expensive in CPU but reproducible, which is what
puts them on the CLI side of the §Division-of-labor line.

| Format | Tool | Deps | Quality |
|---|---|---|---|
| PDF | `unpdf` (pdf.js), `pdftotext` if present | bundled | high |
| DOCX | `mammoth`, `pandoc` if present | bundled | high |
| ODT, PPTX | `fflate` + XML | bundled | high |
| XLSX | `fflate` → one markdown table per sheet | bundled | high |
| OneNote (`.one`) | `pyOneNote` + `pyscripts/onenote.py` on a local python | opt-in, pip | low |
| scanned PDF | `pdfium` + `tesseract.js` (WASM) | bundled, ~75 MB | low |
| Images (png/jpg/webp/tif) | `tesseract.js` | bundled, ~75 MB | low |
| Audio, video | `vno` (whisper.cpp), else `whisper` / `faster-whisper` | opt-in, npm or pip | low |
| Captions (vtt/srt) | built-in reader | bundled | high |

A recording that has a caption sidecar beside it — `talk.vtt`, `talk.en.vtt`, `talk.srt` —
is read from the sidecar rather than transcribed, and the two are acquired as one source:
one ledger row under the recording, no row and no `raw/` file for the sidecar. The pair's
content hash covers both files, so correcting a caption re-ingests the recording. Where two
sidecars disagree about language khb transcribes instead: choosing an audience is not a
conversion decision, and §Division-of-labor puts choices on the agent's side of the line.

The OCR stack is bundled rather than opt-in: an ingest that stops to ask for an install is
worse than an install that carries WASM nobody uses. Transcription stays opt-in because it
is an external executable, not something khb's own dependency tree can carry: `vno`
(@msareen/voice-notes-organizer) where `vno status` reports it ready, since whisper.cpp is
faster than the Python whisper and hands back WebVTT the caption reader can anchor, else
`whisper` / `faster-whisper`. A vno that is installed but not set up degrades to the
fallback, or to pending rows, and never to a failed run.

OneNote is opt-in for the same reason: `.one` is a proprietary binary store, and the reader
for it is pyOneNote, found on `python`, `python3` or `py`.

```
pip install -U https://github.com/DissectMalware/pyOneNote/archive/master.zip
```

khb drives it through `pyscripts/onenote.py` rather than pyOneNote's own CLI, so that
asking for text writes nothing next to the notebook and unpacks no attachments. That script
holds the parser, and its header documents the invariants a faithful read depends on:
advance the object-reference cursor (installed pyOneNote does not), resolve each page's
explicitly current revision and its dependency chain, take a page's title and level from its
root-role-2 metadata, walk real content references in order rather than de-duplicating text
fragments, and resolve file containers to payloads rather than to a document's icon.

One section becomes one `raw/` file: `#` the section, `##` a page in section order, deeper
for a subpage by its own `PageLevel`, with tables, lists and creation timestamps — so a
catalog pass can split pages into concepts by reading the headings. Its embedded files are
unpacked into `<that file>.files/`, linked from the page they sit on, and then **ingested as
sources in their own right**: an embedded PDF gets the PDF reader at `quality: high`, a
screenshot gets OCR, and each earns a `log.md` row of its own keyed
`<container>#<name>` — a source identity for bytes that have no path, and one that follows
its container when that container moves. Ink, freeform positioning and styling are not
recoverable, which is why `quality: low` holds for the section text even though it is real:
a page can still be a screenshot with nothing under it. pyOneNote is a forensic parser and
can abort on property types it does not implement; the row then pends with the parser's own
reason, and re-exporting the page from OneNote as PDF or DOCX is the user's decision to make,
not khb's.

A missing dep degrades to a ledger row with an empty `raw` and a printed install
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
- intra-bundle links from a concept doc resolve to a file that exists (warning — OKF
  tolerates a link to knowledge not yet written)
- `log.md` agrees with the bundle: a `curated` value naming a missing concept is an error,
  a `raw` value naming a missing file or a `raw/` file with no row is a warning

## 8. Visualizer

`khb visualize [--port N]` scans `outer.index.md`, every bundle `index.md`/`refs.md`, and
every concept doc's markdown links, and serves an interactive graph from a local server —
`aliases: vis, viz` (`-v` is taken by `khb --version`). Two zoom levels: bundles as nodes
with refs as directed edges (note counts as node size), and — click a bundle — its
concepts as nodes with the markdown links between them as edges. Click a concept to open
a panel that fetches its full body from `/api/file`. A refresh button rescans the hub and
refetches the graph over `/api/graph`, for watching a hub change live during a catalog
pass.

The inner view is **clustered by folder, not free-floating**: each concept is anchored to
the region of its top-level subdirectory (`tables/`, `notes/`, …), drawn as a labelled
hull, and links that cross folders pull far more weakly than links inside one. The
bundle's own organisation is therefore the visible structure, and the graph reads as
traffic between regions instead of a single hairball. Deeper nesting collapses into its
top-level folder — a handful of labelled regions beats one region per directory.

The canvas **pans and zooms** (wheel to zoom at the cursor, drag the background to pan,
`fit` / `F` to reframe). The layout is settled before the first paint and then framed by a
fit pass with a floor on the zoom, so a small hub opens zoomed in rather than as three dots
in an empty canvas, and a large one opens whole.

The outer view seats bundles on a ring **just wide enough to hold them side by side**, with
short-range repulsion and a firm pull to the centre: the hub opens as one compact group
that reads at a glance, and zoom — not distance — is what makes it usable.

Labels are drawn in **screen space at a fixed size**, not in world space, and any label
whose box would collide with one already drawn is dropped — larger nodes claim their name
first, and the hovered node always keeps its own. Text therefore stays legible and sparse
at every zoom level instead of piling into an unreadable puddle; zooming in reveals the
labels that were culled. A node's label is its front-matter `title`, clipped short; the
untruncated title and full path appear in the panel when it is clicked, and in the hover
strip at the bottom.

A concept's `type` is encoded as **colour**, never as sub-text, and is spelled out in words
in the hover strip and the panel chip — there is no legend and no shape vocabulary to
learn. Hovering a node dims everything it isn't linked to. The top bar is deliberately
thin: back, fit, a dark/light toggle remembered in `localStorage`, and refresh. Every
colour the canvas draws comes from the active theme so the graph and the surrounding chrome
stay in step.

Folder regions are laid out on an **ellipse sized from the folders themselves** — each
folder's disc grows with its file count, and the ring is only wide enough for neighbouring
discs to clear each other — so two folders sit side by side rather than a screen and a half
apart. The fit pass has a zoom ceiling but no floor: a large graph zooms out until it is
whole rather than opening cropped.

Unpinned, it binds a random free port (and picks another if `--port N` is already taken)
and opens the URL in the default browser; `--no-open` just prints it. The page heartbeats
the server and beacons on unload, so the server exits on its own once the browser tab
closes rather than lingering as a background process.

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
