# ingest.md — how data enters a bundle

Phases, always in this order. Phase 0 indexes a bulk corpus and lands it in a bundle.
Phase 1 is mechanical (get faithful copies into `raw/`); phase 2 is agentic (distill
`raw/` into concept docs). Never skip to 2 — curation must trace back to provenance.

## Phase 0 — triage a bulk corpus

Normal ingest is bundle-first: you know the bundle, you declare a source. A bulk corpus is
the reverse, and the reflex is to decide the bundle set before anything can move. Don't.

```
khb triage <path...>     # index in place: path, size, sha256, head snippet → inbox/manifest.jsonl
                             # then route it all into the primary bundle
```

**Everything lands in the primary bundle.** `khb init` creates one (`bundles/main/`,
recorded as `primary` in `khb.json`) precisely so this question never blocks a first
ingest. No prior sources, no routing decision, nothing to specify: triage indexes the
corpus and merges it into the primary bundle's `sources.yaml` in one command.

Triage itself is free — `stat` + hash + a 1KB peek, no external tools — so it is safe to
point at an unknown multi-GB corpus. It copies 0 bytes and reports duplicate groups by
content hash. Read the manifest and **prune what isn't knowledge** (browser caches, photo
dumps, contact exports) before phase 1 spends anything on it.

`--to <bundle>` lands the corpus somewhere other than the primary bundle. Use it when a
boundary is real *before* you have read anything — a client, a confidentiality level, a
corpus two agents will work in parallel. That is the only reason to pick a bundle up front;
every other split is better made later, from curated docs (see below).

There is no clustering step and no routing file. Choosing bundles by machine-labeling
snippets was tried and removed: it decides the one thing that matters from the thinnest
evidence you will ever have. See §recataloging.

### Optional: extract before you commit

```
khb extract [--ocr]      # convert every readable file once → inbox/extracted/<sha256>.md
```

`khb ingest` fills the same content-addressed cache on demand, so this is never required.
Run it when a corpus is large or dubious and you would rather learn what is unreadable —
scanned PDFs, dead formats, encrypted files — before committing it to a bundle. Nothing
converts twice either way.

### Separation is by tag, not by bundle

Inside one bundle, a concept doc's front matter is what distinguishes it. Curation in phase
2 is where the corpus gets its structure:

```yaml
---
type: BigQuery Table
title: Orders
description: One row per completed customer order.
resource: https://console.cloud.google.com/bigquery?p=acme&d=sales&t=orders
tags: [sales, revenue]
timestamp: 2026-05-28T14:30:00Z
---
```

`type`, `tags` and subdirectory grouping carry the distinctions a premature bundle split
would have guessed at — and unlike a bundle, a tag costs nothing and can be changed after
you have read the material. Query routing works from `index.md` and front matter either way.

### When a bundle earns its own existence — recataloging

Split later, from knowledge instead of from filenames. Once the material is curated, the
tags in the bundle *are* the catalog, and re-reading them is a second cataloging pass over
knowledge rather than over raw files:

```
khb recatalog [bundle]   # every concept doc's front matter + link graph → inbox/recatalog/<bundle>.json
                             # prints the tag census and what each tag would cost to split
khb split <from> <new> --tag <t>            # dry run: shows exactly what moves
khb split <from> <new> --tag <t> --apply    # do it
```

**Nothing moves on its own.** A concept doc links to the docs that give it meaning, and
those link on in turn, so the unit that can leave a bundle is not a doc and not even a tag
— it is the **link-connected component**: the tag's docs, what they link to, what *those*
link to, transitively. `khb recatalog` reports that as the tag's *closure*, and it is the
number to read:

```
  tag                  docs  closure  types / co-occurs
  sales                14    14       BigQuery Table, Metric  |  revenue(9)
  ops                  3     31 (+28) Runbook  |  sales(1)
```

`sales` is a bundle: its closure is itself, so it detaches with every link intact. `ops` is
a thread running through the whole bundle — splitting it would drag 28 unrelated docs along,
which is the graph telling you these are not two topics. Keep it as a tag.

`khb split` moves the whole closure by default, so no link is ever broken: it moves the
docs, rewrites both `index.md` files, writes `refs.md` rows in both directions, and carries
the matching `log.md` rows, their `raw/` files and their `sources.yaml` paths so provenance
follows the knowledge. `--only-tagged` overrides the closure and moves just the tagged docs;
the cut links then dangle and lint reports each one (L12) for you to rewrite as prose plus a
`refs.md` pointer. Prefer the default — a cut link is knowledge you have quietly deleted.

