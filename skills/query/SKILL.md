---
name: query
description: Answer a question from the KHB knowledge base — route to one bundle, search and read its concept docs, and offer to write back any durable new concept the answer produced. Use when the user asks what/why/how about any topic stored in bundles, or asks to look something up in the wiki/knowledge base.
---

# Query KHB

Route from `outer.index.md` to exactly one bundle, enter through that bundle's `index.md`,
answer from concept docs only — then, if answering produced something durable, offer to
keep it. This file is the whole protocol.

## 1. Route to exactly one bundle

`outer.index.md` is one line per bundle, so a hub whose scope lines are thin — or new, or
just growing — will not route a first-time question on description alone. Escalate in this
order and stop at the first step that yields a single bundle:

1. **Read `outer.index.md`.** One bundle obviously owns the question → go. If the hub has
   exactly one bundle, this step is trivially done.
2. **Grep the indexes.** Search the question's key terms across `bundles/*/index.md` and any
   nested `*/index.md`. This is still routing: you are reading routing tables to find the
   door, not answering from what you hit.
3. **Grep concept front matter.** Still inconclusive → search `title`, `description` and
   `tags` across concept docs. Then, if still nothing, full text across concept bodies.
   Never grep `raw/` — it is uncurated, and a hit there is not an answer.
4. **Ask the user.** Two or more bundles still plausible → ask, one option per candidate
   bundle with its scope line, rather than picking one and hoping. In Claude Code that is
   `AskUserQuestion`. A wrong silent guess costs a whole wasted traversal and an answer from
   the wrong domain; the question costs one turn.

Text search is a legitimate way to *find the door*. It is not a way to answer: whatever a
grep hits, go back to the winning bundle's `index.md` and enter through it, so the index
gets a chance to route you to the better doc next to the one you matched.

A question that genuinely needs two bundles is **not** ambiguity — that is the collation
protocol below. Ambiguity is when one bundle owns the answer and you cannot tell which.

Reaching step 3 or 4 means routing failed at step 1. That is an `outer.index.md` defect, not
a user error: sharpen the bundle's scope line so the same question routes at step 1 next
time, and log it in the meta bundle backlog if the hub has one.

## 2. Read

1. `<bundle>/index.md` → follow progressive disclosure (subdirectory indexes) to the concept
   doc(s); use frontmatter `type`/`tags` to filter, and follow in-bundle markdown links for
   related concepts.
2. **Check relevance before you use it.** A doc that matched on a keyword is not necessarily
   about the question. Read enough to confirm it answers what was asked, and discard it
   otherwise — a confidently wrong citation is worse than "the hub doesn't cover this".
3. Answer from concept docs only, never from `raw/`. Cite file paths.

If nothing in the bundle covers the question, say so plainly. Offer to ingest a source that
would, rather than answering from general knowledge as if it came from the hub. If you do
answer from outside the hub, mark clearly which parts those are.

## 3. Cross-bundle query (collation protocol)

When the question spans bundles A and B:

1. Resolve the A-side in bundle A fully.
2. Consult `A/refs.md`. If B is listed, follow it; if not, and B is clearly needed, add the
   ref (bundle, reason) as part of your work.
3. Enter B **via `B/index.md`** — never jump to a B note directly from A's text.
4. Resolve the B-side in bundle B fully.
5. Collate in your answer, not in the files.

Parallel variant: orchestrator dispatches agent 1 → A, agent 2 → B (steps 1 and 4
concurrently), then performs step 5 itself.

## 4. Learn — offer to keep what the answer produced

A query is not always read-only. Sometimes answering means joining two concepts that were
never joined before, and that join is worth more than the one answer it just produced: the
next person to ask gets it for free, and the bundle gets denser rather than just bigger.

**Propose, then write on confirmation.** Never write silently — a bundle that fills up with
restated one-off answers is worse than one that stays thin.

Offer a new concept when **all** of these hold:

- the answer required synthesis across two or more concepts, or resolved something the
  existing docs left implicit;
- the same question is plausibly asked again — it is knowledge, not this conversation;
- no existing concept already covers it (check before offering — folding into an existing
  doc is usually the better move, and is worth offering instead);
- it lives entirely inside one bundle. A synthesis that spans bundles belongs to whichever
  bundle owns the question, phrased in that bundle's terms with a `refs.md` entry to the
  other. Never write merged cross-bundle content into either.

Ask concisely: what you would write, where, and what it would link to. On yes:

1. Write the concept doc with full OKF frontmatter (`type`, `title`, `description`, `tags`,
   `timestamp`), in whichever subdirectory fits — the same rules as
   [catalog](../catalog/SKILL.md).
2. **Link it to the concepts it was derived from, and link those back to it.** A synthesis
   nobody can reach from its sources is a dead end; the back-links are what make the bundle
   denser rather than just longer.
3. Register it in the bundle's `index.md`. Unindexed means invisible to the next query.
4. Note it in `log.md` — source `query: <the question>`, `curated` the new path — so the
   provenance of a doc with no ingested source is still recorded.
5. `khb lint`.

Corrections work the same way: if answering reveals that a concept doc is **wrong** or
stale, say so and offer to fix it in place. That is a repair, not a new concept, and it
still needs confirmation.

## Query hygiene

- Prefer index navigation over grep for *reading*; grep freely for *routing*.
- Never answer from `raw/`. If the only material is raw, say so — the remedy is to catalog
  the bundle, not to cite evidence as knowledge.
- Ask rather than guess a bundle.
- Grep reached a concept the index didn't → fix the index. That is a routing defect the
  query just exposed, and it costs one line to repair.
