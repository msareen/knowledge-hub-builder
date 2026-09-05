---
type: Playbook
title: KHB end-to-end workflow
description: The whole path from an empty folder to an answer — and which steps are mechanical versus which spend tokens.
tags: [workflow, ingest, catalog, query, cost]
timestamp: 2026-09-05T00:00:00Z
---

# KHB end-to-end workflow

One pass from an empty folder to an answered question. Each step names the command that
does it, and whether it is **mechanical** (`khb`: deterministic, offline, no model, free) or
**judgement** (an agent reading and writing: this is where tokens go). That split is the
[division of labor](decisions.md) the whole tool is built around — conversion belongs to the
CLI, interpretation to an agent.

```
   MECHANICAL — khb only. Deterministic, offline, contacts no model, costs no tokens.
  ═══════════════════════════════════════════════════════════════════════════════════

   khb init
        │      creates the hub: khb.json · outer.index.md · bundles/
        ▼
   khb new-bundle <name> "<scope>"                                    ×N, as needed
        │      one bundle per *owner* — a person, a team, a client, a project.
        │      Never split by subject; topics live in subdirectories inside a bundle.
        │      Name none and material lands in `default`, a landing place, not a bin.
        │      → index.md · refs.md · sources.yaml · log.md
        ▼
   edit bundles/<name>/sources.yaml                          ← your decision, one file
        │      folders, files, urls (+ optional exclude:). Nothing is copied yet.
        ▼
   khb ingest <bundle>
        │      every declared source → bundles/<name>/raw/*.md, one log.md row each
        │      text · PDF · DOCX · ODT · XLSX · PPTX · OneNote · OCR · whisper · captions
        │      embedded files are unpacked and ingested as sources of their own
        │      re-runs skip anything whose content hash has not changed
        ▼
  ═══════════════════════════════════════════════════════════════════════════════════
   JUDGEMENT — an agent. This is what spends tokens.
  ═══════════════════════════════════════════════════════════════════════════════════

   catalog   (no command — it is a reading pass; skills/catalog/SKILL.md)
        │      raw/*.md → concept docs with OKF front matter, linked, listed in index.md,
        │      and the log.md `curated` column filled in
        │      COST: scales with the corpus. Every raw file is read once, so this is the
        │      expensive step — and the only one that turns text into knowledge.
        │      Parallelizable: fan subagents over raw files, orchestrator alone writes
        │      index.md / log.md / refs.md.
        ▼
   query     (no command — skills/query/SKILL.md)
        │      outer.index.md ─► one bundle's index.md ─► only the concepts it routes to
        │      cross-bundle: resolve in the first, follow refs.md, enter the second
        │      through its own index.md. Join answers in the reply, never in the files.
        │      COST: bounded by routing, not by hub size. Two hops then a handful of
        │      files — which is the reason the router exists at all.
        ▼
     an answer, cited to concept docs (never to raw/)

   ANY TIME, MECHANICAL:  khb lint · khb doctor · khb visualize · khb export · khb upgrade
```

## Why the split is drawn there

`khb` converts bytes to text — hashing, caching, ledger-keeping, and every extractor
(PDF/DOCX/ODT/XLSX/PPTX libraries, pyOneNote, tesseract OCR, whisper). All of it
reproducible and free of charge, and none of it contacts a model. An agent decides what the
text *means*: which concepts a document holds, how they link, when a query has produced
something worth keeping.

The line is *conversion vs. interpretation*, not cheap vs. expensive — tesseract and whisper
cost real CPU and still belong to `khb`, because their output needs no judgement. Keeping it
there is what makes the token cost predictable: ingest as much as you like for free, then
spend judgement once per source at catalog time, and per question at query time.

## What each step leaves behind

| Step | Writes | Durable record |
|---|---|---|
| `khb init` | hub skeleton + contract docs | `khb.json` stamps the khb version |
| `khb new-bundle` | bundle skeleton, registered in `outer.index.md` | the bundle folder |
| `khb ingest` | `raw/*.md` (+ unpacked attachments) | `log.md` rows: source, hash, fetched, raw |
| catalog | concept docs, `index.md` entries | `log.md` `curated` column |
| query | optionally a new concept doc, on confirmation | the concept + its index entry |

`raw/` is gitignored and re-derivable; `log.md` is the durable ledger across both halves,
and its empty `curated` cells *are* the catalog backlog. A row with an empty `raw` is a
source khb saw and could not convert — the per-file line said why.
