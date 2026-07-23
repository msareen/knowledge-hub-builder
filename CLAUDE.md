# CLAUDE.md

KHB is agent-agnostic; this file is only a Claude-specific shim.

All rules live in the common contract: @AGENT.md

Skills for common workflows live in `skills/<name>/SKILL.md` — use them for
querying, ingesting, cataloging, linting, creating, visualizing, and exporting bundles.
Note the split: `ingest` acquires and extracts (mechanical), `catalog` turns `raw/` into
concept docs (judgement, no CLI command).
Each `SKILL.md` is self-contained: the whole protocol is in that one file, no root-level
companion doc to chase.
