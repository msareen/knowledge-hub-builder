# Global ingestion: mechanical extraction + Haiku subagent cataloging (Phase 0 upgrade)

> Status: **built**. `bkr catalog` and `bkr catalog-merge` ship; the fan-out is documented in
> `skills/catalog/SKILL.md`. This file is kept as the rationale record — see *As built* at the
> bottom for where the implementation diverged from the design below.

## Context

`bkr triage` (phase 0 of `ingest.md`) already solves "index a bulk corpus without knowing
bundles yet" — it walks a corpus, hashes/dedups, and writes `inbox/manifest.jsonl`. But the
agent that reads that manifest to propose a bundle set has almost nothing to go on:

- `triage.ts` only populates `head` for `kind === "text"`. Every PDF/DOCX — exactly the
  formats most likely to carry real content — gets an **empty** head. The agent is clustering
  blind on filename and extension.
- Clustering thousands of files by hand doesn't scale, and neither the user nor the model
  knows the category set upfront. That's the whole point: a cheap model produces lightweight
  per-file signal first, and a stronger model consolidates that signal into a bundle set —
  both tiers' context stays bounded (one batch of snippets for labeling; paths + facets only
  for consolidation).

Neither `triage` nor cataloging touches `bundles/`, so none of this is blocked by bundles not
existing yet — only `route` and `ingest` need bundles, and they already error clearly when one
is missing (`route.ts:22-27`).

## Design decisions

### 1. The labeling tier is a Claude subagent fan-out — and that's deliberate

An earlier draft made model calls a pluggable subprocess (`bkr catalog --cmd "<shell cmd>"`,
prompt on stdin, JSONL on stdout). **Dropped.** Spawning `claude -p` / `codex` / `gemini` once
per batch pays agent-CLI cold-start on every batch — slow regardless of how small the batch or
how fast the model. And it's redundant: the cataloging run is already happening inside a Claude
Code session, so shelling out to a second agent process to do what the in-session `Agent` tool
does natively is pure overhead.

So: `bkr` stays mechanical and dependency-free, and the brain is a **documented Claude subagent
fan-out** — `Agent` calls with `model: "haiku"`, one per batch, issued in parallel. No MCP, no
API keys, no subprocess model calls, no new dependencies.

This is Claude-specific on purpose. `AGENT.md`'s agent-agnostic framing is about the **hub
contract** — any agent can read and navigate a hub. It was never a promise that every authoring
workflow runs identically on every agent. Cost is the binding constraint here, and Haiku
subagents on fat batches is the cheapest thing that works. The fan-out is written down (in
`skills/catalog/SKILL.md`), not hidden inside a command.

### 2. `bkr catalog` stays separate from `bkr triage`

Tempting to fold them into one walk. Don't:

- **Triage is free; cataloging is not.** Triage is `stat` + hash + a 1KB peek, no external
  tools, safe to point at an unknown multi-GB corpus. Cataloging spends `pdftotext`/`pandoc`
  CPU and model tokens. That's a costed step, not a side effect of looking at a folder.
- **The gap between them is the pruning checkpoint.** A real run against `D:\test-hub` produced
  4,128 files dominated by `Cache_Data`, `SplitContacts`, `Passport Pics`, browser profile
  junk. Merged into one pass, every PDF in that pile gets extracted sight-unseen. Separate, you
  read the manifest, throw out what isn't knowledge, and extract only what's left.
- **They want opposite re-run semantics.** Triage is stateless — rerun rewrites the manifest
  from scratch. Catalog must be incremental, skipping already-cataloged files by hash, because
  you will narrow scope and rerun several times.

Convenience is still cheap: `bkr catalog` defaults to reading `inbox/manifest.jsonl`, so
back-to-back is just `bkr triage <dir> && bkr catalog`.

### 3. Extracted text lives in a content-addressed cache

`inbox/extracted/<sha256>.md`, never moved into a bundle's `raw/`. This preserves the invariant
that `raw/` is derived and rebuildable (gitignored per `templates/hub/gitignore:2`). Extraction
becomes a cache-fill; `bkr ingest`'s extractable branches (which today just log "pending
extraction" and leave the ledger's `raw` column empty — `files.ts:32-38`, `folder.ts:36-40`)
check the cache first and copy from it on a hit.

### 4. The cheap model emits facets, not one free-text label

`{path, sha256, topic, doc_type, project, summary}`. Clustering on several weak signals is far
more stable than deduping synonymous free-text strings, and facets are what the consolidating
tier actually clusters on.

### 5. The main thread owns the category vocabulary

Parallel subagents can't see each other's labels, so unconstrained fan-out coins synonyms
(`invoices` / `billing` / `bills`). Two waves fix it:

1. **Seed wave** — one batch (or a few) runs first. The main thread reads the resulting `topic`
   values and holds them as the working vocabulary.
2. **Bulk wave** — every remaining batch runs in parallel, each prompt carrying that vocabulary
   with: *reuse an existing topic unless nothing fits; only then coin a new one.*

