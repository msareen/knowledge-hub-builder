# lint.md — structural rules

Enforced by `khb lint` (`scripts/lint.ts`). Combines KHB routing rules with
OKF v0.1 conformance (see the OKF spec). Reserved filenames: `index.md`, `log.md`
(OKF) and `refs.md` (KHB). Every other `.md` in a bundle — outside `raw/` —
is a **concept document**.

## Bundle shape

- L1. Every `bundles/<name>/` has: `index.md`, `refs.md`, `sources.yaml`. Concept docs
  live in whatever subdirectory grouping fits the domain. No per-bundle AGENT.md —
  root `AGENT.md` is the common contract; `khb export` injects it for standalone
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
- L12. Every in-bundle link from a concept doc resolves (warning). A doc that left the
  bundle — `khb split --only-tagged` is the usual cause — leaves its inbound links pointing
  at nothing; they are not L6 errors because they no longer name a bundle at all, and
  silence is the wrong answer. Rewrite each as prose plus a `refs.md` pointer.

## Provenance

- L8. Files under `raw/` carry a provenance header (`source:` + `fetched:` front
  matter). (warning)

## Derived answers (query.md fold 2)

A concept doc filed back from a query carries `derived_from: [<paths>]` — the docs it was
synthesized from. Both rules are warnings: a stale derivation is still knowledge, it just
needs rechecking.

- L10. Every `derived_from` entry resolves to a file inside the same bundle (paths are
  bundle-relative or relative to the doc). Cross-bundle derivation is not expressible here
  — that is `refs.md` (see L6). The doc must also link at least one of its sources inline;
  a derivation nothing points back at is an orphan.
- L11. If any `derived_from` source has a newer `timestamp` than the derived doc, the
  derivation **may be stale** — the source changed after the synthesis was written.
  Recheck it and refresh the derived doc's `timestamp` once confirmed. A doc with
  `derived_from` but no parsable `timestamp` warns too: staleness can't be checked.

## OKF conformance

- L9. Every concept doc has YAML frontmatter with a non-empty `type` field
  (OKF v0.1 §9). Recommended fields: `title`, `description`, `resource`, `tags`,
  `timestamp`. Unknown types and extra keys are always allowed.
