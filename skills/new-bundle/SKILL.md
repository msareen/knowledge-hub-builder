---
name: new-bundle
description: Create a new KHB bundle for a topic. Use when the user wants to add a new topic/area to the knowledge base.
---

# New bundle

1. Pick a name: lowercase, digits, hyphens. One topic per bundle — if the scope
   sentence needs "and", make two bundles.
2. Run `khb new-bundle <name> "<one-line scope>"` — scaffolds from
   `.bundle_template/` and registers in `outer.index.md`.
3. Fill in the "Route here when" column in `outer.index.md`.
4. Declare inputs in `sources.yaml` (see the ingest skill to pull them).
5. `khb lint`.
