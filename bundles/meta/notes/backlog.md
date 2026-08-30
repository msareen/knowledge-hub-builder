---
type: Backlog
title: KHB backlog
description: Planned extractors, ingesters, tooling, and routing defects.
---

# Backlog

## Extraction

Every format below is converted by `khb ingest` itself, in one flat local pass — no agent
turn in the middle, no system install. The formats live in `scripts/ingest/exts.ts`; the
extractors in `scripts/lib/extract.ts`.

- [x] Text: `.md` `.txt` `.rst` `.adoc` `.html` `.csv` `.json` `.yaml`
- [x] PDF, DOCX, ODT, XLSX, PPTX
- [x] Images / OCR — tesseract, also for PDFs with no text layer (`quality: low`)
- [x] Audio and video — `vno` (whisper.cpp) preferred, `whisper`/`faster-whisper` fallback.
      The one extractor that is not bundled, so an unavailable transcriber pends the row
      rather than failing the run
- [x] Caption sidecars — `.vtt`/`.srt` beside a recording are read instead of transcribing
      it, the pair acquired as one source

## Ingesters

- [x] folder, files, web (scripted, working)
- [x] confluence, ado — agent-driven via MCP/CLI; promote to scripts only if bulk
      agent-free refresh becomes a real need

## Tooling

- [x] `ingest` incremental mode (skip unchanged) — `isFresh()` in `scripts/lib/ledger.ts`,
      with hash-based move detection (`identify()`/`adopt()`) so a renamed source keeps its
      `curated` value instead of returning as a second row
- [x] visualizer: click a bundle → its concept graph, with a panel for the concept body
- [x] **Tests and CI, wave one.** `tests/relocate.test.ts` and `tests/ledger.test.ts` cover
      the exposure the backlog named: `lib/relocate.ts`'s four interacting invariants
      (longest-match ordering, identity-shielding the new path, per-spelling mapping,
      path-boundary lookahead — the substitution logic was split out as `substituter()` to
      make this testable without touching disk) and `lib/ledger.ts`'s `identify()`
      moved/copy/ambiguous decision. `tsconfig.json` (`strict: false`, `noImplicitAny: true`
      — full `strict` surfaces pre-existing third-party typing gaps, tracked below) and
      `.github/workflows/ci.yml` run `bun test`, `tsc --noEmit`, and `khb lint` on every
      push/PR; `lint` now sets a non-zero exit code on errors so CI can actually fail on it.
- [ ] **Tests and CI, wave two.** Second-wave pure-function candidates not yet covered:
      `captionText` (`lib/extract.ts`), `makeExcluder` (`ingest/exclude.ts`),
      `diffSourcesYamlAll`/`diffSourcesYaml` (`lib/schema.ts`), `lib/config-check.ts`'s
      validation. Also: extracting `lint.ts`'s `resolveLink`/`stripNonProse` into a testable
      module (a production refactor of a working script, not just added coverage — separate
      decision). And a strictness ratchet: `lib/extract.ts` and `ingest/acquire.ts` currently
      carry `// @ts-nocheck` (mammoth's default-export shape, a pdfium callback signature, and
      a discriminated-union narrowing gap on the transcribe result) — lift those once the
      underlying type gaps are reconciled.
- [ ] Pre-publish smoke test: `npm pack` → install into a scratch dir → `init`, `ingest`,
      `lint`. The `files` allowlist and `.gitignore` have shipped a hub-breaking mistake
      before (2026-08-24, `export/` matching `skills/export/`), found by accident.
- [ ] `khb find <terms>` — a deterministic implementation of the routing escalation in
      `skills/query/SKILL.md` §1 (index lines → concept frontmatter → bodies, never `raw/`).
      Today every agent re-derives it with whatever grep it has, and the "never `raw/`" rule
      holds only as long as the agent remembers it. Stays on the conversion side of the
      division of labor: no model, deterministic, offline.
- [x] `khb doctor` — read-only report collecting the diagnostics that were scattered across
      command preambles (move detection, version drift, `updateHint()`, catalog backlog,
      pending rows, transcriber). Writes nothing; names the command that fixes each finding

## Routing defects

(log ambiguities found during queries here)
