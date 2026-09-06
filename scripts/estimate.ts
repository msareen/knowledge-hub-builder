// khb estimate — how many tokens cataloging this bundle is going to cost, before you start.
//
// Ingest and catalog have wildly different economics and the CLI used to say nothing about
// it. `khb ingest` ends with "412 in raw/ but not yet cataloged" and points at the catalog
// skill, and 412 files reads like an afternoon — but if they are scanned contracts it is
// eight million tokens of input, and the person who finds that out finds it out from a bill.
//
// So: count the material first, project it, and say the number in the unit it will be
// charged in. This command writes nothing and calls nothing. It counts characters and words
// and multiplies them by the coefficients in lib/tokens.ts — the same side of the line every
// other khb command sits on. It does not price the run against a model and it does not decide
// whether to proceed; both of those belong to the agent and the user, which is why the
// catalog skill stops here and asks.
import { HUB, BUNDLES, listBundles, bundleDir, conceptFiles, rawFiles, join, existsSync } from "./lib/util";
import { readLedger } from "./lib/ledger";
import { detail, section, ticker, totalElapsed } from "./lib/log";
import { takeFlag, takeOpt, rejectUnknownFlags } from "./lib/args";
import { paint, paintErr } from "./lib/color";
import {
  EFFORTS,
  EFFORT_PROFILES,
  PROMPT_BASE_TOKENS,
  VOCAB_TOKENS_PER_CONCEPT,
  countText,
  humanBytes,
  millions,
  parsePrice,
  priceOf,
  project,
  recommendEffort,
  summarize,
  type CountedFile,
  type Effort,
  type Projection,
} from "./lib/tokens";
import { readFileSync, statSync } from "node:fs";

const USAGE = "khb estimate [bundle] [--all] [--price IN/OUT] [--top N] [--json]";

/**
 * When one raw file is worth calling out on its own: this share of the backlog's tokens, in a
 * backlog big enough for a share to mean anything. Three files cannot have an outlier.
 */
const OUTLIER_SHARE = 5;
const OUTLIER_MIN_FILES = 20;

const argv = process.argv.slice(2);

const everything = takeFlag(argv, "--all");
const asJson = takeFlag(argv, "--json");
const priceFlag = takeOpt(argv, "--price");
const topFlag = takeOpt(argv, "--top");
rejectUnknownFlags(argv, USAGE);

const price = priceFlag === undefined ? undefined : parsePrice(priceFlag);
if (priceFlag !== undefined && !price) {
  console.error(`--price wants two rates in USD per million tokens, input first: ${paintErr.cmd("--price 3/15")}`);
  process.exit(1);
}
const top = topFlag === undefined ? 5 : Number(topFlag);
if (!Number.isInteger(top) || top < 0) {
  console.error(`--top must be a whole number of 0 or more (got ${JSON.stringify(topFlag)})`);
  process.exit(1);
}
if (argv.length > 1) {
  console.error(`Usage: ${paintErr.cmd(USAGE)}`);
  process.exit(1);
}

// No bundle named is not the ambiguity it is for `khb ingest` — nothing is being written, so
// reporting on every bundle is strictly more useful than stopping to ask which one.
const named = argv[0];
if (named) bundleDir(named); // exits with a clear message if it does not exist
const targets = named ? [named] : listBundles();

type Report = {
  bundle: string;
  concepts: number;
  overheadPerFile: number;
  files: CountedFile[];
  bytes: number;
  words: number;
  tokens: number;
  /** Ledger rows owed a catalog pass whose raw/ file is no longer on disk. */
  missing: number;
  projections: Projection[];
};

/**
 * Which raw files this pass would actually read.
 *
 * The ledger is the worklist, exactly as skills/catalog/SKILL.md says: a row with a `raw`
 * path and an empty `curated` is outstanding, and a row already filled in has been done and
 * would not be read again. `--all` ignores that and prices the whole of `raw/`, which is what
 * you want when deciding whether to re-catalog from scratch.
 */
function worklist(dir: string): { paths: string[]; missing: number } {
  if (everything) return { paths: rawFiles(dir), missing: 0 };
  const rows = [...readLedger(dir).values()].filter((row) => row.raw && !row.curated);
  const paths = rows.map((row) => row.raw).filter((raw) => existsSync(join(dir, raw)));
  return { paths, missing: rows.length - paths.length };
}

