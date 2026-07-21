---
name: query
description: Answer a question from the BKR knowledge base. Use when the user asks what/why/how about any topic stored in bundles, or asks to look something up in the wiki/knowledge base.
---

# Query BKR

Route from `outer.index.md` to exactly one bundle, enter through that bundle's
`index.md`, answer from concept docs only. This file is the whole protocol — nothing
outside this folder needs to be read to run a query.

## Single-bundle query (default)

1. **Route to exactly one bundle** — see below.
2. `<bundle>/index.md` → follow progressive disclosure (subdirectory indexes) to the
   concept doc(s); use frontmatter `type`/`tags` to filter, follow in-bundle markdown
   links for related concepts.
3. Answer from concept docs only. Cite file paths.

## Routing (step 1 in detail)

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

## Cross-bundle query (collation protocol)

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

## Query hygiene

- Prefer index navigation over grep; grep only to *route* (see step 1) or when indexes fail
  to reach a concept — then fix the index.
- Never answer from `raw/`; it is uncurated.
- Ask rather than guess a bundle. Answering from the wrong domain is worse than one
  clarifying question.
