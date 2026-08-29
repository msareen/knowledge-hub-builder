---
name: lint
description: Validate KHB structure (routing integrity, bundle shape, OKF conformance). Use after any structural edit, or when the user asks to check/validate/fix the knowledge base.
---

# Lint KHB

1. Run `khb lint` from anywhere inside the hub — it walks up to `khb.json` to find the root.
2. Fix every ERROR (structure, routing, OKF frontmatter); judge warnings case by case
   (broken index links may be intentional not-yet-written knowledge).
3. Re-run until 0 errors. If a fix changes root files **and the hub has a `meta` bundle**,
   log it in `bundles/meta/notes/decisions.md`. No meta bundle means no decision log — do
   not create one to have somewhere to write.

## The rules (L1–L11)

Enforced by `khb lint`. Combines KHB routing rules with
OKF v0.1 conformance (see the OKF spec). Reserved filenames: `index.md`, `log.md`
(OKF) and `refs.md` (KHB). Every other `.md` in a bundle — outside `raw/` —
is a **concept document**.

### Bundle shape

- L1. Every `bundles/<name>/` has: `index.md`, `refs.md`, `sources.yaml`. Concept docs
  live in whatever subdirectory grouping fits the domain. No per-bundle AGENTS.md —
  root `AGENTS.md` is the common contract; `khb export` injects it for standalone
  sharing.
- L2. Bundle names: lowercase, digits, hyphens (`^[a-z0-9][a-z0-9-]*$`).

### Routing integrity

- L3. Every bundle is listed in `outer.index.md`; every bundle linked from
  `outer.index.md` exists on disk.
- L4. Every concept doc is listed in at least one of the bundle's `index.md` files
  (error). Index links pointing at missing files are a warning only — OKF treats
  broken links as not-yet-written knowledge. A `#section` suffix names a place inside
  the target and is dropped before the path is checked.
- L5. Index files contain routing only: headings, bullet/table link lines, one-line
  descriptions. Paragraph-length prose is a violation (warning).

### Independence

- L6. No markdown link from a concept doc into another bundle's files. Cross-bundle
  pointers live in `refs.md` only.
- L7. Every target bundle named in `refs.md` exists.
- L11. Markdown links *within* a bundle resolve to a file that exists (warning). Concept
  links are the bundle's real structure — the catalog cross-link pass and the back-links
  the query skill writes from a synthesis to its sources are both made of them, and a
  synthesis nobody can reach from its sources is a dead end. A warning rather than an
  error, for L4's reason: a link to a concept somebody means to write next is
  not-yet-written knowledge.

### Provenance

- L8. Files under `raw/` carry a provenance header (warning): frontmatter present, a
  non-empty `source:`, and `quality:` — if set — reading exactly `high` or `low`.
  `source` is what makes a bad extraction recoverable, so a raw file without one is
  uncatalogable, not merely untidy.
- L10. `log.md` still describes what is on disk. It is the durable record across ingest
  and catalog, and its empty `curated` cells *are* the catalog backlog, so a row that has
  come loose from its files misreports the work outstanding:
  - a `curated` path names a file that exists (**error**). `declined` is the documented
    way to close a row without a concept and is accepted as-is; anything else is a path
    the row claims to have written, and unlike a link there is no not-yet-written case —
    the column is filled only once the concept exists. Renaming a concept after
    cataloging is what usually breaks it.
  - a row's `raw` path names a file that exists (warning), checked **only** when `raw/`
    has files in it. `raw/` is gitignored and re-derivable, so a hub that was cloned
    rather than ingested has every row and no files at all — that is an ordinary state,
    not a finding.
  - every `.md` under `raw/` has a row (warning). An extracted file no row names is
    invisible work: never offered as backlog, so it stays uncurated without ever looking
    outstanding.

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
  - unknown top-level keys (warning). The known set is `type`, `title`, `description`,
    `resource`, `tags`, `timestamp` — `resource` is optional and unvalidated, but it is
    known, so it costs no warning. OKF is permissive and extra keys are legal, but `titel:`
    is a typo that silently drops the field, and one warning line is cheaper than a field
    nobody notices is missing.
