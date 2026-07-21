---
name: query
description: Answer a question from the BKR knowledge base. Use when the user asks what/why/how about any topic stored in bundles, or asks to look something up in the wiki/knowledge base.
---

# Query BKR

Read [query.md](../../query.md) and follow its protocol exactly: route from
`outer.index.md` to exactly one bundle, then enter through that bundle's
`index.md`. Cross-bundle questions use the collation protocol there.

Routing is the step that fails first, especially on a young hub whose scope lines are
still thin. When `outer.index.md` doesn't settle it, follow query.md's escalation: grep
the bundle `index.md` files, then concept front matter, and if two or more bundles are
still plausible use `AskUserQuestion` with one option per candidate bundle. Never guess a
bundle silently, and never answer straight from a grep hit — go back and enter through
the winning bundle's `index.md`.

Answer only from concept docs, never from `raw/`. Cite file paths.
