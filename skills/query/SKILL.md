---
name: query
description: Answer a question from the KHB knowledge base, then file durable answers back as concept docs. Use when the user asks what/why/how about any topic stored in bundles, or asks to look something up in the wiki/knowledge base.
---

# Query KHB

Read [query.md](../../query.md) and follow its protocol exactly. It has two folds and
you owe both.

**Fold 1 — answer.** Route from `outer.index.md` to exactly one bundle, then enter
through that bundle's `index.md`. Cross-bundle questions use the collation protocol there.

Routing is the step that fails first, especially on a young hub whose scope lines are
still thin. When `outer.index.md` doesn't settle it, follow query.md's escalation: grep
the bundle `index.md` files, then concept front matter, and if two or more bundles are
still plausible use `AskUserQuestion` with one option per candidate bundle. Never guess a
bundle silently, and never answer straight from a grep hit — go back and enter through
the winning bundle's `index.md`.

Answer only from concept docs, never from `raw/`. Cite file paths.

**Fold 2 — file it back.** Every answer, run query.md's fold-2 test. If the answer
combined docs, took judgement, or was hard to reach, it is knowledge: prefer *rebuilding
the existing concept doc* that owns the topic over adding a new one, register anything new
in the bundle's `index.md`, carry `derived_from` in the frontmatter, and run `khb lint`.
Propose the path and new-or-revision and wait for the go-ahead before writing — never file
back silently. Concluding "nothing durable here" in one sentence is a fine outcome;
skipping the step without saying so is not.
