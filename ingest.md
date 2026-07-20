# ingest.md — how data enters a bundle

Phases, always in this order. Phase 0 is only for bulk corpora whose bundles aren't
known yet. Phase 1 is mechanical (get faithful copies into `raw/`); phase 2 is agentic
(distill `raw/` into concept docs). Never skip to 2 — curation must trace back to
provenance.

## Phase 0 — triage a bulk corpus (only when bundles are unknown)

Normal ingest is bundle-first: you know the bundle, you declare a source. A large mixed
corpus is the reverse — the bundle set is an *output* of inspecting the data. Triage
resolves that without duplicating anything.

```
bun run triage <path...>     # index in place: path, size, sha256, head snippet → inbox/manifest.jsonl
                             # copies 0 bytes; reports duplicate groups by content hash
```

Then, as the agent: read `inbox/manifest.jsonl` (the `head` snippet is enough to
classify — do not open the corpus), cluster into topics, propose the bundle set to the
user, `bun run new-bundle` each approved one, and write the assignment:

```yaml
# inbox/routing.yaml
routes:
  <bundle>:
    - /abs/path/to/file.pdf
unrouted: []          # anything you deliberately declined to ingest
```

`bun run route` merges each list into that bundle's `sources.yaml` as a `files` source.
Nothing is acquired yet — phase 1 does that, per bundle.

Triage is the one phase that legitimately looks across all bundles. That does not
violate the one-bundle-at-a-time rule in `AGENT.md`: it is routing, not answering.
`inbox/` is gitignored scratch — the durable record is each bundle's `log.md`.

A hash appearing under two bundles means one bundle owns the source; the other gets a
`refs.md` entry, never a second copy.

## Phase 1 — acquire → `raw/`

Target layout: `bundles/<bundle>/raw/<source-type>/<file>.md`. Every file starts with:

```
---
source: <url | path | tool query>
fetched: <ISO timestamp>
---
```

Re-acquiring is incremental: a source whose content hash is unchanged and whose `raw/`
file still exists is skipped. `bun run ingest <bundle> --force` re-acquires everything.
`raw/` is gitignored and never canonical.

### The ledger — `log.md`

Every bundle keeps an ingest ledger in `log.md` (OKF-reserved, so it is never a concept
doc, and committed, so it survives `raw/` being deleted and re-derived).

| column | owner | meaning |
|---|---|---|
| `source` | script | origin URI: absolute path, url, or tool query |
| `sha256` | script | content hash (12-char prefix) — drives skip-unchanged and dedup |
| `fetched` | script | ISO timestamp of last acquisition |
| `raw` | script | bundle-relative `raw/` path; **empty = extraction still pending** |
| `curated` | agent | concept doc(s) distilled from it; **empty = not yet curated** |

`bun run ingest` maintains the first four and never touches `curated`. Fill `curated`
yourself in phase 2 — it is the only record of what work remains, and the empty-column
counts printed after each run are your worklist. Binary sources are recorded with an
empty `raw` the moment they are seen, so a pending `pdftotext`/`whisper` pass is never
lost between runs.

| Source | How |
|---|---|
| local folder, web urls | scripted: declare in `sources.yaml`, run `bun run ingest <bundle>` |
| explicit file list | scripted: `files` source, usually written by `bun run route` after triage |
| Confluence | agent: MCP server or CLI → save pages to `raw/confluence/` |
| Azure DevOps | agent: MCP/CLI → wiki pages / work items to `raw/ado/` |
| PDF | agent: `pdftotext -layout <file> -` → `raw/<type>/<file>.md` |
| DOCX | agent: `pandoc <file> -t gfm` (or mammoth) → `raw/<type>/<file>.md` |
| Audio | agent: `whisper <file> --model base --output_format txt` → wrap as md |
| Source code repo | do NOT copy — record location in `sources.yaml`, read in place |

## Phase 2 — curate `raw/` → concept docs (agent)

1. Read the acquired files in `raw/`. Work the ledger: rows with an empty `raw` need a
   CLI extraction pass first; rows with an empty `curated` are the backlog.
2. Distill into concept docs: one concept per `.md` file, OKF frontmatter (`type`
   required; `title`, `description`, `tags` recommended), placed in whatever
   subdirectory grouping fits the domain. Keep the `source:` of the raw material
   as a `# Citations` entry.
3. Register every new doc in the bundle's `index.md` (`* [Title](path.md) - description`),
   and record it in the `curated` column of `log.md`.
4. Anything belonging to a different topic → that other bundle via its own curation,
   plus a `refs.md` entry here. Never inline-link across bundles.
5. `bun run lint` — fix errors before finishing.

## Hygiene

- Curate selectively: raw is bulk, concepts are distilled. Not every raw file
  becomes a concept.
- Deduplicate against existing concepts before creating new ones; update instead.
- Large re-ingests: re-run phase 1 (it skips unchanged sources), then curate the rows
  the ledger reports as changed or uncurated.
- Never copy a bulk corpus into `raw/`. Record locations and let extraction shrink it —
  the original stays where it is, as with source-code repos.
- `log.md` records absolute source paths. If those paths are themselves sensitive,
  gitignore it before the first commit.
