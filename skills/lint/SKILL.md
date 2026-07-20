---
name: lint
description: Validate BKR structure (routing integrity, bundle shape, OKF conformance). Use after any structural edit, or when the user asks to check/validate/fix the knowledge base.
---

# Lint BKR

Rules are defined in [lint.md](../../lint.md) (L1–L9).

1. Run `bun run lint` from the repo root.
2. Fix every ERROR (structure, routing, OKF frontmatter); judge warnings case by case
   (broken index links may be intentional not-yet-written knowledge).
3. Re-run until 0 errors. If a fix changes root files, log it in
   `bundles/meta/notes/decisions.md`.
