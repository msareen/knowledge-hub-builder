---
name: export
description: Export a KHB bundle as a standalone shareable folder with the common patterns injected. Use when the user wants to share or ship a single bundle.
---

# Export a bundle

Bundles stay lean inside the hub because the common patterns live at hub root; export
injects those patterns so the folder works alone with any agent.

1. Run `khb export <bundle> [dest]` (default dest: `export/<bundle>/`). The command
   **refuses to write into an existing destination** — re-exporting means removing the old
   folder first, or passing a new `dest`.
2. The result is a miniature hub, with the bundle itself one level down:

   ```
   <dest>/bundle/            the bundle, copied whole
   <dest>/outer.index.md     single-bundle router pointing at bundle/index.md
   <dest>/AGENTS.md          the contract, plus CLAUDE.md
   <dest>/skills/            the canonical protocols (query, ingest, lint, …)
   <dest>/.claude/skills/    discovery adapters, and .agents/skills/ likewise
   <dest>/README.md          provenance: what this is and when it was exported
   ```

3. Tell the user two things before they send it anywhere:
   - `refs.md` entries pointing at other bundles **will not resolve** — the export is one
     bundle, and its cross-bundle pointers now dangle.
   - The copy is literal, so `raw/` and `log.md` go with it. `log.md` records **absolute
     source paths** from the machine that ingested them, and `raw/` is uncurated source
     material that was never written for an outside reader. Check both before sharing
     outside the team, and prune if they say more than intended.
