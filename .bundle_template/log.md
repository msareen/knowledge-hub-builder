# {{name}} — ingest log

Ingestion ledger, one row per source. `khb ingest` maintains `source`, `sha256`,
`fetched` and `raw`; the agent fills `curated` while cataloging (skills/catalog/SKILL.md).

Empty `raw` = seen but not extracted (protected, unreadable, or skipped by a flag).
Empty `curated` = in raw/ but not yet distilled into a concept doc.

| source | sha256 | fetched | raw | curated |
|---|---|---|---|---|
