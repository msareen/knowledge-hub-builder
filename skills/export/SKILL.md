---
name: export
description: Export a KHB bundle as a standalone shareable folder with the common patterns injected. Use when the user wants to share or ship a single bundle.
---

# Export a bundle

1. Run `khb export <bundle> [dest]` (default dest: `export/<bundle>/`).
2. Result contains the bundle plus `AGENTS.md`, the Claude/Codex discovery adapters, the
   whole canonical `skills/` folder (query, ingest, lint, … protocols), a single-bundle
   `outer.index.md`, and a README with provenance.
3. Warn the recipient-facing caveat: `refs.md` entries to other bundles won't resolve
   standalone.