const reports: Report[] = [];
for (const bundle of targets) {
  const dir = join(BUNDLES, bundle);
  const { paths, missing } = worklist(dir);
  const concepts = conceptFiles(dir).length;
  // Every subagent prompt carries the protocol's own text plus the bundle's whole existing
  // vocabulary, so extending a large bundle costs more per file than starting an empty one.
  const overheadPerFile = PROMPT_BASE_TOKENS + concepts * VOCAB_TOKENS_PER_CONCEPT;

  // Thousands of raw files is an ordinary corpus and reading them all takes a moment; say so
  // rather than looking hung, and erase the line before anything real is printed.
  const progress = paths.length > 200 && !asJson ? ticker(`reading ${bundle}`, paths.length) : undefined;
  const files: CountedFile[] = [];
  for (const raw of paths) {
    const path = join(dir, raw);
    // The agent reads the file as it stands, provenance header included, so count all of it.
    const counted = countText(readFileSync(path, "utf8"));
    files.push({ path: raw, bytes: statSync(path).size, ...counted });
    progress?.tick();
  }
  progress?.done();

  const corpus = summarize(files);
  reports.push({
    bundle,
    concepts,
    overheadPerFile,
    files,
    bytes: corpus.bytes,
    words: corpus.words,
    tokens: corpus.tokens,
    missing,
    projections: EFFORTS.map((effort) => project(corpus, overheadPerFile, effort)),
  });
}

/** Per-effort totals across every bundle in scope. Summed, not re-projected: each bundle
 *  carries its own vocabulary overhead, and one combined projection would lose that. */
const combined = (effort: Effort): Projection => {
  const at = (pick: (projection: Projection) => number) =>
    reports.reduce((running, report) => running + pick(report.projections[EFFORTS.indexOf(effort)]), 0);
  return { effort, input: at((p) => p.input), output: at((p) => p.output), total: at((p) => p.total) };
};
const totals = EFFORTS.map(combined);
const fileTotal = reports.reduce((running, report) => running + report.files.length, 0);
// The effort a pass should run at if nobody says otherwise. Decided here, once, so the
// skill reads it off the output instead of re-deriving a threshold in prose.
const recommended = recommendEffort(totals);