The main thread then does a final crunch, collapsing the surviving long tail into a small set of
wide, bundle-sized categories.

## Pipeline

```
bkr triage <corpus>          →  inbox/manifest.jsonl          (exists today)
   ↓  prune obvious non-knowledge from the manifest
bkr catalog [--batch N]      →  inbox/extracted/<sha256>.md   (extraction cache)
   mechanical only              inbox/catalog/in/NNNN.jsonl   (batch files)
   ↓
Claude fans out Agent(model: "haiku") — one call per batch file
   each subagent writes         inbox/catalog/out/NNNN.jsonl
   ↓
bkr catalog-merge            →  inbox/catalog.jsonl           (canonical, deduped)
   mechanical only
   ↓
main thread crunches facets → bundle set → bkr new-bundle → inbox/routing.yaml
bkr route → bkr ingest <bundle>                                (exists today)
```

## Components

### `bkr catalog` — mechanical, never contacts a model

`bkr catalog [--batch N] [--force]`

1. Require `inbox/manifest.jsonl` (missing-file error in the style of `route.ts:12-16`,
   pointing back at `bkr triage`).
2. Drop `kind === "skip"` rows, and rows already in `inbox/catalog.jsonl` by `path+sha256`
   unless `--force`.
3. Build a snippet per surviving file:
   - `kind === "text"` — read up to ~4000 chars directly (the manifest's 500-char `head` is too
     thin to classify on).
   - `kind === "extractable"` — `extractCached()`; `null` marks the row `extract-failed` in the
     summary and is skipped. Never aborts the run.
4. Write fixed-size batch files to `inbox/catalog/in/NNNN.jsonl` — default **100 files per
   batch**, one snippet row per line, `--batch N` to override.
5. Print the batch count and the fan-out instruction as the `Next:` hint, matching the style of
   `triage.ts` / `route.ts`.

### Labeling — Claude `Agent` fan-out, `model: "haiku"`

One `Agent` call per batch file, in parallel. Each subagent reads **only its own**
`inbox/catalog/in/NNNN.jsonl`, emits one facet row per input file, and **writes
`inbox/catalog/out/NNNN.jsonl` itself** — the subagent's prose report is discarded, the file is
the product. Seed wave first, bulk wave with the vocabulary injected (see decision 5).

### `bkr catalog-merge` — mechanical

Concatenates `inbox/catalog/out/*.jsonl` into `inbox/catalog.jsonl`, deduping on `path+sha256`
(last write wins). Malformed lines are warned and dropped, never fatal. Reports any `in/` batch
with no matching `out/` — that's the retry worklist, and retrying means reissuing just those
`Agent` calls, with no re-extraction (the cache already holds the text). Prints the distinct-
topic histogram, which is the input to the final crunch.

### Final crunch — main thread, no new command

The orchestrating model reads only `inbox/catalog.jsonl` — paths and facets, never file bodies,
so context stays bounded — collapses the topic tail into a small set of wide categories,
proposes it to the user, runs `bkr new-bundle` per approved category, and writes
`inbox/routing.yaml`. This is the step `ingest.md` Phase 0 already describes; only its input
improves, from a blind manifest to facets.

## Files to add / modify

**Add:**

- `scripts/lib/extract.ts` — `extractedPath(hash)`, `extractCached(path, hash, ext)`. Cache hit
  returns `inbox/extracted/<hash>.md`. Miss looks up `ext` in an `EXTRACTORS` map (`.pdf` →
  `pdftotext -layout <file> -`, `.docx` → `pandoc <file> -t gfm`), spawns via `Bun.spawn`,
  writes the cache file with a provenance header in the style of `writeRaw()`
  (`scripts/lib/util.ts:66-75`). Returns `null` on missing tool, non-zero exit, or empty output
  — callers degrade to "pending", never throw.
- `scripts/catalog.ts`, `scripts/catalog-merge.ts` — as specified above.
- `skills/catalog/SKILL.md` — same front-matter shape as `skills/ingest/SKILL.md`. Documents
  the whole orchestration: run `bkr catalog`, seed wave, hold the vocabulary, bulk wave with
  vocabulary injected, `bkr catalog-merge`, retry missing batches, crunch.

**Modify:**

- `scripts/cli.ts:6-16` — register `catalog` and `catalog-merge` in `COMMANDS` (lazy
  `import()`, matching every existing entry).
- `package.json` — script aliases alongside the existing `triage`/`route`/`ingest` ones.
- `scripts/ingest/files.ts:32-38`, `scripts/ingest/folder.ts:36-40` — before logging "pending
  extraction", check the cache; on a hit write it into `raw/` via the existing `writeRaw()`.
  A cache-copy, not a move, so `raw/` stays derived and rebuildable.
- `ingest.md` — insert the catalog step into Phase 0 between triage and clustering, and note
  that `bkr ingest` now transparently reuses the extraction cache.

## Known gaps

