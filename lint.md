# lint.md — structural rules

Enforced by `bkr lint` (`scripts/lint.ts`). Combines BKR routing rules with
OKF v0.1 conformance (see the OKF spec). Reserved filenames: `index.md`, `log.md`
(OKF) and `refs.md` (BKR). Every other `.md` in a bundle — outside `raw/` —
is a **concept document**.

## Bundle shape

- L1. Every `bundles/<name>/` has: `index.md`, `refs.md`, `sources.yaml`. Concept docs
  live in whatever subdirectory grouping fits the domain. No per-bundle AGENT.md —
  root `AGENT.md` is the common contract; `bkr export` injects it for standalone
  sharing.
- L2. Bundle names: lowercase, digits, hyphens (`^[a-z0-9][a-z0-9-]*$`).

## Routing integrity

- L3. Every bundle is listed in `outer.index.md`; every bundle linked from
  `outer.index.md` exists on disk.
- L4. Every concept doc is listed in at least one of the bundle's `index.md` files
  (error). Index links pointing at missing files are a warning only — OKF treats
  broken links as not-yet-written knowledge.
- L5. Index files contain routing only: headings, bullet/table link lines, one-line
  descriptions. Paragraph-length prose is a violation (warning).

## Independence

- L6. No markdown link from a concept doc into another bundle's files. Cross-bundle
  pointers live in `refs.md` only.
- L7. Every target bundle named in `refs.md` exists.

## Provenance

- L8. Files under `raw/` carry a provenance header (`source:` + `fetched:` front
  matter). (warning)

## OKF conformance

- L9. Every concept doc has YAML frontmatter with a non-empty `type` field
  (OKF v0.1 §9). Recommended fields: `title`, `description`, `resource`, `tags`,
  `timestamp`. Unknown types and extra keys are always allowed.
