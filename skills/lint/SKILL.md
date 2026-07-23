---
name: lint
description: Validate KHB structure (routing integrity, bundle shape, OKF conformance). Use after any structural edit, or when the user asks to check/validate/fix the knowledge base.
---

# Lint KHB

1. Run `khb lint` from the hub root.
2. Fix every ERROR (structure, routing, OKF frontmatter); judge warnings case by case
   (broken index links may be intentional not-yet-written knowledge).
3. Re-run until 0 errors. If a fix changes root files, log it in
   `bundles/meta/notes/decisions.md`.

## The rules (L1–L9)

Enforced by `khb lint` (`scripts/lint.ts`). Combines KHB routing rules with
OKF v0.1 conformance (see the OKF spec). Reserved filenames: `index.md`, `log.md`
(OKF) and `refs.md` (KHB). Every other `.md` in a bundle — outside `raw/` —
is a **concept document**.

### Bundle shape

- L1. Every `bundles/<name>/` has: `index.md`, `refs.md`, `sources.yaml`. Concept docs
  live in whatever subdirectory grouping fits the domain. No per-bundle AGENT.md —
  root `AGENT.md` is the common contract; `khb export` injects it for standalone
  sharing.
- L2. Bundle names: lowercase, digits, hyphens (`^[a-z0-9][a-z0-9-]*$`).

### Routing integrity

- L3. Every bundle is listed in `outer.index.md`; every bundle linked from
  `outer.index.md` exists on disk.
- L4. Every concept doc is listed in at least one of the bundle's `index.md` files
  (error). Index links pointing at missing files are a warning only — OKF treats
  broken links as not-yet-written knowledge.
- L5. Index files contain routing only: headings, bullet/table link lines, one-line
  descriptions. Paragraph-length prose is a violation (warning).

### Independence

- L6. No markdown link from a concept doc into another bundle's files. Cross-bundle
  pointers live in `refs.md` only.
- L7. Every target bundle named in `refs.md` exists.

### Provenance

- L8. Files under `raw/` carry a provenance header (warning): frontmatter present, a
  non-empty `source:`, and `quality:` — if set — reading exactly `high` or `low`.
  `source` is what makes a bad extraction recoverable, so a raw file without one is
  uncatalogable, not merely untidy.

### OKF conformance

- L9. Concept frontmatter is the machine-readable half of a concept, so it is validated
  as data rather than glanced at:
  - frontmatter block present, and **parses as YAML** (error) — a malformed block means
    every field is silently lost.
  - non-empty `type` (error) — the one OKF v0.1 §9 requirement. Its *value* stays
    free-form: `Metric`, `Playbook`, `Runbook`, anything the domain needs.
  - `title` and `description` present (warning) — indexes and index generators read them.
  - `tags`, if present, is a YAML list of strings (error). `tags: "a, b"` is a string and
    filters as one opaque value; `tags: [a, b]` is two tags.
  - `timestamp`, if present, parses as an ISO-8601 datetime (warning).
  - unknown top-level keys (warning). OKF is permissive and extra keys are legal, but
    `titel:` is a typo that silently drops the field, and one warning line is cheaper than
    a field nobody notices is missing.
