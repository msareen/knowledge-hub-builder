---
type: Backlog
description: Planned extractors, ingesters, tooling, and routing defects.
---

# Backlog

## Extraction conventions (agent-run CLIs, one format at a time)

- [x] PDF (pdftotext), DOCX (pandoc/mammoth), Audio (whisper) — documented in AGENT.md
- [ ] PPTX
- [ ] XLSX
- [ ] Images / OCR

## Ingesters

- [x] folder, web (scripted, working)
- [x] confluence, ado — agent-driven via MCP/CLI; promote to scripts only if bulk
      agent-free refresh becomes a real need

## Tooling

- [ ] `ingest` incremental mode (skip unchanged)
- [ ] visualizer: click node → open bundle index

## Routing defects

(log ambiguities found during queries here)
