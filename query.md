# query.md — how to query BKR

## Single-bundle query (default)

1. `outer.index.md` → choose one bundle.
2. `<bundle>/index.md` → follow progressive disclosure (subdirectory indexes) to the
   concept doc(s); use frontmatter `type`/`tags` to filter, follow in-bundle markdown
   links for related concepts.
3. Answer from concept docs only. Cite file paths.

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

- Prefer index navigation over grep; grep only when indexes fail, then fix the index.
- Never answer from `raw/`; it is uncurated.
- If routing was ambiguous at step 1, that is an outer.index defect — note it in the meta
  bundle backlog.
