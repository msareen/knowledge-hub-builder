---
name: ingest
description: Acquire external material (folders, files, web pages, Confluence, ADO, git) into a KHB bundle's raw/ folder as markdown with provenance — one flat mechanical phase, no interpretation. Use when the user wants to add, import, dump, pull, or refresh source data in the knowledge base.
---

# Ingest into KHB

**Ingest gets bytes into `bundles/<bundle>/raw/` as markdown with a provenance header.
That is all it does.** It is one flat phase, it is mechanical, and it ends the moment the
text exists. Deciding what the text *means* — splitting it into concepts, titling,
tagging, linking, indexing — is the [catalog skill](../catalog/SKILL.md), a separate step
you run afterwards.

Do not curate here. Do not decide bundles here. If you find yourself reading a document to
understand it, you have left this skill.

## 1. Declare the sources

Ingest is bundle-first: you know which bundle the material belongs to, and you say where it
comes from. Edit `bundles/<bundle>/sources.yaml`:

```yaml
sources:
  - type: folder          # walk a directory tree
    path: /abs/path/to/project-x
  - type: files           # a scattered, explicitly named set
    paths:
      - /abs/path/to/one.pdf
      - /abs/path/to/two.xlsx
  - type: web
    urls:
      - https://example.com/design-doc
  # Types with no scripted ingester are still declared here, for the record —
  # you pull them yourself in step 3.
  - type: confluence
    space: PROJX
```

If the user has not explicitly named the source locations, inspect the bundle's current
`sources.yaml`, then ask which files, folders, URLs, or services to ingest. Include any
existing declarations in the question so the user can confirm or replace them. Do not
infer sources from nearby files, edit `sources.yaml`, or run `khb ingest` until the user
answers.

If the user has not said which bundle, ask. If no bundle fits, `khb new-bundle <name>
"<scope>"` first. Nothing is copied by declaring a source.

**The `default` bundle.** When no bundle is named, ingest targets `default` and creates it
if the hub has none — a first `khb ingest` never fails for want of a destination. Use it
when the owning bundle genuinely isn't known yet; don't use it to avoid asking. What lands
there is ordinary bundle content: catalog it like any other. Do **not** graduate it into new
bundles on your own — a bundle is a logical unit the user defines (a person, a team, a
project), so material leaves `default` only when the user says which bundle owns it. An
explicitly named bundle that doesn't exist is still an error — only `default` is conjured.

## 2. Run it

```
khb ingest                          # no bundle named → the 'default' bundle
khb ingest <bundle>                 # incremental: unchanged content hashes are skipped
khb ingest <bundle> --force         # re-acquire everything
khb ingest <bundle> --skip-ocr      # leave scans and images unread
khb ingest <bundle> --skip-audio    # leave audio/video untranscribed
```

One command handles every scripted source in `sources.yaml` and extracts everything it can,
locally. Read the summary it prints — the counts are the state of the world:

| line | meaning |
|---|---|
| `unchanged, skipped` | already acquired at this exact content hash |
| `extracted` / `reused from the extraction cache` | converted now / converted by an earlier run or another bundle |
| `read by OCR` / `transcribed` | lossy routes — see quality, below |
| `marked quality: low` | verify these against the source when cataloging |
| `not extracted` | got a ledger row with an empty `raw`; the per-file line says why |

### What khb extracts

All of it runs locally and none of it contacts a model — that is the `AGENTS.md` division of
labor. khb converts bytes to text as cheaply as possible; your judgement is spent on
curation, not transcription.

| Format | Tool | Quality |
|---|---|---|
| `.md .txt .rst .adoc .html .csv .json .yaml` | copied verbatim | high |
| `.pdf` (born-digital) | `unpdf`, then `pdftotext` if on PATH | high |
| `.docx` / `.odt` / `.pptx` | `mammoth` / `fflate` / `fflate`, `pandoc` if on PATH | high |
| `.xlsx` | `fflate` → one markdown table per sheet | high |
| `.pdf` (scanned, no text layer) | `pdfium` + `tesseract.js`, automatically | **low** |
| `.png .jpg .webp .tif .gif` | `tesseract.js`, automatically | **low** |
| `.mp3 .wav .m4a .mp4 .mov .mkv` | local `whisper` / `faster-whisper` | **low** |

