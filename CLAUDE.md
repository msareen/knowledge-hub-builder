# CLAUDE.md

KHB is agent-agnostic; this file is only a Claude-specific shim.

@AGENTS.md

Claude discovers the workflow adapters in `.claude/skills/`. Each adapter points to the
canonical protocol in `skills/<name>/SKILL.md`; use them for querying, ingesting,
cataloging, linting, creating, visualizing, and exporting bundles.
Note the split: `ingest` acquires and extracts (mechanical), `catalog` turns `raw/` into
concept docs (judgement, no CLI command).
Each canonical `skills/<name>/SKILL.md` is self-contained: the whole protocol is in that
one file, with no root-level companion doc to chase.
