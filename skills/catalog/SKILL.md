---
name: catalog
description: Turn one bundle's raw/ material into OKF concept docs — quote the token cost with khb estimate and get the user's model and effort first, then read each raw file, split it into sub-topics, label each with type/title/description/tags, link them, and register them in index.md. Uses parallel subagents when the runtime supports them. Use after khb ingest, or when the user asks to curate, catalog, organize, or write up a bundle.
---

# Catalog a bundle

The second half of the pipeline: `khb ingest` produced faithful text in `raw/`; catalog
turns that text into **knowledge**. One bundle at a time, always.

The unit of output is the **concept** — one idea, one markdown file, OKF frontmatter,
registered in an index. A raw file is not a concept. A 40-page contract is a dozen concepts;
three meeting transcripts about the same decision are one. Splitting and merging is the
whole job, and it is why this pass needs a model and `khb ingest` does not.

`khb` has no `catalog` command. Nothing here is mechanical enough to script.

**Catalog classifies concepts and links them. It never reorganizes bundles.** The splitting
it does is *within* a bundle — raw files into concepts, concepts into subdirectories. A
bundle is a logical unit its owner defined (a person, a team, a project) and it holds many
topics by design, so finding three unrelated subjects in one bundle is the expected case,
not a problem to fix. Never create a bundle, move material to another bundle, or propose a
split because the contents look heterogeneous. If material clearly belongs to someone else,
it gets a `refs.md` line and stays where it is.

## 1. Scope the work

```
khb ingest <bundle>          # if the user asked to catalog something not yet ingested
```

That only moves bytes for sources already declared in the bundle's `sources.yaml`; if the
material isn't declared yet, you are at the start of the [ingest skill](../ingest/SKILL.md),
not this one.

The worklist is `bundles/<bundle>/log.md`: **every row with a `raw` path and an empty
`curated` column.** Nothing else records what is outstanding, so work from the ledger rather
than from a directory listing — a `raw/` file whose row is already filled has been done.

Rows with an empty `raw` were never extracted; they are ingest's problem, not yours. If
there are many, say so and offer to fix ingest first.

## 2. Quote the cost — then stop

**`khb ingest` is free; this pass is not.** It reads every raw file through a model and
writes concepts back, so a corpus that took an afternoon to extract can run to millions of
tokens. A file count does not tell anyone that, and finding it out from a bill is not
acceptable. Quote it first, every time — even when the user has already said "catalog it".

```
khb estimate <bundle>        # tokens, in millions, at low / medium / high effort
khb estimate <bundle> --json # the same numbers, for you to reason over
```

It counts the words and characters actually on disk and multiplies them by published
coefficients. It writes nothing, calls no model, and quotes no prices — it does not know
what anything costs.

**Pricing it is your job, and it is the reason you stop here.** Take the token numbers,
apply the current published rates for the models you would actually use, and put the money
in front of the user:

- Give a **range**, not a point: quote at least the fast/cheap model and the strong model,
  at the effort you would recommend. The gap between them is usually the whole decision.
- Say what the effort levels buy, in this bundle's terms — not as abstractions. `low` is one
  pass and terse concepts, `medium` is the protocol below as written, `high` is fine-grained
  splitting with low-quality sources re-read at the source.
- Name the biggest files. `khb estimate` lists them, and on most corpora a handful of scans
  or transcripts carry most of the cost. Dropping or deferring those is often the cheapest
  real option, and the user cannot choose it if you do not offer it.
- Say plainly that these are estimates from character counts, and a real run lands either
  side of them.
- If the user gave you rates, or you want khb to do the arithmetic:
  `khb estimate <bundle> --price <in>/<out>` (USD per million tokens).

Then **wait.** Do not start the seed wave, do not spawn a subagent, do not write a concept
doc until the user has answered with a model and an effort level. Two things they routinely
change once they see the number — narrowing the scope to part of the corpus, or running the
bulk wave on a cheaper model than the one they are talking to you on — are only available
before the pass starts.

The one case for skipping the wait is a backlog small enough that the question wastes more of
the user's time than the run costs. Say the number anyway, in one line, and carry on.

Once they have chosen, use that model for the seed and bulk waves below wherever the runtime
exposes model selection, and run at the effort they picked.

## 3. Read the map before writing anything

Open the bundle's `index.md` and any nested indexes, and list the existing concepts: path,
`title`, `type`, `tags`. This is the **vocabulary**, and it does two jobs — it stops you
coining `billing` when `invoices` already exists, and it is what lets a new concept link to
an old one. Hold it in this thread; every subagent gets a copy.

Also decide the **grouping** now, before any file is written: which subdirectories the new
concepts go in (`contracts/`, `metrics/`, `notes/`, `playbooks/` — whatever fits this
domain; structure carries no fixed meaning). Reuse existing directories wherever they fit.
Inventing a new subdirectory per raw file is the classic failure here.

## 4. Seed wave — one file, checked by hand

Pick the most representative raw file and delegate it to **one subagent** with the prompt
below. Use a fast, economical model when the runtime exposes model selection; otherwise use
its default subagent. If subagents are unavailable, do the same work in the current thread.
Then read what it wrote. You are checking the shape, not the facts: right granularity,
frontmatter complete, titles that read like knowledge rather than filenames. Correct the
prompt if it is off, and take the concept titles it produced into your vocabulary before
going wide.

