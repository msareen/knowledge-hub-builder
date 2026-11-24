---
name: khb
description: Work with the user's KHB knowledge hub from any folder — answer a question from it, ingest or catalog material into one of its bundles, lint, export or visualize it. Use when the user says /khb, mentions their hub, knowledge hub, knowledge base or khb, names one of their hubs or bundles, or asks something only their own curated notes would know. Not for ordinary code questions in the current repo.
---

<!-- khb-global-skill: installed by `khb install-skill`, which overwrites this file. Edit
     the copy in the khb package, not this one. -->

# KHB from anywhere

This skill holds **no workflow of its own**. It finds the right hub, loads that hub's
contract, and hands you over to the hub's own skill. Every protocol lives in the hub at
`<hub>/skills/<name>/SKILL.md`, at the version that hub was stamped with. Copying a
protocol into this file would let it drift from the hub it is applied to, so this file only
routes.

## 1. Check the CLI

Run `khb --version`. If `khb` is not on PATH, stop and tell the user to install it
(`bun install -g @msareen/knowledge-hub-builder`); do not hand-edit a hub without it.

## 2. Pick exactly one hub

Stop at the first step that yields a single hub:

1. **The user named one** ("in my work hub", "/khb personal …") → `khb go <name> --path`
   prints its path. It never launches an agent with `--path`.
2. **You are already inside a hub**: the working directory or one of its ancestors
   holds `khb.json` → that folder is the hub.
3. **Otherwise read the machine's list:** `khb list --json`. Ignore entries whose `path`
   no longer holds a `khb.json` (khb marks those MISSING). One hub left → use it. Several
   → choose by each hub's `name` and `description` only if one clearly owns the request.
4. **Ask the user.** Two or more still plausible → ask, one option per hub with its
   description. A wrong silent guess answers from the wrong knowledge base; the question
   costs one turn.
5. **No hubs at all** → say so, and point at `khb init <dir>` to create one. Do not create
   a hub on your own initiative.

Keep that hub for the rest of the conversation unless the user moves you to another, and
name it (and its path) in your reply so the user can see where the answer came from.

## 3. Load the hub's contract

Read `<hub>/AGENTS.md` in full and treat it as binding — it is exactly what an agent
started inside the hub would have loaded automatically. One bundle at a time, indexes are
routing only, `raw/` is never canonical, bundles are never created or split unasked: all
of it applies here unchanged.

## 4. Hand over to the hub's skill

Map the request to a skill and read `<hub>/skills/<name>/SKILL.md` in full, then follow it:

| The user wants to… | Skill |
|---|---|
| ask, look up, find out | `query` |
| add, import, pull, refresh material | `ingest` |
| curate `raw/` into concept docs | `catalog` |
| check or repair structure | `lint` |
| create a bundle (explicitly asked for) | `new-bundle` |
| share one bundle as a folder | `export` |
| see the bundle graph | `visualize` |

List `<hub>/skills/` if the request fits none of these — a hub may carry its own skills.
If `<hub>/skills/` is missing or the hub's contract looks out of date, run
`khb --hub "<hub>" upgrade` and read again.

## 5. Work from outside the hub

The hub's skills are written as if the working directory were the hub root. You are not
there, so:

- **Paths:** resolve every hub-relative path in the skill (`outer.index.md`,
  `bundles/<b>/index.md`, `skills/…`) against `<hub>`.
- **Commands:** pass the hub to every khb command — `khb --hub "<hub>" ingest <bundle>`,
  `khb --hub "<hub>" lint`, `khb --hub "<hub>" estimate <bundle>`. The registry commands
  (`list`, `go`, `config`, …) need no `--hub`.
- **Writes** go only where the hub's skill says — inside `<hub>`. Never write the user's
  current project as a side effect of a hub workflow.
- **Searches** stay inside `<hub>`; do not grep the current project for hub answers.

If the runtime asks permission to read or write outside the working directory, that is
expected: it is the hub path. Tell the user that `khb go <name>` opens a session inside the
hub if they would rather not grant it.