if (asJson) {
  const shape = (projection: Projection) => ({
    effort: projection.effort,
    input: projection.input,
    output: projection.output,
    total: projection.total,
    ...(price ? { usd: Number(priceOf(projection, price.input, price.output).toFixed(2)) } : {}),
  });
  console.log(
    JSON.stringify(
      {
        hub: HUB,
        scope: everything ? "all" : "backlog",
        bundles: reports.map((report) => ({
          bundle: report.bundle,
          concepts: report.concepts,
          overheadPerFile: report.overheadPerFile,
          files: report.files.length,
          missingRaw: report.missing,
          bytes: report.bytes,
          words: report.words,
          inputTokens: report.tokens,
          projections: report.projections.map(shape),
          recommended: recommendEffort(report.projections),
          largest: [...report.files]
            .sort((a, b) => b.tokens - a.tokens)
            .slice(0, top)
            .map((file) => ({ path: file.path, tokens: file.tokens, words: file.words })),
        })),
        total: {
          files: fileTotal,
          bytes: reports.reduce((running, report) => running + report.bytes, 0),
          words: reports.reduce((running, report) => running + report.words, 0),
          inputTokens: reports.reduce((running, report) => running + report.tokens, 0),
          projections: totals.map(shape),
          recommended,
        },
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

// ---- Report -------------------------------------------------------------------------------
const count = (value: number) => value.toLocaleString("en-US");

console.log(
  `${paint.head("khb estimate")} → ${named ? `bundle ${paint.name(`'${named}'`)}` : `${targets.length} bundle(s)`}`,
);
detail(`hub:      ${paint.path(HUB)}`);
detail(
  `scope:    ${
    everything
      ? "every file in raw/, curated or not (--all)"
      : "the catalog backlog — rows with a raw/ file and an empty 'curated'"
  }`,
);

if (!targets.length) {
  detail(`no bundles yet — ${paint.cmd('khb new-bundle <name> "scope"')}`);
  process.exit(0);
}

/**
 * One projection row: effort, its two halves, the total, a price if rates were given, and a
 * marker on the row a pass should default to. The marker is the point — without it the table
 * is three numbers and no answer, and every reader has to invent their own threshold.
 */
function projectionTable(rows: Projection[], pick: Effort, indent = "  ") {
  const head = `${"effort".padEnd(8)}${"input".padStart(10)}${"output".padStart(10)}${"total".padStart(10)}`;
  console.log(`${indent}${paint.dim(head)}${price ? paint.dim("       cost") : ""}`);
  for (const row of rows) {
    const cost = price ? `  ${`$${priceOf(row, price.input, price.output).toFixed(2)}`.padStart(9)}` : "";
    const mark = row.effort === pick ? `  ${paint.ok("← default")}` : "";
    console.log(
      `${indent}${row.effort.padEnd(8)}${millions(row.input).padStart(10)}` +
        `${millions(row.output).padStart(10)}${paint.bold(millions(row.total).padStart(10))}${cost}${mark}`,
    );
  }
}

const missing = reports.reduce((running, report) => running + report.missing, 0);

// Before the counts, not after: a block of zeros followed by "nothing to catalog" makes the
// reader work out that the zeros were the answer.
if (!fileTotal) {
  section("Nothing to catalog");
  detail(
    everything
      ? `no raw/ files in ${named ? `bundle '${named}'` : "any bundle"} — run ${paint.cmd("khb ingest <bundle>")} first.`
      : `every raw/ row already has a 'curated' value. ${paint.cmd("khb estimate --all")} prices a re-catalog.`,
  );
  if (missing) detail(paint.warn(`${missing} backlog row(s) name a raw/ file that is gone.`));
  console.log(`\n${paint.head("estimate")}: nothing outstanding, in ${totalElapsed()}`);
  process.exit(0);
}

section("Raw material");
if (reports.length > 1) {
  const nameWidth = Math.max(6, ...reports.map((report) => report.bundle.length));
  detail(paint.dim(`${"bundle".padEnd(nameWidth)}  concepts   files       words     tokens`));
  for (const report of reports)
    detail(
      `${report.bundle.padEnd(nameWidth)}  ${String(report.concepts).padStart(8)}   ` +
        `${String(report.files.length).padStart(5)}   ${count(report.words).padStart(9)}   ` +
        `${millions(report.tokens).padStart(8)}`,
    );
  detail(
    `${paint.dim("total".padEnd(nameWidth))}  ${"".padStart(8)}   ${String(fileTotal).padStart(5)}   ` +
      `${count(reports.reduce((running, report) => running + report.words, 0)).padStart(9)}   ` +
      paint.bold(millions(reports.reduce((running, report) => running + report.tokens, 0)).padStart(8)),
  );
} else {
  const [only] = reports;
  detail(`files      ${count(only.files.length)}`);
  detail(`size       ${humanBytes(only.bytes)}`);
  detail(`words      ${count(only.words)}`);
  detail(`tokens     ${paint.bold(millions(only.tokens))}  ${paint.dim("(chars÷4 or words×1.33, whichever is larger)")}`);
  detail(
    `prompt     ${count(only.overheadPerFile)} tokens per file — the catalog prompt plus ` +
      `${only.concepts} existing concept(s) as vocabulary`,
  );
}

if (missing)
  detail(
    paint.warn(`note       ${missing} backlog row(s) name a raw/ file that is gone — not counted.`),
  );

section("Projection");
detail(
  paint.dim("input = the material and its per-file prompt, resent as the pass runs; output = concepts plus reasoning"),
);
console.log();
projectionTable(totals, recommended, "  ");
console.log();
for (const effort of EFFORTS) detail(paint.dim(`${effort.padEnd(8)}${EFFORT_PROFILES[effort].note}`));

if (reports.length > 1) {
  section("Per bundle");
  for (const report of reports) {
    if (!report.files.length) continue;
    detail(`${paint.name(report.bundle)}  ${report.files.length} file(s), ${millions(report.tokens)} tokens of material`);
    projectionTable(report.projections, recommendEffort(report.projections), "    ");
  }
}

if (top && reports.length === 1 && reports[0].files.length) {
  const [only] = reports;
  const largest = [...only.files].sort((a, b) => b.tokens - a.tokens).slice(0, top);
  section(`Largest ${largest.length} raw file(s)`);
  for (const file of largest) {
    // The share is what makes this list actionable: on most corpora a couple of scans or
    // exports carry a quarter of the bill, and dropping those is the cheapest real saving
    // there is. A bare token count leaves everyone to do that division themselves.
    const share = only.tokens ? (file.tokens / only.tokens) * 100 : 0;
    const flag = share >= OUTLIER_SHARE && only.files.length > OUTLIER_MIN_FILES ? paint.warn("  outlier") : "";
    detail(`${millions(file.tokens).padStart(9)}  ${`${share.toFixed(1)}%`.padStart(6)}   ${paint.path(file.path)}${flag}`);
  }
}

section("Next");
if (!price)
  detail(
    `these are tokens, not dollars. Add your model's rates to price them: ` +
      `${paint.cmd(`khb estimate ${named ?? ""}${named ? " " : ""}--price 3/15`)} ${paint.dim("(USD per million, input/output)")}`,
  );
detail(`catalog it — ${paint.path("skills/catalog/SKILL.md")}, at ${paint.bold(recommended)} effort unless you ask for another`);
detail(paint.dim(`coefficients live in scripts/lib/tokens.ts; a real run lands either side of them.`));

// Quote the run that will actually happen. This line used to hardcode medium, so a corpus
// big enough to default to `low` was headlined at nearly double what it would cost.
const headline = totals[EFFORTS.indexOf(recommended)];
console.log(
  `\n${paint.head("estimate")}: ${count(fileTotal)} raw file(s), ${paint.bold(millions(headline.total))} tokens ` +
    `at ${recommended} effort${price ? ` (~$${priceOf(headline, price.input, price.output).toFixed(2)})` : ""}, in ${totalElapsed()}`,
);