## 5. Bulk wave — the rest in parallel

Use one subagent per remaining raw file and start them concurrently when the runtime
supports parallel delegation. Group several small files into one task when they are
obviously the same subject; never split one file across two tasks. Without subagents,
process the files sequentially in the current thread and keep the same single-writer rules.

Parallel subagents cannot see each other's output, so two rules are absolute:

- **Every prompt carries the vocabulary.** Otherwise you get `q3-budget`, `budget-q3` and
  `quarterly-budget` as three concepts.
- **Subagents write concept docs only.** `index.md`, `log.md` and `refs.md` have exactly one
  writer — you, in step 6. Concurrent edits to a shared index silently lose rows.

Prompt each subagent with, substituting the bracketed parts:

> Read `bundles/<bundle>/raw/<file>.md`. It is ingested source material with a provenance
> header naming the original file.
>
> Split its content into distinct **concepts** — one idea per concept. A concept is
> something someone would ask a question about on its own. Do not summarize the document as
> a whole, and do not create a concept per section heading.
>
> Write each concept as its own markdown file in `bundles/<bundle>/<group>/`, named
> `<kebab-case-title>.md`. If that filename already exists and is about something else,
> append `-2`. Each file starts with OKF frontmatter:
>
> ```yaml
> ---
> type: <Table | Metric | Playbook | Decision Log | Reference | Contract | …>
> title: <display name>
> description: <one line, under 20 words>
> tags: [<lowercase kebab-case>]
> timestamp: <ISO from the source if it has one, else today>
> ---
> ```
>
> Then the body: the actual knowledge, in your own words, structured with headings. End with
> a `# Citations` section listing the raw file path and the `source:` value from its header.
>
> Link to related concepts with plain markdown links using bundle-root paths
> (`/metrics/churn.md`). You may link to any of these existing concepts:
> `<vocabulary: path — title — description, one per line>`
> Reuse an existing concept's subject rather than restating it: if this file only adds a
> detail to one of the above, say so in your reply instead of writing a near-duplicate.
> Never link outside this bundle.
>
> If the provenance header says `quality: low`, the text came from OCR or a transcript and
> may be garbled. Do not invent through it — quote what is legible, and flag what is not in
> your reply.
>
> If the file contains nothing worth keeping (a receipt, boilerplate, a duplicate), write
> nothing and say so.
>
> Reply with one line per concept you wrote: `<path> | <title> | <description>`, then any
> flags. Do not edit `index.md`, `log.md` or `refs.md`.

## 6. Merge — you, single writer

Everything in this step happens in this thread, sequentially, because every file it touches
is shared.

1. **Review and dedupe.** Read the concepts the wave produced. Two files covering the same
   idea get merged into the better one and the loser deleted. A concept that only restates
   an existing one gets folded into it instead.
2. **Cross-link.** Subagents could link to pre-existing concepts but not to each other's
   output. Add the sibling links now — that is where most of a bundle's value ends up.
3. **Register every concept in `index.md`**, in the OKF form
   `* [Title](path.md) - description`. **An unindexed concept is invisible to every query**
   and lint will flag it. Add a nested `index.md` if a subdirectory grew past ~10 concepts.
4. **Fill the `curated` column in `log.md`** for every row you worked. Use the concept
   paths, comma-separated. For a raw file you deliberately declined, write `declined` — a
   row that stays empty will be offered as backlog forever.
5. **Foreign material → `refs.md`.** A raw file that turns out to belong to a different
   bundle is not curated here: note the target bundle and the reason in `refs.md` and, if
   the user agrees, add the source to that bundle's `sources.yaml`. Never inline-link across
   bundles, and never copy the content over.

## 7. Verify

```
khb lint          # index coverage, frontmatter, ref targets, no cross-bundle links
khb visualize     # optional: refresh visualizer/graph.html
```

Fix every error before finishing. Then report: concepts created, raw files declined, rows
still outstanding, and anything you flagged as low-quality and worth re-reading from source.

## Judgement notes

- **Curate selectively.** Raw is bulk; concepts are distilled. Most corpora are 80% receipts
  and boilerplate. Declining is a real outcome, not a failure — and it is the one that moves
  the bill, since every file you decline was still read to decide it.
- **The estimate is a floor on the reading, not on the writing.** `khb estimate` counts what
  is on disk; it cannot know that you re-read a garbled scan four times. If a run is going
  visibly past its quote, stop and say so rather than finishing quietly.
- **Granularity.** If two concepts are always read together, they are one. If one concept
  has two `# Schema` sections, it is two.
- **Write knowledge, not summaries.** "This document discusses the retention policy" is
  useless; the retention policy is what belongs in the file.
- **Never put content in an index.** Indexes route. Knowledge goes in a concept doc.
- **`quality: low` sources** deserve a look at the original before you commit their claims —
  the `source:` path in the raw header is exactly for this. Reading a chart or a scanned
  table with vision recovers what OCR dropped.
