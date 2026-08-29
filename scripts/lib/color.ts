// Colour for the terminal — semantic names only, so every colour decision lives in this
// file and call sites say what a thing *is* rather than which escape code it wants.
//
// Two palettes, one per stream, because khb deliberately splits its output: a command's
// result goes to stdout and its asides go to stderr (the version-drift notice in cli.ts,
// the in-place counter in log.ts). `khb list > hubs.txt` run on a terminal should write a
// clean file while the warning still reaching the terminal keeps its colour, and a single
// shared flag cannot be right for both.
//
// NO_COLOR (any value) turns everything off; FORCE_COLOR (anything but "0") turns it on
// even through a pipe. Both are the usual informal conventions, and both are what a CI log
// or a test harness will reach for.

type Paint = (text: string) => string;

/** Semantic roles. Nothing outside this file names a colour. */
export interface Palette {
  /** A section heading. */
  head: Paint;
  /** A literal command the user can type — the one thing they should be able to spot. */
  cmd: Paint;
  /** A filesystem path. */
  path: Paint;
  /** A hub, bundle or agent name. */
  name: Paint;
  /** Healthy, finished, nothing owed. */
  ok: Paint;
  /** Needs attention, but the command still did its job. */
  warn: Paint;
  /** A failure. */
  bad: Paint;
  /** Secondary text that should not compete with the line it sits under. */
  dim: Paint;
  bold: Paint;
}

// Closing codes matter for nesting: colour closes with 39 (default foreground) and
// bold/dim with 22, so an inner span never cancels the attribute wrapping it.
const wrap =
  (open: number, close: number): Paint =>
  (text) =>
    `\x1b[${open}m${text}\x1b[${close}m`;

const plain: Paint = (text) => text;

function supported(stream: NodeJS.WriteStream): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") return true;
  if (process.env.TERM === "dumb") return false;
  return Boolean(stream.isTTY);
}

function palette(stream: NodeJS.WriteStream): Palette {
  if (!supported(stream))
    return { head: plain, cmd: plain, path: plain, name: plain, ok: plain, warn: plain, bad: plain, dim: plain, bold: plain };
  const bold = wrap(1, 22);
  const dim = wrap(2, 22);
  return {
    head: bold,
    cmd: wrap(36, 39), // cyan
    path: dim,
    name: bold,
    ok: wrap(32, 39), // green
    warn: wrap(33, 39), // yellow
    bad: wrap(31, 39), // red
    dim,
    bold,
  };
}

/** Colours for stdout — a command's actual output. */
export const paint = palette(process.stdout);

/** Colours for stderr — warnings, errors, and everything said in the margin. */
export const paintErr = palette(process.stderr);
