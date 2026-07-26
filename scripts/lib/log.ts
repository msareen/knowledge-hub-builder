// Progress reporting for the long-running commands.
//
// Ingest is mostly waiting, and it waits inside libraries that say nothing: a scanned PDF is
// seconds per page, a video is minutes per file. A silent process is indistinguishable from
// a hung one, and after the fact "which file produced that?" is unanswerable. So every unit
// of work announces itself BEFORE the work starts, carrying its position in the run, and
// closes with what happened and how long it took.
//
// Verbose is the only mode on purpose. There is no --quiet: the per-file line is the audit
// trail for a pass that rewrites a bundle's raw/, and a run whose output you have to re-run
// to reconstruct is worse than a noisy one. Nothing here changes what khb does.

const RUN_START = Date.now();
let itemStart = RUN_START;

export const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** Wall-clock time since the process started — the closing line of a command. */
export const totalElapsed = () => secs(Date.now() - RUN_START);

/** "[ 3/57]" — the counter is right-aligned so filenames stay in one column. */
export function pos(i: number, n: number): string {
  return `[${String(i).padStart(String(n).length)}/${n}]`;
}

/** A blank-line-separated heading: a source, a bundle, a phase. */
export function section(title: string) {
  console.log(`\n${title}`);
}

/** Indented context under a heading — settings, counts, where things are going. */
export function detail(msg: string) {
  console.log(`  ${msg}`);
}

/**
 * The unit of work about to start. Prints before any work happens — that is the whole
 * point — and starts this item's clock.
 */
export function item(prefix: string, label: string) {
  itemStart = Date.now();
  console.log(`  ${prefix} ${label}`);
}

/** A step inside the current item: what khb is about to do, or what it just learned. */
export function note(msg: string) {
  console.log(`         ${msg}`);
}

/** How the current item ended, with its own elapsed time. Exactly one per item. */
export function outcome(msg: string) {
  console.log(`         ${msg} (${secs(Date.now() - itemStart)})`);
}
