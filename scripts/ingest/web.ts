// Internet links → raw/web/. Naive HTML→text; swap in a readability lib later.
// A fetch is unavoidable (the hash only exists once the body is retrieved), but an
// unchanged body still short-circuits the rewrite and keeps the ledger row stable.
import { writeRaw, sha256, rawNameFor } from "../lib/util";
import { record, isFresh, type Entry } from "../lib/ledger";
import { detail, item, note, outcome, pos } from "../lib/log";
import type { Options } from "./acquire";
import type { Source } from "./index";

export async function ingestWeb(
  s: Extract<Source, { type: "web" }>,
  rawDir: string,
  bundleDir: string,
  entries: Map<string, Entry>,
  { force }: Options,
) {
  detail(`${s.urls.length} url(s) declared`);
  let skipped = 0;
  for (const [i, url] of s.urls.entries()) {
    item(pos(i + 1, s.urls.length), url);
    try {
      note("fetching …");
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const html = await res.text();
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;/g, (m) => ({ "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"' })[m]!)
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      const hash = sha256(text);
      if (!force && isFresh(entries, bundleDir, url, hash)) {
        skipped++;
        outcome("unchanged, skipped");
        continue;
      }
      const name = new URL(url).pathname.split("/").filter(Boolean).pop() || new URL(url).hostname;
      const file = rawNameFor(rawDir, `${name}.md`, url, entries.values());
      const raw = writeRaw(rawDir, file, { source: url, sha256: hash.slice(0, 12), tool: "html-strip", quality: "high" }, text);
      record(entries, { source: url, sha256: hash, fetched: new Date().toISOString(), raw });
      outcome(`fetched → ${raw}  [html-strip, ${text.length} chars]`);
    } catch (e) {
      // A transient refresh failure must not erase a previously acquired, still-usable
      // copy. Record a pending row only when this source has never succeeded before.
      if (!entries.has(url))
        record(entries, { source: url, sha256: "", fetched: new Date().toISOString(), raw: "" });
      outcome(`failed — ${e}`);
    }
  }
  if (skipped) console.log(`  ${skipped} unchanged, skipped`);
}
