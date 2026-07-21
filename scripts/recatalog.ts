// bun scripts/recatalog.ts [bundle] [--out <file>] [--min N] — catalog a *curated* bundle.
//
// Bundles are never chosen from raw files. This runs after curation instead: the bundle's
// concept docs carry real front matter, and the question is whether some tag inside it has
// grown into a bundle of its own. Evidence beats guessing, so this reads every concept doc
// and writes the whole picture to JSON before anyone proposes a split.
//
// The number that matters is the closure, not the tag count: docs are linked, so pulling a
// tag pulls whatever it links to, and whatever that links to. A tag whose closure is much
// larger than the tag itself is not a bundle — it is a thread through one.
import { writeFileSync, mkdirSync } from "node:fs";
import { INBOX, join, primaryBundle, existsSync, BUNDLES } from "./lib/util";
import { loadBundle, linkClosure } from "./lib/concepts";
import { takeValue } from "./lib/args";

const args = process.argv.slice(2);
const outArg = takeValue(args, "--out");
const min = Number(takeValue(args, "--min") ?? 3);
const bundle = args.filter(Boolean)[0] ?? primaryBundle();

if (!bundle) {
  console.error("Usage: khb recatalog [bundle] [--out <file>] [--min N]");
  console.error("No bundle given and this hub has no primary bundle.");
  process.exit(1);
}
if (!existsSync(join(BUNDLES, bundle))) {
  console.error(`No such bundle: ${bundle}`);
  process.exit(1);
}

const g = loadBundle(bundle);
const docs = [...g.docs.values()];

if (!docs.length) {
  console.log(`${bundle}: no concept docs yet — nothing to recatalog. Curate first (ingest.md phase 2).`);
  process.exit(0);
}

// Per-tag closure: what a split on this tag would actually move.
const tagRows = [...g.tags.entries()]
  .map(([tag, st]) => {
    const { closure, dragged } = linkClosure(g, st.docs);
    return { tag, ...st, closure, dragged };
  })
  .sort((a, b) => b.docs.length - a.docs.length || a.tag.localeCompare(b.tag));

const untagged = docs.filter((d) => !d.tags.length);
const singletons = g.components.filter((c) => c.length === 1).length;

const catalog = {
  bundle,
  generated: new Date().toISOString(),
  docs: docs
    .map((d) => ({ ...d, links: d.links.sort() }))
    .sort((a, b) => a.path.localeCompare(b.path)),
  components: g.components,
  tags: Object.fromEntries(
    tagRows.map((r) => [
      r.tag,
      {
        docs: r.docs.sort(),
        types: r.types,
        co_occurs: Object.fromEntries([...r.co.entries()].sort((a, b) => b[1] - a[1])),
        closure: r.closure,
        dragged: r.dragged,
      },
    ]),
  ),
};

const out = outArg ?? join(INBOX, "recatalog", `${bundle}.json`);
mkdirSync(join(out, ".."), { recursive: true });
writeFileSync(out, JSON.stringify(catalog, null, 2) + "\n");

// ── report ──────────────────────────────────────────────────────────────────────
const pad = (s: string, n: number) => s.padEnd(n);
console.log(`${bundle}: ${docs.length} concept doc(s), ${g.tags.size} tag(s)`);
console.log(`  ${g.components.length} link component(s) — ${singletons} doc(s) link to nothing`);
if (untagged.length) console.log(`  ${untagged.length} doc(s) carry no tags — they can never be split out by tag`);

const shown = tagRows.filter((r) => r.docs.length >= min);
if (shown.length) {
  console.log(`\n  ${pad("tag", 20)} ${pad("docs", 5)} ${pad("closure", 8)} types / co-occurs`);
  for (const r of shown) {
    const co = [...r.co.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, n]) => `${t}(${n})`);
    const facets = [r.types.slice(0, 2).join(", "), co.join(" ")].filter(Boolean).join("  |  ");
    const closure = r.dragged.length ? `${r.closure.length} (+${r.dragged.length})` : `${r.closure.length}`;
    console.log(`  ${pad(r.tag, 20)} ${pad(String(r.docs.length), 5)} ${pad(closure, 8)} ${facets}`);
  }
  console.log(`\n  (tags under ${min} doc(s) hidden — --min N to change)`);
}

// A tag splits cleanly when its closure is the tag itself: nothing else comes with it.
const clean = tagRows.filter((r) => r.docs.length >= min && !r.dragged.length);
const messy = tagRows.filter((r) => r.docs.length >= min && r.dragged.length);

console.log(`\ncatalog: ${out}`);
if (clean.length) {
  console.log(`\nSplits cleanly (closure == the tag, no links cut):`);
  for (const r of clean) console.log(`  khb split ${bundle} <new-bundle> --tag ${r.tag}    # ${r.docs.length} doc(s)`);
}
if (messy.length) {
  console.log(`\nDrags other docs along — read the closure before splitting:`);
  for (const r of messy)
    console.log(`  ${r.tag}: ${r.docs.length} tagged, ${r.closure.length} would move (+${r.dragged.length} pulled in by links)`);
  console.log(`  That is the honest cost of the split. Take the whole closure, or keep the tag where it is.`);
}
if (!clean.length && !messy.length)
  console.log(`\nNo tag has ${min}+ docs yet. Keep curating into ${bundle}; split when a tag has earned it.`);
