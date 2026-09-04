// Pure decision logic for `khb go --respond` — split out of hubs.ts (which is a top-level
// script that dispatches on process.argv/KHB_SUBCOMMAND at import time, and so cannot
// itself be imported from a test) so it can be unit tested directly.

/** `khb-response-<hub>-<timestamp>.md`, for `khb go --respond` runs with no `--file`. */
export function defaultResponseFile(hubName: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `khb-response-${hubName}-${stamp}.md`;
}

/**
 * Should this session's answer be saved? `respond` (`-r`) or naming a `file` (`-f`) both mean
 * yes outright — you already said what you want. Otherwise it comes down to the y/N answer
 * (default no, same convention as every other prompt in hubs.ts: only a leading y/Y is yes;
 * no terminal to ask on, `answer` is undefined, also reads as no).
 */
export function shouldRespond(respond: boolean, file: string | undefined, answer: string | undefined): boolean {
  if (respond || file) return true;
  return !!answer && /^y/i.test(answer.trim());
}
