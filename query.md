# query.md — how to query KHB

A query has **two folds**. Fold 1 answers the question. Fold 2 decides whether the answer
is itself knowledge, and files it back into the bundle. A hub where only ingestion writes
compounds at the rate you feed it; a hub where querying also writes compounds at the rate
you *use* it. Fold 2 is not optional politeness — skipping it silently is how the same
synthesis gets rebuilt from scratch every month.

## Fold 1 — answer

### Single-bundle query (default)

1. **Route to exactly one bundle** — see below.
2. `<bundle>/index.md` → follow progressive disclosure (subdirectory indexes) to the
   concept doc(s); use frontmatter `type`/`tags` to filter, follow in-bundle markdown
   links for related concepts.
3. Answer from concept docs only. Cite file paths.

### Routing (step 1 in detail)

`outer.index.md` is one line per bundle, so a hub whose scope lines are thin — or new, or
just growing — will not route a first-time question on description alone. Do not guess, and
do not start reading bundles to find out. Escalate in this order and stop at the first step
that yields a single bundle:

1. **Read `outer.index.md`.** One bundle obviously owns the question → go.
2. **Search the indexes.** Grep the question's key terms across `bundles/*/index.md` and any
   nested `*/index.md`. This is still index navigation: you are reading routing tables to
   find the door, not answering from what you hit. Never answer from a search hit — go back
   to the winning bundle's `index.md` and enter through it.
3. **Search concept front matter.** Still inconclusive → grep `title`, `description` and
   `tags` across concept docs. Same rule: the hit tells you the bundle, then you re-enter
   through `index.md`. Never grep `raw/`.
4. **Ask the user.** Two or more bundles still plausible → ask, with one option per
   candidate bundle and its scope line, rather than picking one and hoping. In Claude Code
   that is `AskUserQuestion`. A wrong silent guess costs a whole wasted traversal and an
   answer sourced from the wrong domain; the question costs one turn.

A question that genuinely needs two bundles is **not** ambiguity — that is the collation
protocol below. Ambiguity is when one bundle owns the answer and you cannot tell which.

Every time you reach step 3 or 4, routing failed at step 1. That is an `outer.index.md`
defect, not a user error: sharpen the bundle's scope line so the same question routes at
step 1 next time, and log it in the meta bundle backlog if the hub has one.

### Cross-bundle query (collation protocol)

When the question spans bundles A and B:

1. Resolve the A-side in bundle A fully.
2. Consult `A/refs.md`. If B is listed, follow it; if not, and B is clearly needed, add the
   ref (bundle, reason) as part of your work.
3. Enter B **via `B/index.md`** — never jump to a B note directly from A's text.
4. Resolve the B-side in bundle B fully.
5. Collate in your answer. Do not write merged content into either bundle; if the joined
   insight is durable, it belongs in whichever bundle owns the question, phrased in that
   bundle's own terms with a ref to the other.

Parallel variant: orchestrator dispatches agent 1 → A, agent 2 → B (steps 1 and 4
concurrently), then performs step 5 itself.

## Fold 2 — file the answer back

Run this after every answer, single-bundle or collated. Most of the time it takes one
sentence to conclude "nothing durable here" — that is a valid outcome, not a skipped step.

### Does it qualify?

File back when **any** of these hold:

- The answer combined two or more concept docs into something neither one states.
- The answer required judgement — a comparison, a ranking, a trade-off, a "why", a
  reconciliation of two docs that disagreed.
- Getting there was hard: the traversal was long, or you had to reason around a gap.

Do **not** file back a lookup that one concept doc already answers verbatim, a restatement
in different words, or anything about this session rather than the domain. Duplicating a
doc is worse than not writing: it splits the topic and the next query routes to the stale
half.

### Choose the outcome — revision is the default

1. **Revise an existing concept.** If a doc already owns this topic and was merely thin,
   stale, wrong, or missing the connection you just made, *rebuild that doc*. Fold the new
   synthesis into its prose, refresh `timestamp`, sharpen `description`. This is the common
   case and the one that keeps the bundle from sprawling.
2. **New concept doc.** Only when no existing doc owns the topic. Before writing, grep
   `title`/`description`/`tags` across the bundle's concept docs to confirm — the hit you
   find is outcome 1.
3. **Structural fix only.** The knowledge was already there but you couldn't find it →
   fix the router, not the content: sharpen the bundle's scope line in `outer.index.md` or
   the concept's description in `index.md`. Reaching routing step 3 or 4 always implies
   this, whether or not you also write a doc.
4. **Nothing.**

### Writing it

- **Bundle:** the one that owns the question. For a collated answer that stays true —
  resolve which bundle owns it, write it there in that bundle's own vocabulary, and record
  the other side as a `refs.md` entry. Never write the merged doc into both, and never
  inline-link across bundles (lint L6).
- **Frontmatter:** normal concept frontmatter, with `type` naming the *form* of the answer
  (`Comparison`, `Analysis`, `Synthesis`, `Decision Log`, …), plus derivation provenance:

  ```yaml
  ---
  type: Comparison
  title: Warehouse vs. lakehouse cost model
  description: One-line summary of what the comparison concluded.
  derived_from: [tables/warehouse_spend.md, metrics/query_cost.md]
  question: "which is cheaper for our nightly rollups?"
  timestamp: 2026-07-21T00:00:00Z
  ---
  ```

  `derived_from` is the audit trail: when a source doc changes, these are the docs to
  recheck. Also link those docs inline in the prose — a derived doc with no inbound or
  outbound links is an orphan.
- **Register it** in the bundle's `index.md` as a routing line (`* [Title](path.md) -
  description`) — never paste the content into the index.
- **Rendered forms** (deck, chart, table image) are artifacts, not knowledge. Keep the
  substance and the underlying numbers in the markdown concept doc so it can be
  regenerated; park the artifact beside it and link to it from the doc.
- Run `khb lint` afterwards.

### Confirm before writing

Propose the outcome before you act: path, new-or-revision, `type`, one-line description.
Write on the user's go-ahead. Revisions especially — you are overwriting curated knowledge,
and the person who curated it gets the call. Never file back silently.

A filed answer is a first-class concept from then on: later queries route to it, cite it,
and may in turn rebuild it. That is the compounding.

## Query hygiene

- Prefer index navigation over grep; grep only to *route* (see step 1) or when indexes fail
  to reach a concept — then fix the index.
- Never answer from `raw/`; it is not curated.
- Ask rather than guess a bundle. Answering from the wrong domain is worse than one
  clarifying question.
