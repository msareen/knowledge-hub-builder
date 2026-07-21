---
name: catalog
description: Label a triaged corpus so a bundle set can be proposed from evidence instead of filenames — runs khb catalog, fans out cheap Haiku subagents over the batch files, merges the facets, then collapses them into wide bundle-sized categories. Use after khb triage on a large mixed corpus whose bundles are not yet known.
---

# Catalog a triaged corpus

Phase 0 of the [ingest skill](../ingest/SKILL.md), between `khb triage` and writing
`inbox/routing.yaml`. Only needed when the bundle set is an *output* of looking at the
data. If you already know the bundles, skip straight to `inbox/routing.yaml`.

The design is deliberately Claude-specific and stated out loud: `khb` stays mechanical and
dependency-free, and the labeling brain is a subagent fan-out you orchestrate from this
session. No MCP, no API keys, no model calls inside `khb`.

## 1. Build the batches (mechanical)

```
khb catalog                # or --batch N (default 100 files per batch)
```

Extracts text for every non-skip, non-protected manifest row — PDF/DOCX/ODT with khb's own
bundled libraries, cached at `inbox/extracted/<sha256>.md` — and writes
`inbox/catalog/in/NNNN.jsonl`, one `{path, sha256, ext, name, size, snippet}` row per file.

Watch the summary for two non-failures. **Scanned PDFs** (pages, no text layer) are listed
in `inbox/scanned.jsonl`; they need `bun add @hyzyla/pdfium sharp tesseract.js` and then
`khb catalog --ocr`. **Audio and video** are never extracted here at all — transcribe them
with Whisper per the ingest skill if the corpus needs them. Both are worth raising with the user
before labeling, since neither is in the batches and both cost real time.

Rows already in `inbox/catalog.jsonl` are skipped, so re-running after narrowing scope is
cheap. **Prune the manifest first** if triage swept up junk (browser caches, photo dumps,
`.vcf` exports) — that is expected practice, and it is the only checkpoint before you start
spending CPU and tokens.

## 2. Seed wave — establish the vocabulary

Run **one** batch first, with `Agent(model: "haiku")`. Then read the `topic` values out of
its output file and hold them in this thread. That list is the working vocabulary.

## 3. Bulk wave — label the rest in parallel

Issue one `Agent(model: "haiku")` call per remaining batch file, all in one message so they
run in parallel. Parallel subagents cannot see each other's labels, so **every bulk-wave
prompt must carry the seed vocabulary** — otherwise you get `invoices` / `billing` / `bills`
as three separate topics.

Prompt each subagent with, substituting the batch number and vocabulary:

> Read `inbox/catalog/in/NNNN.jsonl`. Each line is a file with a text snippet.
> For every line, emit exactly one JSON object:
> `{"path","sha256","topic","doc_type","project","summary"}`
> — `path` and `sha256` copied verbatim from the input;
> — `topic` a lowercase kebab-case subject area;
> — `doc_type` what kind of document it is (invoice, contract, spec, notes, report, …);
> — `project` the named project/client/entity it belongs to, or `""` if none is evident;
> — `summary` one sentence, under 20 words.
> Reuse one of these existing topics unless nothing fits; only then coin a new one:
> `<vocabulary>`
> Write the result to `inbox/catalog/out/NNNN.jsonl`, one object per line, nothing else.
> Do not read any file other than your own batch. Reply with just the row count.

The output **file** is the product — the subagent's prose reply is discarded.

## 4. Merge

```
khb catalog-merge
```

Folds `out/*.jsonl` into `inbox/catalog.jsonl`, deduping on `path+sha256`, and prints the
distinct-topic histogram. Any batch it reports as never labeled is the retry worklist:
reissue just those `Agent` calls. Retrying costs only the model call — the extracted text is
already cached.

## 5. Crunch (this thread, no command)

Read `inbox/catalog.jsonl` — **paths and facets only, never file bodies**, which is what
keeps this step's context bounded. Collapse the topic tail into a small set of wide,
bundle-sized categories (a bundle is a domain, not a folder). Propose them to the user, then
per approved category:

```
khb new-bundle <name> "<scope>"
```

Write `inbox/routing.yaml` from the facets, `khb route`, then `khb ingest <bundle>` per
bundle — which reuses the same extraction cache, so no PDF is converted twice. Continue with
phase 2 curation in [ingest skill](../ingest/SKILL.md), and finish with `khb lint`.
