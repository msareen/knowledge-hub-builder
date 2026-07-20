# {{name}} — ingest log

Ingestion ledger, one row per source. `bun run ingest` maintains `source`, `sha256`,
`fetched` and `raw`; the agent fills `curated` during phase 2 of ingest.md.

Empty `raw` = acquired-but-not-extracted (binary awaiting a CLI pass).
Empty `curated` = in raw/ but not yet distilled into a concept doc.

| source | sha256 | fetched | raw | curated |
|---|---|---|---|---|
