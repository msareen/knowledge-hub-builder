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

Do not curate here. Do not split or merge bundles here, and create one only as the user's
answer to the question in step 1 — never on your own initiative. If you find yourself reading
a document to understand it, you have left this skill.

## 1. Settle the bundle — ask, never assume

Ingest is bundle-first: material lands in exactly one bundle, and which bundle owns it is the
user's decision, not yours. Whenever there is a choice to make, put it to them.

**Take the first of these that applies:**

1. **The user named a bundle** — "re-ingest the real-estate bundle" — → use it, no question
   asked. If the name does not resolve to a bundle in `bundles/`, say so and ask whether to
   create it; never scaffold on a guess, and never silently fall back to a similar name.
2. **No bundle named, and the hub has real bundles** → ask, always, offering the choice
   explicitly: **an existing bundle** (list them, from `outer.index.md`, with their scope
   lines so the user can tell them apart) **or a new bundle**. Do not pick for the user,
   however plainly one bundle seems to own the material — say which you would pick if you
   have a view, then wait for the answer. Do not offer `default` here and do not mention it;
   with real bundles on the table it is not one of the options.
3. **The user answered "a new bundle"** → they name it and give its scope; you run
   `khb new-bundle <name> "<scope>"`. Creating a bundle is a human decision (`AGENTS.md`), so
   this branch only ever runs on an explicit answer to the question above.
4. **No bundle named and nothing to choose between** → `default`, without asking. Two shapes
   of hub qualify:
   - **no bundles at all** → `default` is created on the spot; a first ingest should not fail
     for want of a destination.
   - **`default` is the only bundle** → it is used as it stands. A one-option question is not
     a choice, so do not put it to the user.

**The `default` bundle** is only that last case — a landing place in a hub that has no other,
not an option to fall back on once a real bundle exists. The moment one does, `default` stops
being a destination for unnamed ingests and case 2 applies. What lands there is ordinary
bundle content: catalog it like any other. Do **not** graduate it into new bundles on your
own; material leaves `default` when the user says which bundle owns it.

## 2. Declare the sources — reuse or replace

Once the bundle is settled, settle where the material comes from. If the user already named
the files, folders or URLs, that is the answer — you still ask the add-or-replace question
below when the bundle has declarations of its own. **Otherwise, for an existing bundle, read
its `sources.yaml` first and ask which you are doing:**

- **use what's declared** — re-ingest the paths already in `sources.yaml` (this is what
  "re-ingest the real-estate bundle" usually means), or
- **a new path** — the user gives files, folders or URLs; ask whether they are *added* to
  the declarations or *replace* them before you edit the file.

Quote the current declarations in the question so the answer is informed. A bundle with an
empty `sources.yaml` has nothing to re-ingest, so there the only answer is a new path — ask
for it. Do not infer sources from nearby files, do not edit `sources.yaml`, and do not run
`khb ingest` until the user has answered.

For a `folder` or `files` source, ask one more thing before running `khb ingest`: **anything
to exclude from this source?** (default: no — most sources want everything ingested). If the
user names folders, files or patterns to skip, write them into that source's `exclude:` list
yourself — do not run `khb ingest` until this is settled either, for the same reason as the
question above: a declaration you have not confirmed is not yet a plan.

Sources live in `bundles/<bundle>/sources.yaml`:

```yaml
sources:
  - type: folder          # walk a directory tree
    path: /abs/path/to/project-x
    exclude:               # optional — skip these before ingesting
      - drafts/             # a plain entry: matches this path or anything under it
      - "**/*.tmp"          # a glob (has * ? [): matched with Bun.Glob
  - type: files           # a scattered, explicitly named set
    paths:
      - /abs/path/to/one.pdf
      - /abs/path/to/two.xlsx
    # exclude: also accepted here, matched against each path's basename
  - type: web
    urls:
      - https://example.com/design-doc
  # Types with no scripted ingester are still declared here, for the record —
  # you pull them yourself in step 4.
  - type: confluence
    space: PROJX
```

`exclude` entries can also be fully-qualified absolute paths (e.g. `D:\corpus\project-x\drafts`
or `/abs/path/to/project-x/drafts`) instead of paths/patterns relative to the source — either
form matches, plain or glob.

Nothing is copied by declaring a source.

## 3. Run it

