// What a catalog pass will cost, before you run it.
//
// `khb ingest` is free: it is CPU, disk and a fan. Cataloging is not — it reads every raw
// file through a model and writes concept docs back — and on a corpus that took an afternoon
// to extract the bill is measured in millions of tokens, which is not something a file count
// tells you. Nobody should discover that after the fact.
//
// This module is the deterministic half, and it stays on khb's side of the line: it counts
// words and characters and multiplies them by published coefficients. It contacts no model,
// asks no model to count for it, and does not decide whether the number is acceptable. It
// hands the agent a projection; the agent prices it and the user decides.

/** How hard the catalog pass works — the knob that moves output tokens the most. */
export type Effort = "low" | "medium" | "high";

export const EFFORTS: readonly Effort[] = ["low", "medium", "high"];

/**
 * Coefficients, not measurements.
 *
 * `reread` is how many times the material is effectively billed as *input*. It is never 1:
 * a subagent's prompt carries the raw file, and every follow-up turn in that subagent resends
 * the whole conversation so far, and the orchestrator reads the concepts back during the
 * merge. `output` is written concepts plus reasoning tokens as a fraction of the raw
 * material — cataloging distils, so it is always well under 1.
 *
 * These are honest round numbers from the shape of the protocol in skills/catalog/SKILL.md,
 * and a real run will land somewhere either side of them. They are here, in one table, so a
 * run that lands badly wrong is a one-line correction rather than an archaeology exercise.
 */
export const EFFORT_PROFILES: Record<Effort, { reread: number; output: number; note: string }> = {
  low: {
    reread: 1.3,
    output: 0.1,
    note: "one pass per file, terse concepts, decline liberally",
  },
  medium: {
    reread: 2.0,
    output: 0.25,
    note: "the protocol as written — seed wave, bulk wave, merge and cross-link",
  },
  high: {
    reread: 3.5,
    output: 0.55,
    note: "fine-grained splits, low-quality sources re-read at the source, heavy reasoning",
  },
};

/**
 * The catalog prompt in skills/catalog/SKILL.md, minus the vocabulary — measured once by
 * counting the prompt block itself. Paid per raw file, since every subagent gets its own.
 */
export const PROMPT_BASE_TOKENS = 600;

/** One `path — title — description` vocabulary line. Every subagent prompt carries all of them. */
export const VOCAB_TOKENS_PER_CONCEPT = 25;

/**
 * Tokens for a piece of text, without a tokenizer.
 *
 * Two rules of thumb disagree in useful ways: ~4 characters per token holds for prose but
 * runs high on anything dense, and ~1.33 tokens per word runs low on tables, OCR garble and
 * long identifiers, which are exactly what a `raw/` directory is full of. Taking the larger
 * of the two makes the estimate deliberately conservative — an estimate that comes in under
 * the real bill is worse than useless, because it is the one people act on.
 *
 * CJK text tokenizes far denser than either rule; a corpus of it will be underestimated.
 */
export function estimateTokens(chars: number, words: number): number {
  return Math.round(Math.max(chars / 4, words * 1.33));
}

export type TextCount = { chars: number; words: number; tokens: number };

export function countText(text: string): TextCount {
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  return { chars: text.length, words, tokens: estimateTokens(text.length, words) };
}

export type CountedFile = TextCount & { path: string; bytes: number };

export type Corpus = {
  files: CountedFile[];
  bytes: number;
  chars: number;
  words: number;
  tokens: number;
};

export function summarize(files: CountedFile[]): Corpus {
  const total = (pick: (file: CountedFile) => number) =>
    files.reduce((running, file) => running + pick(file), 0);
  return {
    files,
    bytes: total((file) => file.bytes),
    chars: total((file) => file.chars),
    words: total((file) => file.words),
    tokens: total((file) => file.tokens),
  };
}

export type Projection = {
  effort: Effort;
  /** Billed input: the material and its per-file prompt, resent as the pass goes. */
  input: number;
  /** Billed output: concept docs plus reasoning. */
  output: number;
  total: number;
};

/**
 * Project one effort level over a counted corpus.
 *
 * `overheadPerFile` is the prompt each raw file is sent with — the protocol's own text plus
 * the bundle's vocabulary, which is why a bundle with 300 existing concepts costs more to
 * extend than an empty one does to start.
 */
export function project(corpus: Corpus, overheadPerFile: number, effort: Effort): Projection {
  const profile = EFFORT_PROFILES[effort];
  const input = Math.round((corpus.tokens + corpus.files.length * overheadPerFile) * profile.reread);
  const output = Math.round(corpus.tokens * profile.output);
  return { effort, input, output, total: input + output };
}

/**
 * Above this projected total, a run is big enough that the cheaper pass is the right default.
 * Roughly: a few thousand pages of material, where `medium` starts costing more than the
 * extra cross-linking is worth on a first pass through an unfamiliar corpus.
 */
const MEDIUM_CEILING = 5_000_000;

/**
 * Which effort to run at when nobody has said.
 *
 * The catalog skill needs a default that scales — `medium` on a 40-file bundle is right and
 * on a 2,500-file one is three times the bill — and the rule lives here rather than as prose
 * in the skill so there is one threshold to tune instead of two that drift apart. `high` is
 * never recommended: it is a deliberate ask, not something to land on by accident.
 */
export function recommendEffort(projections: readonly Projection[]): Effort {
  const medium = projections.find((projection) => projection.effort === "medium");
  return medium && medium.total <= MEDIUM_CEILING ? "medium" : "low";
}

/**
 * Tokens as millions, which is the unit the bill is denominated in. Small corpora keep more
 * decimals rather than collapsing to `0.00M` and reading as free.
 */
export function millions(tokens: number): string {
  const value = tokens / 1e6;
  if (value === 0) return "0M";
  if (value < 0.01) return `${value.toFixed(4)}M`;
  if (value < 1) return `${value.toFixed(3)}M`;
  return `${value.toFixed(2)}M`;
}

/** A price, given rates in dollars per million tokens. */
export function priceOf(projection: Projection, inputRate: number, outputRate: number): number {
  return (projection.input / 1e6) * inputRate + (projection.output / 1e6) * outputRate;
}

/** `--price 3/15` → input $3, output $15, per million tokens. Undefined when unparseable. */
export function parsePrice(spec: string): { input: number; output: number } | undefined {
  const parts = spec.split("/").map((part) => part.trim());
  // An empty half must not fall through: `Number("")` is 0, so `--price 3/` would otherwise
  // quote the output tokens as free — the one direction this estimate must never be wrong in.
  if (parts.length !== 2 || parts.some((part) => !part)) return undefined;
  const [input, output] = parts.map(Number);
  if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) return undefined;
  return { input, output };
}

export function humanBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}
