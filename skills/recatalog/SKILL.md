---
name: recatalog
description: Re-catalog a curated bundle and split an overgrown tag into its own bundle — runs khb recatalog for the tag/link census, then khb split to move the link closure. Use when a bundle (usually main) has grown mixed, when the user asks whether a topic deserves its own bundle, or asks to split/reorganize/carve up a bundle.
---

# Recatalog a curated bundle

The late half of phase 0 in [ingest.md](../../ingest.md). Bundles are never chosen from raw
files; this runs after curation, when the concept docs and their tags *are* the catalog. Use it to answer "has something in here become its own topic?" — never
to reorganize on a hunch.

## 1. Census (mechanical)

```
khb recatalog [bundle]        # defaults to the primary bundle; --min N to show smaller tags
```

Writes `inbox/recatalog/<bundle>.json` (every doc's front matter, the link graph, connected
components, per-tag closure) and prints the census.

## 2. Read the closure, not the tag count

The output's `closure` column is the decision. Concept docs link to each other, so pulling a
tag pulls what it links to, and what *those* link to:

- **closure == tag size** → a real bundle. It detaches with every link intact.
- **closure ≫ tag size** → a cross-cutting thread, not a bundle. Splitting it would drag
  unrelated docs along; the graph is telling you these topics are one topic. Leave it as a
  tag and say so.

Size alone never justifies a split. A 40-doc tag whose closure is the whole bundle stays put;
an 8-doc tag that closes cleanly is ready.

## 3. Propose, then move

Show the user the candidate, its closure, and what gets dragged in. On approval:

```
khb split <from> <new-bundle> --tag <t>              # dry run — always read this first
khb split <from> <new-bundle> --tag <t> --apply
```

The move is mechanical: docs, both `index.md` files, `refs.md` both ways, and the `log.md`
rows + `raw/` files + `sources.yaml` paths whose curated output moved entirely. Whole
components move, so no link breaks.

**Read the conflict lines in the dry run.** They report which *other* tags this split takes
docs from: a tag that travels intact is fine, a **torn** tag is the warning. If a torn tag
has most of its docs leaving, it is often the better cut — stop and reconsider the tag you
picked. Splits happen one at a time and each one rewrites the graph, so never plan a
multi-tag carve-up in advance: split once, re-run `khb recatalog`, then decide the next one
against the graph that now exists. A component can break in half when docs leave, turning a
messy tag into a clean one.

Avoid `--only-tagged`. It cuts links deliberately, leaving dangling references (lint L12)
that you must then rewrite as prose plus a `refs.md` pointer — knowledge quietly lost unless
you do that work. If the closure is too big, the answer is usually "don't split", not
"split anyway and cut".

## 4. Finish the job

`khb split` cannot write the one thing that matters most: the new bundle's row in
`outer.index.md`. Fill in its scope and "Route here when" trigger — that row is the reason
the bundle exists. Then read the moved docs' prose for sentences that assumed the old
context, log the split in the meta bundle's decisions if the hub has one, and run `khb lint`.