```
khb ingest                          # only where 'default' is the sole bundle, or none is
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
| `read from a caption sidecar` | a recording whose words were read off its `.vtt`/`.srt` instead |
| `marked quality: low` | verify these against the source when cataloging |
| `not extracted` | got a ledger row with an empty `raw`; the per-file line says why |

Above that summary, every file gets its own trace — announced *before* the work starts, so a
run that is taking minutes always names the file it is taking them on:

```
[ 7/94] D:\corpus\board-pack.pdf
        extracting pdf …
        no text layer, 12p — scanned, running OCR (seconds per page)
          page 1/12 — 1843 chars
          …
        extracted → raw/folder/board-pack.pdf.md  [tesseract.js @ 216dpi, quality: low] (48.1s)
```

There is no quiet mode, and this is deliberate: the trace is the audit trail for a pass that
rewrites `raw/`. When something looks wrong later, that line — tool, quality, elapsed — is
what tells you which file to distrust and which extractor to blame.

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
| `.mp3 .wav .m4a .mp4 .mov .mkv` | local `vno` (whisper.cpp), else `whisper` / `faster-whisper` | **low** |
| `.vtt .srt` | built-in caption reader | high |

Extracted text is cached hub-wide by content hash at `inbox/extracted/<sha256>.md`, so the
same file appearing in two bundles converts once.

**A recording next to its captions is one source, not two.** `talk.vtt` (or `talk.en.vtt`,
or `talk.srt`) beside `talk.mp4` is that recording's words, already written down by someone
who could hear it — so khb reads them instead of guessing at them with whisper. The pair
gets one `log.md` row, under the recording; the sidecar earns no row and no `raw/` file of
its own, and the recording's `extract_tool` names the file the text came from. It is both
free and better than transcription, so it happens even under `--skip-audio`.

Two things follow. The pair's identity is *both* files, so correcting a caption re-ingests
the recording rather than leaving a stale row marked unchanged. And khb never picks between
sidecars: `talk.en.vtt` next to `talk.fr.vtt` is a choice about audience, so it transcribes
instead and leaves both files to be pointed at explicitly. A caption with no recording
beside it — or one whose recording this source does not visit, because it is excluded or
simply not listed — is an ordinary source and gets its own row. That is also the lever:
excluding a sidecar does not unpair it, since `exclude` governs what earns a `raw/` file and
a paired sidecar never earns one; exclude the *recording* to have its captions ingested
alone.

The caption reader drops what belongs to the player and keeps what belongs to the
transcript: cue indices and timecodes go, `<v Name>` becomes a speaker label, the rolling
repetition auto-generated captions leave behind is collapsed, and anything longer than five
minutes gets a coarse `## h:mm:ss` heading per interval so a passage can be found in the
source recording. Quality is `high` — the words are what the file says, not what an
extractor guessed — but auto-generated captions are still ASR underneath, so treat a
transcript that reads like a machine wrote it the way you would treat one.

**OCR needs no setup.** `@hyzyla/pdfium`, `sharp` and `tesseract.js` are dependencies of khb
itself, so a scanned PDF or a photographed page is read on the first run, in any hub, without
asking the user to install anything.

Transcription is the one route that can be absent. It wants a transcriber on `PATH`, and
takes the first of these it finds:

```
npm install -g @msareen/voice-notes-organizer   # vno — whisper.cpp, preferred
pip install -U openai-whisper                   # whisper (faster-whisper also works)
```

`vno` is preferred where both are set up: it is whisper.cpp rather than the Python
whisper, so it is markedly faster on the same audio and uses whatever acceleration the
machine has, it installs its own ffmpeg and model, and it emits WebVTT — which means a
transcript with `## h:mm:ss` anchors instead of an undifferentiated wall of text. khb runs
it as `vno t <file> -o <cache path> --no-open` with stdin closed, so nothing is written
beside your recordings and vno's setup offers degrade to printed instructions instead of
prompts.

khb gates on `vno status` before using it, because installed and ready are different things
— vno needs ffmpeg, whisper.cpp and a model, and reports on all three. **A vno that is not
set up is an amber gate, never a red one.** The run does not stop and nothing else is
affected: whisper takes over if you have it, and if you don't, the recordings pend with an
empty `raw` exactly like any other unavailable extractor while the rest of the corpus is
ingested normally. What you get is the reason and the fix, on the file's own line and again
in `log.md`:

