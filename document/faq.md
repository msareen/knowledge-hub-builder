# Frequently Asked Questions

## What is KHB?

KHB (Knowledge Hub Builder) is a local, markdown-based system for building and maintaining
a bundle-of-bundles knowledge base with an AI agent.

The `khb` CLI is the supporting tool. It handles deterministic work such as extraction,
file plumbing, validation, visualization, and export. The bundled workflow skills tell an
AI agent—such as Claude, Codex, Gemini, or another compatible agent—how to ingest, catalog,
query, and maintain the knowledge. The agent follows those skills and orchestrates the
overall workflow.

The hub itself remains an ordinary folder of markdown files, indexes, source declarations,
and provenance records. The CLI holds no knowledge and does not call a model.

## What are the main KHB workflow stages?

KHB has three main stages:

1. **Ingest** converts declared sources into provenance-bearing markdown under
   `bundles/<bundle>/raw/`.
2. **Catalog** interprets one bundle's raw material, creates canonical concept documents,
   and updates that bundle's index and ledger.
3. **Query** routes a question through the indexes and answers from curated concept
   documents.

Ingest is mechanical and local. Catalog and query require an agent because they involve
judgement.

## Does cataloging move everything into one main bundle?

No. Ingest and catalog operate on the same owner-defined bundle. For example, material
ingested into `client-a` is cataloged into concepts inside `bundles/client-a/`.

Bundles are units of ownership, such as a person, team, project, or client. They are not
subject categories, and an agent must not create, split, merge, or reorganize them without
explicit instruction.

## What happens when there are multiple bundles?

Cataloging handles exactly one bundle at a time. Name the bundle in the request, such as:

> Catalog the `client-a` bundle.

If multiple bundles are possible and none was identified, the agent asks which bundle to
use instead of guessing.

During a query, the agent starts at `outer.index.md` and selects one bundle. If the
question genuinely spans bundles, it follows `refs.md`, enters each additional bundle
through its own `index.md`, and combines the results only in the answer.

## What does `khb ingest [bundle] [--force]` do?

The command reads the selected bundle's `sources.yaml`, acquires every supported declared
source, extracts it into markdown under `raw/`, and updates `log.md`.

It does not summarize, label, organize, or create concepts. Unchanged content hashes are
skipped by default; `--force` reacquires everything.

A named bundle must already exist. Run without a name and the command lists the hub's bundles
and stops — unless there is nothing to choose between: a hub with no bundles gets a `default`
landing bundle created so a first ingest still works, and a hub whose only bundle is `default`
uses it. An agent asked to ingest without a named bundle asks you which
existing bundle owns the material or whether to create a new one, and for an existing bundle
whether to re-ingest the paths already in its `sources.yaml` or take a new path.

## Should I run ingestion manually or ask an agent?

Either works. Running `khb ingest client-a` manually performs the deterministic extraction.
You can instead ask:

> Ingest the `client-a` bundle.

The agent invokes the same command, checks its summary, handles supported authenticated
sources, and reports anything pending. Manual execution is useful in scripts or when only
extraction is needed.

## Where are ingestion sources declared?

Each bundle has its own declaration file:

```text
bundles/<bundle>/sources.yaml
```

For example:

```yaml
sources:
  - type: folder
    path: /absolute/path/to/documents
  - type: files
    paths:
      - /absolute/path/to/one.pdf
      - /absolute/path/to/two.xlsx
  - type: web
    urls:
      - https://en.wikipedia.org/wiki/Example
  - type: confluence
    space: PROJX
```

The `sources` list may contain one or many source declarations of different types.

## When are sources added to `sources.yaml`?

Sources are declared before ingestion. The usual sequence is:

1. Create or select the owner bundle.
2. Add its source locations to `sources.yaml`.
3. Run ingestion.
4. Catalog the resulting raw material.

Declaring a source records where material should come from; it does not copy anything by
itself.

## What if I ask for ingestion without identifying the sources?

The ingest workflow inspects the bundle's existing `sources.yaml` and asks which files,
folders, URLs, or services to ingest. It includes existing declarations so they can be
confirmed or replaced.

The agent does not infer sources from nearby files, change `sources.yaml`, or run ingestion
until the user answers.

## Can one bundle ingest Wikipedia, Confluence, and Azure DevOps material?

Yes. Public pages such as Wikipedia can be declared as `web` sources and fetched by
`khb ingest`.

Authenticated systems such as Confluence and Azure DevOps are also declared in
`sources.yaml`, but the KHB CLI does not authenticate to them. The agent pulls their data
through an available MCP connector or official CLI, writes the same provenance-bearing
markdown shape under `raw/`, and updates `log.md`. If access is unavailable, the agent
reports the blocked source.

## Does cataloging delete the raw files?

No. Cataloging reads raw files and creates canonical concept documents elsewhere in the
same bundle. The raw material remains derived evidence and is not used directly to answer
queries.

The bundle's `log.md` connects each source and raw file to the concept documents curated
from it.

## Can a query create or update concepts?

Yes, but never silently. If answering produces durable, reusable knowledge that existing
concepts do not cover, the agent offers to:

- fold the knowledge into an existing concept; or
- create a new concept and link it to the concepts from which it was derived.

The agent explains what it would write and where, then waits for confirmation. After
approval, it updates the concept links, `index.md`, and `log.md`, and runs `khb lint`.
One-off conversational answers are not saved.

If a query reveals that an existing concept is wrong or stale, the agent similarly offers
to repair it in place before making any change.