- ~~`.odt` is not extractable~~ — **fixed**, see *Extraction moved in-process* below.
- `.xlsx` and `.pptx` are still absent from `EXTRACTABLE` in `scripts/ingest/exts.ts` — 117
  files in the real test corpus. Both are zip+XML, exactly the shape `fflate` already
  handles for `.odt`, so this is now a small addition rather than a new dependency.
- Audio and video stay manual: transcription is minutes of compute per file, so it is an
  explicit Whisper pass in `ingest.md`, not a silent extractor.
- Much of a real corpus is not knowledge at all — photos, `.vcf` contact dumps, browser cache.
  Pruning the manifest between triage and catalog is expected practice, not an edge case.

## Extraction moved in-process (after the first real ingest)

The first real corpus run found the design's biggest wrong assumption: it treated
`pdftotext`/`pandoc` as ambient. They weren't installed, so **0 of 8 extractable files were
read**, and the ingest was unblocked by hand-installing five Python packages plus a
Tesseract binary. bkr is tooling, so it should carry that weight rather than push it onto
the user.

- **PDF/DOCX/ODT are now extracted by bkr itself** — `unpdf` (MIT), `mammoth` (BSD-2),
  `fflate` (MIT). ~5 MB, pure JS, no native build, no PATH assumption. `pdftotext`/`pandoc`
  are kept as an automatic *second* attempt when installed, since poppler still wins on
  awkward layouts, but nothing requires them.
- **Scanned PDFs get their own status.** `unpdf` returns `totalPages` alongside the text, so
  pages-but-no-characters is detectable for free and reported as `scanned`, never `failed`,
  with the list written to `inbox/scanned.jsonl`. Conflating "no extractor" with "no text
  layer" is what sent the first ingest hunting by hand.
- **OCR is opt-in**, behind `bkr catalog --ocr`: `@hyzyla/pdfium` + `sharp` +
  `tesseract.js`, all WASM, no system binary — but ~75 MB plus a one-time language-data
  download, and seconds per page. The cache header records `tool: tesseract.js` so curation
  knows the text is noisier than the rest.
- **`mupdf` was rejected on licensing.** It is the obvious single package for both text and
  rendering, and it is AGPL-3.0-or-later; bkr is MIT and published to npm. pdfium is BSD,
  pdf.js and tesseract.js are Apache-2.0.

## Verification

1. Small mixed scratch corpus (a few `.md`/`.txt` plus a `.pdf`, with `pdftotext` on PATH).
2. `bkr triage <dir>` → `inbox/manifest.jsonl` as today.
3. `bkr catalog --batch 2` → inspect `inbox/catalog/in/*.jsonl`: correct batch sizing, and the
   PDF's snippet carries real extracted text rather than an empty head.
4. Hand-write a fake `inbox/catalog/out/0001.jsonl` and run `bkr catalog-merge` — exercises
   dedupe, malformed-line tolerance, and the missing-batch report without spending any tokens.
5. One real `Agent` call with `model: "haiku"` on a single batch — confirms the subagent honors
   the write-your-own-output-file contract.
6. Hand-write `inbox/routing.yaml`, `bkr new-bundle`, `bkr route`, `bkr ingest <bundle>` —
   confirm `raw/` is populated straight from `inbox/extracted/<hash>.md` with no second
   `pdftotext` invocation (check the cache file's mtime stays unchanged).
7. `bkr lint`.

All seven ran green against a scratch hub, including one real Haiku `Agent` call — the
subagent wrote its own `out/0001.jsonl` exactly to contract, and `bkr ingest` populated
`raw/` from the cache with the cache file's mtime unchanged.

## As built

Deltas from the design above, all discovered while wiring it up:

- **Password-protected rows are skipped**, not just `kind === "skip"` ones. `triage`
  already flags them (`protected: true`), and no converter can open them, so extracting
  them is guaranteed wasted CPU.
- **`bkr catalog` refuses to clobber unmerged labels.** Batch files are a per-run pairing —
  `in/NNNN.jsonl` is answered by `out/NNNN.jsonl` — so a re-run wipes both. If `out/` holds
  files that were never merged, catalog errors and points at `bkr catalog-merge`;
  `--reset` discards them deliberately. `catalog.jsonl` is the only durable home for labels.
- **`bkr catalog-merge` clears `out/` on success** (`--keep` opts out), so the next catalog
  run starts clean and the missing-batch report can't be confused by last run's answers.
- **Shared helpers instead of a third copy.** `scripts/lib/args.ts` (`takeFlag`/`takeValue`)
  and `scripts/lib/progress.ts` (the TTY progress bar) were lifted out of `triage.ts`, which
  now imports them.
- **`extractedBody()`** strips the cache file's own provenance header, so a snippet isn't
  padded with front matter and a `raw/` copy doesn't end up with two headers stacked.
- `AGENT.md`'s command table also gained both commands — an agent reading only the contract
  would otherwise never learn they exist.
