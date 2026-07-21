// Live progress bar for the commands that walk a whole corpus. Redrawn in place via \r,
// and a no-op when stdout isn't a TTY (piped, CI) so logs don't fill with control codes.
const BAR_WIDTH = 24;
const LINE_WIDTH = 140;

export function renderProgress(done: number, total: number, label: string) {
  if (!process.stdout.isTTY) return;
  const pct = total ? Math.floor((done / total) * 100) : 100;
  const filled = Math.round((BAR_WIDTH * pct) / 100);
  const bar = "#".repeat(filled) + "-".repeat(BAR_WIDTH - filled);
  const line = `[${bar}] ${pct}% (${done}/${total}) ${label}`.slice(0, LINE_WIDTH);
  process.stdout.write(`\r${line.padEnd(LINE_WIDTH)}`);
}

/** Break out of the redrawn line so normal output starts clean. */
export function endProgress() {
  if (process.stdout.isTTY) process.stdout.write("\n");
}

/** Log a line without it being clobbered by the progress bar's \r. */
export function logAbove(msg: string) {
  console.log(process.stdout.isTTY ? `\n${msg}` : msg);
}
