---
name: ingest
description: Ingest external material (folders, web pages, Confluence, ADO, PDF, DOCX, audio) into a BKR bundle and curate it into concept docs, including triaging a large mixed corpus across multiple bundles. Use when the user wants to add, import, dump, or refresh data in the knowledge base.
---

# Ingest into BKR

Read [ingest.md](../../ingest.md) and follow its phases exactly: triage first if the
corpus is bulk and its bundles aren't known yet, then acquire into `raw/`, then curate
into concept docs. Never skip to curation.

Keep each bundle's `log.md` ledger current — its empty `raw`/`curated` columns are the
worklist, and nothing else records it.

Finish with `bkr lint` and fix every error.
