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
bkr triage <path...>     # index in place: path, size, sha256, head snippet → inbox/manifest.jsonl
                             # copies 0 bytes; reports duplicate groups by content hash
```

Triage is free — `stat` + hash + a 1KB peek, no external tools — so it is safe to point at
an unknown multi-GB corpus. Read the manifest and **prune what isn't knowledge** (browser
caches, photo dumps, contact exports) before spending anything on the next step.

### Catalog (optional, but the manifest alone is thin)

The `head` snippet is only populated for text files, so every PDF and DOCX — exactly the
formats most likely to carry content — reaches clustering blank. `bkr catalog` fixes that:

```
bkr catalog              # extract text (cached by hash) → inbox/catalog/in/NNNN.jsonl
                             # then label the batches with cheap subagents
bkr catalog-merge        # → inbox/catalog.jsonl: {path, sha256, topic, doc_type, project, summary}
```

`bkr` never contacts a model; labeling is a documented subagent fan-out over the batch
files, spelled out in `skills/catalog/SKILL.md`. Extracted text is cached hub-wide at
`inbox/extracted/<sha256>.md`, and phase 1 reuses it — nothing is converted twice.

Then, as the agent: cluster on the catalog facets if you have them, otherwise on the
manifest's `head` (do not open the corpus either way), propose the bundle set to the user,
`bkr new-bundle` each approved one, and write the assignment:

```yaml
# inbox/routing.yaml
routes:
  <bundle>:
    - /abs/path/to/file.pdf
unrouted: []          # anything you deliberately declined to ingest
```

`bkr route` merges each list into that bundle's `sources.yaml` as a `files` source.
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
file still exists is skipped. `bkr ingest <bundle> --force` re-acquires everything.
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

`bkr ingest` maintains the first four and never touches `curated`. Fill `curated`
yourself in phase 2 — it is the only record of what work remains, and the empty-column
counts printed after each run are your worklist. Binary sources are recorded with an
empty `raw` the moment they are seen, so a pending `pdftotext`/`whisper` pass is never
lost between runs.

| Source | How |
|---|---|
| local folder, web urls | scripted: declare in `sources.yaml`, run `bkr ingest <bundle>` |
| explicit file list | scripted: `files` source, usually written by `bkr route` after triage |
| Confluence | agent: MCP server or CLI → save pages to `raw/confluence/` |
| Azure DevOps | agent: MCP/CLI → wiki pages / work items to `raw/ado/` |
| PDF, DOCX, ODT | scripted: `bkr` extracts these itself — no system tools to install |
| scanned PDF | scripted but opt-in: `bkr catalog --ocr` (see below) |
| Audio, video | agent: transcribe with Whisper (see below), then wrap as md |
| Source code repo | do NOT copy — record location in `sources.yaml`, read in place |

### Extraction: what `bkr` does and doesn't do for you

`bkr` carries its own extractors (`unpdf`, `mammoth`, `fflate` — all pure JS), so PDF, DOCX
and ODT work on a bare machine with no `pdftotext` or `pandoc` install. If those CLIs *are*
on PATH they get a second attempt at anything the libraries can't read, since poppler still
wins on awkward layouts. Everything lands in the hash-keyed cache at
`inbox/extracted/<sha256>.md`, and `bkr ingest` copies out of it, so nothing converts twice.

Two cases stay explicit, because both cost real time and produce lower-fidelity text than
direct extraction:

**Scanned PDFs.** A PDF with pages but no text layer is reported as `scanned`, not `failed`
— the file is readable, just not by a text extractor — and listed in `inbox/scanned.jsonl`.
To actually read them:

```
bun add @hyzyla/pdfium sharp tesseract.js    # ~75 MB, WASM, no system binary
bkr catalog --ocr
```

Install them where `bkr` resolves modules from, which for a global install is the bkr
package directory, not your hub — run `bkr catalog --ocr` once and it prints the exact
`cd … && bun add …` to use. First run also downloads ~5 MB of language data.

OCR text is noisier than real text, so the cache header records `tool: tesseract.js` —
treat it with more suspicion during curation, and quote it more carefully.

**Audio and video.** Not extracted by `bkr` at any setting: transcription is minutes of
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
   as a `# Citations` entry.
3. Register every new doc in the bundle's `index.md` (`* [Title](path.md) - description`),
   and record it in the `curated` column of `log.md`.
4. Anything belonging to a different topic → that other bundle via its own curation,
   plus a `refs.md` entry here. Never inline-link across bundles.
5. `bkr lint` — fix errors before finishing.

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