The dry run also reports which *other* tags the split takes docs from — tags that travel
intact, and tags left **torn** across the boundary. A torn tag whose majority is leaving is
a hint you picked the wrong one. Split one tag at a time and re-run `khb recatalog` in
between: every move rewrites the graph the next decision depends on, so a multi-tag plan
made up front is stale by its second step.

Afterwards, write the new bundle's scope line in `outer.index.md` (that row is the reason
the bundle exists) and run `khb lint`.

Triage and recataloging are the two operations that legitimately look across bundles. That
does not violate the one-bundle-at-a-time rule in `AGENT.md`: they are routing, not
answering. `inbox/` is gitignored scratch — the durable record is each bundle's `log.md`.

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
file still exists is skipped. `khb ingest <bundle> --force` re-acquires everything.
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

`khb ingest` maintains the first four and never touches `curated`. Fill `curated`
yourself in phase 2 — it is the only record of what work remains, and the empty-column
counts printed after each run are your worklist. Binary sources are recorded with an
empty `raw` the moment they are seen, so a pending `pdftotext`/`whisper` pass is never
lost between runs.

| Source | How |
|---|---|
| local folder, web urls | scripted: declare in `sources.yaml`, run `khb ingest <bundle>` |
| explicit file list | scripted: `files` source, written by `khb triage` |
| Confluence | agent: MCP server or CLI → save pages to `raw/confluence/` |
| Azure DevOps | agent: MCP/CLI → wiki pages / work items to `raw/ado/` |
| PDF, DOCX, ODT | scripted: `khb` extracts these itself — no system tools to install |
| scanned PDF | scripted but opt-in: `khb extract --ocr` (see below) |
| Audio, video | agent: transcribe with Whisper (see below), then wrap as md |
| Source code repo | do NOT copy — record location in `sources.yaml`, read in place |

### Extraction: what `khb` does and doesn't do for you

`khb` carries its own extractors (`unpdf`, `mammoth`, `fflate` — all pure JS), so PDF, DOCX
and ODT work on a bare machine with no `pdftotext` or `pandoc` install. If those CLIs *are*
on PATH they get a second attempt at anything the libraries can't read, since poppler still
wins on awkward layouts. Everything lands in the hash-keyed cache at
`inbox/extracted/<sha256>.md`, and `khb ingest` copies out of it, so nothing converts twice.

Two cases stay explicit, because both cost real time and produce lower-fidelity text than
direct extraction:

**Scanned PDFs.** A PDF with pages but no text layer is reported as `scanned`, not `failed`
— the file is readable, just not by a text extractor — and listed in `inbox/scanned.jsonl`.
To actually read them:

```
bun add @hyzyla/pdfium sharp tesseract.js    # ~75 MB, WASM, no system binary
khb extract --ocr
```

Install them where `khb` resolves modules from, which for a global install is the khb
package directory, not your hub — run `khb extract --ocr` once and it prints the exact
`cd … && bun add …` to use. First run also downloads ~5 MB of language data.

OCR text is noisier than real text, so the cache header records `tool: tesseract.js` —
treat it with more suspicion during curation, and quote it more carefully.

**Audio and video.** Not extracted by `khb` at any setting: transcription is minutes of
compute per file, so it stays an agent-run pass you choose to make.

```
pip install -U openai-whisper                       # the reference implementation
whisper <file> --model base --output_format txt     # writes <file>.txt next to the source
```

`faster-whisper` (also pip) is a drop-in with far lower runtime if the corpus is large, and
OpenAI's hosted transcription API is an option when local compute isn't. Whichever you use,
write the result into `raw/<type>/<file>.md` with the usual provenance header and note the
model in it — transcripts are lossy, and later curation needs to know which one produced it.
Video is the same job: Whisper reads the audio track directly, no separate demux step.

## Phase 2 — curate `raw/` → concept docs (agent)

1. Read the acquired files in `raw/`. Work the ledger: rows with an empty `raw` need a
   CLI extraction pass first; rows with an empty `curated` are the backlog.
2. Distill into concept docs: one concept per `.md` file, OKF frontmatter (`type`
   required; `title`, `description`, `tags` recommended), placed in whatever
   subdirectory grouping fits the domain. Keep the `source:` of the raw material
   as a `# Citations` entry. In the primary bundle, `type`/`tags`/subdirectory *are* the
   structure — tag deliberately, since a tag that grows up becomes a bundle (phase 0).
3. Register every new doc in the bundle's `index.md` (`* [Title](path.md) - description`),
   and record it in the `curated` column of `log.md`.
4. Anything belonging to a different topic → that other bundle via its own curation,
   plus a `refs.md` entry here. Never inline-link across bundles.
5. `khb lint` — fix errors before finishing.

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