```
[ 3/12] D:\corpus\standup.m4a
        no captions beside it — transcribing (minutes per file) …
  vno is installed but not set up: ffmpeg, whisper.cpp — run:  vno setup
        pending — vno is installed but not set up: ffmpeg, whisper.cpp — run:  vno setup
```

Run `vno setup` yourself and re-run the ingest; the pending rows fill in. khb will not run
it for you — installing software nobody asked it to install is not a conversion step.

Either engine is a local binary doing a reproducible conversion, and its output is
`quality: low` all the same: it is a machine's guess at audio, and the recording is still
the thing to re-read when a passage looks wrong.

When any extractor is unavailable khb says so once and records the affected files as pending
rather than failing the run — a `log.md` row with an empty `raw`, waiting for the dependency.
If khb ever prints a `bun add` hint for the OCR packages, its own install tree is incomplete;
install them where `khb` resolves modules from — for a global install that is the khb package
directory, not your hub — and khb prints the exact `cd … && bun add …` to use.

## 4. Sources khb cannot reach

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

## 5. The ledger — `log.md`

Every bundle keeps its ingest ledger in `log.md` (OKF-reserved, so it is never mistaken for
a concept doc, and committed, so it survives `raw/` being deleted and re-derived).

| column | owner | meaning |
|---|---|---|
| `source` | khb | origin URI: absolute path, url, or tool query |
| `sha256` | khb | content hash (12-char prefix) — drives skip-unchanged, move detection and dedup |
| `fetched` | khb | ISO timestamp of last acquisition |
| `raw` | khb | bundle-relative `raw/` path; **empty = never extracted** |
| `curated` | agent | concept doc(s) distilled from it; **empty = catalog backlog** |

`khb ingest` maintains the first four and never touches `curated`.

### Moved and renamed sources

The bytes are a source's identity; the path is only where they live today. When a file
appears at a path the ledger has not seen, khb looks for an existing row with the same hash
whose own path has since disappeared. If exactly one matches, that row is **re-pointed** at
the new path: same `raw` file (concepts cite it by name, so it is never renamed), same
`curated`, and the raw file's `source:` provenance header is corrected. Nothing is
re-extracted and nothing re-enters the backlog.

Two cases are deliberately *not* treated as moves, because both would silently rewire
provenance:

- **Copy** — the twin row's path still exists, so these are two real sources with the same
  bytes. Both are ingested; the run says so, and folding or declining the second is a
  cataloging judgement.
- **Ambiguous** — several vanished rows share the hash, so which one moved here is
  unknowable. The new file is ingested as its own source and the run says why.

Still on you, not khb: a source **modified in place** keeps its `curated` value, so the
concept derived from it does not re-enter the backlog even though its material changed.
Watch for `raw/` files whose content shifted and re-catalog them deliberately.

## Hand off — offer the catalog pass

Ingest is done when the summary shows nothing unexpectedly pending. Report to the user what
landed, what didn't and why, and how many `log.md` rows are now uncurated.

Then **offer to catalog, and wait for the answer.** Raw text is not yet knowledge — a bundle
left at the end of ingest has a backlog and nothing citable — so never stop silently on the
summary, and never start cataloging unasked either. Name the bundle and the size of the
backlog in the offer, so the answer is informed:

> Ingest landed 94 files in `real-estate/raw/`; 94 rows are uncurated. Shall I catalog them
> into concept docs now?

Take the answer at face value:

- **yes** → continue with the [catalog skill](../catalog/SKILL.md), on that bundle, reading
  the backlog from `log.md`.
- **no, or not now** → stop. The ledger is the durable backlog, so nothing is lost; say that
  the uncurated rows are waiting whenever they want to pick it up.
- **only part of it** — one folder, one document, the low-quality files first → catalog that
  subset and leave the rest of the rows uncurated.

Offer once, for the bundle you just ingested. Do not offer to catalog a bundle this run did
not touch, and do not roll a "yes" onward into a second bundle's backlog.

## Hygiene

- `raw/` is gitignored, derived, and **never canonical**. Never cite it in an answer.
- Never copy a bulk corpus into a bundle wholesale. Extraction shrinks documents to text;
  source-code repos and media libraries stay where they are and get a `sources.yaml` entry.
- The same file in two bundles: one bundle owns it, the other gets a `refs.md` entry. Never
  two copies. The content hash in `log.md` is how you spot it.
- `log.md` records absolute source paths. If those paths are themselves sensitive, gitignore
  it before the first commit.
