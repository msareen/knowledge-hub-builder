// bun scripts/triage.ts <path...> [--out <file>] — phase 0 of ingest.md.
// Indexes a corpus WITHOUT copying it: one JSONL row per file (path, size, hash, head
// snippet). The agent reads the manifest to decide which bundles exist and what routes
// where; only then does anything get acquired. Output is gitignored scratch.
import { readdirSync, statSync, writeFileSync, mkdirSync, openSync, readSync, closeSync } from "node:fs";
import { INBOX, join, sha256File, existsSync } from "./lib/util";
import { kindOf, extOf } from "./ingest/exts";

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const out = outIdx >= 0 ? args[outIdx + 1] : join(INBOX, "manifest.jsonl");
const roots = (outIdx >= 0 ? [...args.slice(0, outIdx), ...args.slice(outIdx + 2)] : args).filter(Boolean);

if (!roots.length) {
  console.error("Usage: bkr triage <path...> [--out inbox/manifest.jsonl]");
  process.exit(1);
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".venv", "__pycache__", "dist", "build"]);

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    console.warn(`  unreadable, skipped: ${dir}`);
    return [];
  }
  return entries.flatMap((f) => {
    const p = join(dir, f);
    let st;
    try {
      st = statSync(p);
    } catch {
      return [];
    }
    if (st.isDirectory()) return SKIP_DIRS.has(f) || f.startsWith(".") ? [] : walk(p);
    return [p];
  });
}

/** First bytes only — a corpus is too big to read whole just to classify it. */
function head(path: string, bytes = 1024): string {
  try {
    const fd = openSync(path, "r");
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    closeSync(fd);
    return buf
      .subarray(0, n)
      .toString("utf8")
      .replace(/\s+/g, " ")
      .replace(/[^\x20-\x7E]/g, "")
      .trim()
      .slice(0, 500);
  } catch {
    return "";
  }
}

type Row = { path: string; size: number; mtime: string; sha256: string; ext: string; kind: string; head: string };

const rows: Row[] = [];
const byHash = new Map<string, string[]>();

for (const root of roots) {
  if (!existsSync(root)) {
    console.error(`No such path: ${root}`);
    process.exit(1);
  }
  const files = statSync(root).isDirectory() ? walk(root) : [root];
  console.log(`${root}: ${files.length} file(s)`);
  for (const p of files) {
    const st = statSync(p);
    const kind = kindOf(p);
    const hash = await sha256File(p);
    rows.push({
      path: p.replaceAll("\\", "/"),
      size: st.size,
      mtime: st.mtime.toISOString(),
      sha256: hash,
      ext: extOf(p),
      kind,
      head: kind === "text" ? head(p) : "",
    });
    byHash.set(hash, [...(byHash.get(hash) ?? []), p]);
  }
}

mkdirSync(INBOX, { recursive: true });
writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

// Summary — what the agent needs to size the routing job before reading the manifest.
const byExt = new Map<string, number>();
for (const r of rows) byExt.set(r.ext || "(none)", (byExt.get(r.ext || "(none)") ?? 0) + 1);
const dupes = [...byHash.values()].filter((v) => v.length > 1);
const bytes = rows.reduce((n, r) => n + r.size, 0);

console.log(`\nmanifest: ${out}`);
console.log(`  ${rows.length} file(s), ${(bytes / 1e9).toFixed(2)} GB indexed, 0 bytes copied`);
console.log(`  ${byHash.size} unique by content; ${dupes.length} duplicate group(s)`);
console.log(
  `  kinds: ${["text", "extractable", "skip"].map((k) => `${k}=${rows.filter((r) => r.kind === k).length}`).join(", ")}`,
);
console.log(
  `  top types: ${[...byExt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([e, n]) => `${e}:${n}`).join(" ")}`,
);
console.log(`\nNext: read the manifest, cluster into topics, write inbox/routing.yaml, then: bkr route`);
