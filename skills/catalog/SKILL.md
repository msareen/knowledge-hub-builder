---
name: catalog
description: Turn one bundle's raw/ material into OKF concept docs — report the token cost with khb estimate, then read each raw file, split it into sub-topics, label each with type/title/description/tags, link them, and register them in index.md. Uses parallel subagents when the runtime supports them. Use after khb ingest, or when the user asks to curate, catalog, organize, or write up a bundle.
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

## 2. Say what it costs, then start

**`khb ingest` is free; this pass is not.** It reads every raw file through a model and
writes concepts back, so a corpus that took an afternoon to extract can run to millions of
tokens. A file count does not tell anyone that. So say the number — and then get on with it.

```
khb estimate <bundle>        # tokens, in millions, at low / medium / high effort
khb estimate <bundle> --json # the same numbers, for you to reason over
```

It counts the words and characters actually on disk and multiplies them by published
coefficients. It writes nothing and calls no model. It also quotes no prices: if you know
current rates, convert the tokens to money in your report; if the user gives you rates,
`khb estimate <bundle> --price <in>/<out>` (USD per million) does the arithmetic. Say plainly
that these are estimates from character counts and a real run lands either side of them.

**Report it in about four lines, then begin.** Files, source tokens, the projection at the
effort you are using, and anything you are deferring:

> Cataloging `documents`: 2,478 files, 10.4M tokens of material. At low effort that is
> roughly 16.5M in and 1.0M out. Running at low — the backlog is large. Deferring
> `NEW_CIS_FORM.XLSX` (1.46M tokens, 14% of the corpus on its own); say the word and I'll
> do it too. Starting now.

### Effort — pick it, do not ask for it

`khb estimate` marks one row `← default` and names it on its closing line; `--json` returns
it as `recommended`. Use that unless the user named a level, and say which you used in a
clause. **`high` is never automatic** — it is a deliberate ask.

If the user named an effort, that wins, at any size.

### Outliers — defer them and say so

One enormous file can be a fifth of the bill. `khb estimate` flags any raw file worth 5% or
more of a backlog of over twenty files as an `outlier`. Leave those uncurated this pass:
name each one, say what it costs, and offer it. Its `log.md` row simply stays empty, which is
the durable backlog, so nothing is lost and nothing needs undoing.

When the user does ask for a deferred outlier, look at what it is before spending on it. A
1.4M-token spreadsheet is usually a bulk data export, and the right treatment is **one**
`type: Table` concept describing what the table holds, with a `resource:` pointing at the
original — not a dozen prose concepts distilled from rows nobody will read as prose.

### Do not ask which model

You cannot change the model you are running on. This is a skill: its text is loaded into the
conversation already in progress, so the pass runs on whatever model that session started on,
and the user has no lever to change it mid-run either. Asking is a dead end that stalls the
work — if the user names a model anyway, say in one line that the running model can't be
switched, and carry on with the catalog.

The one real model choice is which model the **subagents** in steps 4 and 5 get, in runtimes
that expose that. It is your call, needs no input from anyone, and does not exist in runtimes
that have no subagents.

### Do not wait

Consent already happened. The [ingest skill](../ingest/SKILL.md) asks "shall I catalog?" at
its hand-off and carries the token number into that question, and a user who says "catalog
it" has answered. A second gate here only ever fires *after* someone has decided, so it
stalls a decision instead of informing one. Report the number and start the seed wave.

Stop only if the estimate reveals something the user could not have known and would not
want — a backlog that is almost entirely one deferred outlier, or a bundle whose raw files
turn out to belong to someone else. That is new information, not a checkpoint.

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
below. If your runtime lets you choose a subagent's model, pick a fast, economical one — your
call, no need to ask; otherwise use its default subagent. If subagents are unavailable at all,
do the same work in the current thread.
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
- **The estimate is a guideline, not a budget you were granted.** `khb estimate` counts what
  is on disk; it cannot know that you re-read a garbled scan four times, so a real run lands
  either side of it. That cuts both ways: do not treat the number as permission to stop for
  approval, and do not treat it as a ceiling you must finish under. If a run is going *far*
  past its quote, say so mid-pass rather than finishing quietly.
- **Granularity.** If two concepts are always read together, they are one. If one concept
  has two `# Schema` sections, it is two.
- **Write knowledge, not summaries.** "This document discusses the retention policy" is
  useless; the retention policy is what belongs in the file.
- **Never put content in an index.** Indexes route. Knowledge goes in a concept doc.
- **`quality: low` sources** deserve a look at the original before you commit their claims —
  the `source:` path in the raw header is exactly for this. Reading a chart or a scanned
  table with vision recovers what OCR dropped.
