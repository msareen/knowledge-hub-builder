---
name: ingest
description: Ingest external material (folders, web pages, Confluence, ADO, PDF, DOCX, audio) into a KHB bundle and curate it into concept docs, including triaging a large mixed corpus. Use when the user wants to add, import, dump, or refresh data in the knowledge base.
---

# Ingest into KHB

Read [ingest.md](../../ingest.md) and follow its phases exactly: triage first if the
corpus is bulk, then acquire into `raw/`, then curate into concept docs. Never skip to
curation.

Do not design a bundle set before ingesting. `khb triage <path...>` lands the whole corpus
in the hub's primary bundle by default, and that is the right answer for a first corpus:
you cannot name good bundles from filenames you haven't read. Give the concept docs honest
`type` and `tags` during curation — that is where the distinctions live — and split a tag
out later with the `recatalog` skill, once it has the docs to justify one. The only up-front
choice worth making is `khb triage <path> --to <bundle>`, when a boundary already exists:
a client, a confidentiality level, a corpus two agents will work in parallel.

Keep each bundle's `log.md` ledger current — its empty `raw`/`curated` columns are the
worklist, and nothing else records it.

Finish with `khb lint` and fix every error.
