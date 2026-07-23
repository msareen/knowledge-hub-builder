---
name: new-bundle
description: Create a new KHB bundle — a logical unit owned by a person, team, project or client. Use when the user wants to add a new owner/area to the knowledge base.
---

# New bundle

A bundle is a **logical unit, defined by whoever owns its material** — a person, a team, a
project, a client. It is not a subject classification. One bundle holds as many topics as
its owner has; topics are organized *inside* it with subdirectories, not by making more
bundles.

Creating a bundle is always a human decision. Never create one because material looks like
it belongs to a new subject, and never split an existing one on your own initiative — an
agent splits a bundle only when explicitly told to.

1. Pick a name: lowercase, digits, hyphens. Name the owner or the context, not the subject
   (`team-payments`, `client-acme`, `notes`), and expect its scope line to list several
   topics — that is correct, not a signal to split.
2. Run `khb new-bundle <name> "<one-line scope>"` — scaffolds from
   `.bundle_template/` and registers in `outer.index.md`.
3. Fill in the "Route here when" column in `outer.index.md`. Write it as a trigger for
   *whose* material this is, since one bundle answers for many topics.
4. Declare inputs in `sources.yaml` (see the ingest skill to pull them).
5. `khb lint`.