Extracted text is cached hub-wide by content hash at `inbox/extracted/<sha256>.md`, so the
same file appearing in two bundles converts once.

OCR and transcription need optional dependencies. When they are missing khb says so once and
records the affected files as pending rather than failing the run:

```
bun add @hyzyla/pdfium sharp tesseract.js    # OCR — ~75 MB WASM, no system binary
pip install -U openai-whisper                # transcription (faster-whisper also works)
```

Install them where `khb` resolves modules from — for a global install that is the khb
package directory, not your hub. khb prints the exact `cd … && bun add …` to use.

## 3. Sources khb cannot reach

Anything behind an authenticated API has no scripted ingester, because maintaining API
wrappers is not what this tool is for. Pull those yourself with the site's MCP server or
official CLI, and write the result into `raw/<type>/` **in exactly the format khb
produces** — same folder shape, same header — so the catalog pass cannot tell the
difference:

| Source | How |
|---|---|
| Confluence | MCP server or `confluence` CLI → `raw/confluence/<page>.md` |
| Azure DevOps | MCP/CLI → wiki pages, work items → `raw/ado/<item>.md` |
| GitHub / GitLab issues, PRs, wikis | `gh` / `glab` CLI → `raw/git/<thing>.md` |
| Source code repository | do **not** copy — record the location in `sources.yaml` and read it in place |
| A diagram or chart no OCR can read | vision read the image → `raw/images/<file>.md`, `extract_tool: claude-vision` |

Then add the row to `log.md` yourself (`source`, `sha256` if you have it, `fetched`, `raw`),
so the ledger stays the complete record regardless of who did the fetching.

### The provenance header — the contract

Every file in `raw/` starts with it. This is the reason ingest is a separate phase from
catalog: extraction is sometimes lossy, and curation must always be able to walk back to the
original bytes.

```yaml
---
source: /abs/path/to/original.pdf     # or the url, or the tool query
fetched: 2026-07-23T09:14:02Z
sha256: db2ee470c95d
extract_tool: tesseract.js            # what produced the text below
quality: low                          # high = real text; low = OCR or a transcript
---
```

`quality: low` is a standing invitation to distrust the body. When cataloging one of these
and the text reads thin, garbled, or contradictory, **open the `source:` file and read it
directly** — a vision pass over a chart or a scanned table recovers what OCR drops. Rewrite
the `raw/` file with `extract_tool: claude-vision` and `quality: high` when you do.

## 4. The ledger — `log.md`

Every bundle keeps its ingest ledger in `log.md` (OKF-reserved, so it is never mistaken for
a concept doc, and committed, so it survives `raw/` being deleted and re-derived).

| column | owner | meaning |
|---|---|---|
| `source` | khb | origin URI: absolute path, url, or tool query |
| `sha256` | khb | content hash (12-char prefix) — drives skip-unchanged and dedup |
| `fetched` | khb | ISO timestamp of last acquisition |
| `raw` | khb | bundle-relative `raw/` path; **empty = never extracted** |
| `curated` | agent | concept doc(s) distilled from it; **empty = catalog backlog** |

`khb ingest` maintains the first four and never touches `curated`.

## Hand off

Ingest is done when the summary shows nothing unexpectedly pending. Report to the user what
landed, what didn't and why, and how many rows are uncurated — then continue with the
[catalog skill](../catalog/SKILL.md) to turn `raw/` into concept docs.

## Hygiene

- `raw/` is gitignored, derived, and **never canonical**. Never cite it in an answer.
- Never copy a bulk corpus into a bundle wholesale. Extraction shrinks documents to text;
  source-code repos and media libraries stay where they are and get a `sources.yaml` entry.
- The same file in two bundles: one bundle owns it, the other gets a `refs.md` entry. Never
  two copies. The content hash in `log.md` is how you spot it.
- `log.md` records absolute source paths. If those paths are themselves sensitive, gitignore
  it before the first commit.
