// bun scripts/split.ts <from> <new-bundle> (--tag T | --docs a.md,b.md) [--apply]
//                      [--only-tagged] [--scope "..."]
//
// Promote part of a curated bundle into its own bundle — the late half of ingest.md's
// phase 0. Selection is by tag (or an explicit doc list), but what MOVES is the link
// closure: every doc reachable from the selection, and everything those reach. Nothing in
// a bundle stands alone, so moving a doc without its neighbours would leave links pointing
// at files that are no longer there, and cross-bundle links are a lint error (L6) by design.
//
// Dry-run by default. `--apply` writes.
import { renameSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { BUNDLES, HUB, read, mdLinks, join, existsSync, listBundles } from "./lib/util";
import { loadBundle, linkClosure, makeResolver, indexTargets } from "./lib/concepts";
import { readLedger, writeLedger } from "./lib/ledger";
import { scaffoldBundle, BUNDLE_NAME } from "./lib/scaffold";
import { takeFlag, takeValue } from "./lib/args";

const args = process.argv.slice(2);
const apply = takeFlag(args, "--apply");
const onlyTagged = takeFlag(args, "--only-tagged");
const tag = takeValue(args, "--tag");
const docsArg = takeValue(args, "--docs");
const scope = takeValue(args, "--scope");
const [from, to] = args.filter(Boolean);

if (!from || !to || (!tag && !docsArg)) {
  console.error(
    "Usage: khb split <from> <new-bundle> (--tag T | --docs a.md,b.md) [--apply] [--only-tagged] [--scope \"...\"]",
  );
  process.exit(1);
}
if (!BUNDLE_NAME.test(to)) {
  console.error(`Bad bundle name '${to}' (lowercase, digits, hyphens)`);
  process.exit(1);
}
if (from === to) {
  console.error("Source and destination are the same bundle");
  process.exit(1);
}

const g = loadBundle(from);
const targetExists = listBundles().includes(to);

// ── selection ───────────────────────────────────────────────────────────────────
const seeds = tag
  ? (g.tags.get(tag)?.docs ?? [])
  : docsArg!.split(",").map((s) => s.trim().replaceAll("\\", "/")).filter(Boolean);

if (!seeds.length) {
  console.error(tag ? `No doc in ${from} carries the tag '${tag}'` : "No docs selected");
  console.error(`See what is there: khb recatalog ${from}`);
  process.exit(1);
}
const unknown = seeds.filter((s) => !g.docs.has(s));
if (unknown.length) {
  console.error(`Not concept docs in ${from}: ${unknown.join(", ")}`);
  process.exit(1);
}

const { closure, dragged } = linkClosure(g, seeds);
const moving = onlyTagged ? [...seeds].sort() : closure;
const movingSet = new Set(moving);

// Edges that would cross the new boundary. Zero by construction unless --only-tagged.
const cut: { from: string; to: string }[] = [];
for (const p of moving)
  for (const l of g.docs.get(p)!.links) if (!movingSet.has(l)) cut.push({ from: p, to: l });
for (const [p, d] of g.docs)
  if (!movingSet.has(p)) for (const l of d.links) if (movingSet.has(l)) cut.push({ from: p, to: l });

// ── plan ────────────────────────────────────────────────────────────────────────
console.log(`${from} -> ${to}${targetExists ? "" : "  (new bundle)"}`);
console.log(`  selected: ${seeds.length} doc(s)${tag ? ` tagged '${tag}'` : ""}`);
if (!onlyTagged && dragged.length) {
  console.log(`  pulled in by links: ${dragged.length} doc(s) — they are linked from the selection, or link into it`);
  for (const d of dragged.slice(0, 12)) {
    const tags = g.docs.get(d)!.tags;
    console.log(`      ${d}${tags.length ? `  [${tags.join(", ")}]` : "  [untagged]"}`);
  }
  if (dragged.length > 12) console.log(`      … and ${dragged.length - 12} more (full list in the recatalog JSON)`);
}
console.log(`  moving: ${moving.length} doc(s)`);

if (cut.length) {
  console.log(`\n  ${cut.length} link(s) would be cut — they will dangle (lint L12) until you rewrite them:`);
  for (const c of cut.slice(0, 12)) console.log(`      ${c.from} -> ${c.to}`);
  if (cut.length > 12) console.log(`      … and ${cut.length - 12} more`);
  if (onlyTagged) {
    console.log(`  --only-tagged asked for this. refs.md will record the relationship; the prose is yours to fix.`);
  } else {
    console.error(`\nRefusing: a whole-component move cannot cut links. This is a bug — report it.`);
    process.exit(1);
  }
}

// Which OTHER tags does this split take docs from? Splits happen one at a time, and each
// one rewrites the graph the next decision would be made on, so a tag left straddling the
// boundary is the thing most likely to make you regret the order you did them in.
type Conflict = { tag: string; moves: number; stays: number };
const conflicts: Conflict[] = [];
for (const [t, st] of g.tags) {
  if (t === tag) continue;
  const moves = st.docs.filter((p) => movingSet.has(p)).length;
  if (!moves) continue;
  conflicts.push({ tag: t, moves, stays: st.docs.length - moves });
}
const torn = conflicts.filter((c) => c.stays).sort((a, b) => b.moves - a.moves || a.tag.localeCompare(b.tag));
const whole = conflicts.filter((c) => !c.stays).sort((a, b) => b.moves - a.moves);

if (torn.length) {
  console.log(`\n  splits ${torn.length} other tag(s) across the boundary:`);
  for (const c of torn)
    console.log(
      `      ${c.tag}: ${c.moves} doc(s) move to ${to}, ${c.stays} stay in ${from}` +
        (c.moves >= c.stays ? `  ← most of it is leaving; is '${c.tag}' the better cut?` : ""),
    );
  console.log(`  A torn tag can still be split later, but from a different graph — re-run`);
  console.log(`  'khb recatalog' after this move before deciding on any of them.`);
}
if (whole.length)
  console.log(
    `\n  travels intact: ${whole.map((c) => `${c.tag}(${c.moves})`).join(", ")} — ` +
      `${whole.length === 1 ? "this tag lives" : "these tags live"} entirely inside ${to} now`,
  );

if (!apply) {
  console.log(`\nDry run. Re-run with --apply to perform the move.`);
  process.exit(0);
}

// ── apply ───────────────────────────────────────────────────────────────────────
if (!targetExists) scaffoldBundle(HUB, to, scope ?? (tag ? `TODO scope — split from ${from} on tag '${tag}'` : `TODO scope`));
const toDir = join(BUNDLES, to);

// 1. Move the files, keeping their subdirectory layout.
for (const p of moving) {
  const dest = join(toDir, p);
  mkdirSync(dirname(dest), { recursive: true });
  renameSync(join(g.dir, p), dest);
}

// 2. Drop their lines from the source bundle's index files.
const resolve = makeResolver(g.dir);
let removed = 0;
for (const [idx, targets] of indexTargets(g.dir)) {
  if (!targets.some((t) => movingSet.has(t))) continue;
  const lines = read(join(g.dir, idx)).split("\n");
  const kept = lines.filter((line) => {
    if (!/^\s*[-*|]/.test(line)) return true;
    const hit = mdLinks(line).some((l) => {
      const r = resolve(idx, l.target);
      return r !== null && movingSet.has(r);
    });
    if (hit) removed++;
    return !hit;
  });
  writeFileSync(join(g.dir, idx), kept.join("\n"));
}

// 3. Register them in the new bundle's index.md.
const toIndex = join(toDir, "index.md");
const entries = moving.map((p) => {
  const d = g.docs.get(p)!;
  return `* [${d.title ?? p.replace(/\.md$/, "")}](${p}) - ${d.description ?? "TODO description"}`;
});
writeFileSync(toIndex, read(toIndex).trimEnd() + "\n\n" + entries.join("\n") + "\n");

// 4. refs.md both ways — the relationship survives the split, just not as a link.
function addRef(dir: string, target: string, why: string) {
  const p = join(dir, "refs.md");
  const text = existsSync(p) ? read(p) : `# refs\n\n| Bundle | Why | Note (optional) |\n|---|---|---|\n`;
  if (new RegExp(`^\\|\\s*\\[?${target}\\b`, "m").test(text)) return;
  writeFileSync(p, text.trimEnd() + `\n| ${target} | ${why} |  |\n`);
}
addRef(g.dir, to, `split out of this bundle${tag ? ` on tag '${tag}'` : ""}`);
addRef(toDir, from, `split from ${from}${tag ? ` on tag '${tag}'` : ""}`);

// 5. Carry the ledger rows whose `curated` names a moved doc — provenance moves with the
//    knowledge, or the new bundle has docs nobody can trace.
const fromLedger = readLedger(g.dir);
const toLedger = readLedger(toDir);
const movedSources: string[] = [];
for (const [source, e] of fromLedger) {
  const curated = e.curated.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  if (!curated.some((c) => movingSet.has(c.replaceAll("\\", "/")))) continue;
  if (curated.some((c) => !movingSet.has(c.replaceAll("\\", "/")))) continue; // shared source: leave it, both cite it
  // Move raw/ alongside, so `khb ingest` doesn't re-acquire it into the old bundle.
  if (e.raw && existsSync(join(g.dir, e.raw))) {
    const dest = join(toDir, e.raw);
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(join(g.dir, e.raw), dest);
  }
  toLedger.set(source, e);
  fromLedger.delete(source);
  movedSources.push(source);
}
if (movedSources.length) {
  writeLedger(g.dir, fromLedger, from);
  writeLedger(toDir, toLedger, to);
}

// 6. Move those sources' paths between the `files` source lists.
function moveFilePaths(dir: string, take: string[], mode: "remove" | "add") {
  const sp = join(dir, "sources.yaml");
  if (!existsSync(sp)) return;
  const text = read(sp);
  const preamble = text.split("\n").filter((l) => l.startsWith("#")).join("\n");
  const cfg = (parseYaml(text) ?? {}) as { sources?: any[] };
  const sources = cfg.sources ?? [];
  let files = sources.find((s) => s?.type === "files");
  if (mode === "remove") {
    if (!files?.paths) return;
    files.paths = files.paths.filter((p: string) => !take.includes(p));
    if (!files.paths.length) sources.splice(sources.indexOf(files), 1);
  } else {
    const add = take.filter(Boolean);
    if (!add.length) return;
    if (!files) { files = { type: "files", paths: [] }; sources.push(files); }
    files.paths = [...new Set([...(files.paths ?? []), ...add])];
  }
  writeFileSync(sp, preamble + "\n" + stringifyYaml({ ...cfg, sources }));
}
moveFilePaths(g.dir, movedSources, "remove");
moveFilePaths(toDir, movedSources, "add");

console.log(`\nMoved:`);
console.log(`  ${moving.length} concept doc(s) -> bundles/${to}/`);
console.log(`  ${removed} index line(s) removed from ${from}, ${entries.length} added to ${to}`);
console.log(`  ${movedSources.length} ledger row(s) + their raw/ files`);
console.log(`  refs.md updated in both bundles`);
console.log(`\nNext:`);
console.log(`  1. Write ${to}'s scope line in outer.index.md — routing is why the bundle exists`);
if (cut.length) console.log(`  2. Rewrite the ${cut.length} cut link(s) as prose + a refs.md pointer (lint will list them)`);
console.log(`  ${cut.length ? 3 : 2}. khb lint`);
