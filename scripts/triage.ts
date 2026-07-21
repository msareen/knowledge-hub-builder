// bun scripts/triage.ts <path...> [--out <file>] [--error-log <file>] [--skip-protected] [--verbose]
// Phase 0 of skills/ingest/SKILL.md. Indexes a corpus WITHOUT copying it: one JSONL row per file
// (path, size, hash, head snippet). The agent reads the manifest to decide which
// bundles exist and what routes where; only then does anything get acquired.
// Output is gitignored scratch.
import { readdirSync, statSync, writeFileSync, mkdirSync, openSync, readSync, closeSync } from "node:fs";
import { INBOX, join, basename, sha256File, existsSync } from "./lib/util";
import { kindOf, extOf, type Kind } from "./ingest/exts";
import { PROTECTABLE, detectPasswordProtected } from "./ingest/protect";
import { takeFlag, takeValue } from "./lib/args";
import { renderProgress, endProgress, logAbove } from "./lib/progress";

const args = process.argv.slice(2);

const verbose = takeFlag(args, "--verbose");
const skipProtected = takeFlag(args, "--skip-protected");
const out = takeValue(args, "--out") ?? join(INBOX, "manifest.jsonl");
const errorLog = takeValue(args, "--error-log") ?? join(INBOX, "triage-errors.jsonl");
const roots = args.filter(Boolean);

if (!roots.length) {
  console.error(
    "Usage: khb triage <path...> [--out inbox/manifest.jsonl] [--error-log inbox/triage-errors.jsonl] [--skip-protected] [--verbose]",
  );
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

/** What triage will actually do to this file — shown in the progress line. */
function opLabel(kind: Kind, ext: string): string {
  if (kind === "skip") return "skip";
  const ops = ["hash"];
  if (kind === "text") ops.push("head");
  if (PROTECTABLE.has(ext)) ops.push("password-check");
  return ops.join("+");
}

/** Per-file verbose trail. */
function vlog(msg: string) {
  if (verbose) logAbove(msg);
}

type Row = {
  path: string;
  size: number;
  mtime: string;
  sha256: string;
  ext: string;
  kind: string;
  head: string;
  protected: boolean;
};

type ErrorRow = { path: string; kind: string; message: string; timestamp: string };

const rows: Row[] = [];
const errors: ErrorRow[] = [];
const byHash = new Map<string, string[]>();

function logError(path: string, kind: string, message: string) {
  errors.push({ path: path.replaceAll("\\", "/"), kind, message, timestamp: new Date().toISOString() });
}

// Walk every root up front so the progress bar can show a true total.
const allFiles: string[] = [];
for (const root of roots) {
  if (!existsSync(root)) {
    console.error(`No such path: ${root}`);
    process.exit(1);
  }
  const files = statSync(root).isDirectory() ? walk(root) : [root];
  console.log(`${root}: ${files.length} file(s)`);
  allFiles.push(...files);
}

let protectedSeen = 0;
for (let i = 0; i < allFiles.length; i++) {
  const p = allFiles[i];
  const ext = extOf(p);
  const kind = kindOf(p);
  renderProgress(i + 1, allFiles.length, `${basename(p)} [${opLabel(kind, ext)}]`);

  try {
    const st = statSync(p);

    // Cheap check first: skip the (much more expensive) full-file hash entirely
    // when the file is protected and the caller asked to drop those.
    let isProtected = false;
    if (kind !== "skip" && PROTECTABLE.has(ext)) {
      isProtected = detectPasswordProtected(p, ext, st.size);
      if (isProtected) {
        protectedSeen++;
        logError(p, "password_protected", "encrypted document detected (heuristic byte-signature check)");
        vlog(`  [protected] ${p}`);
        if (skipProtected) continue;
      }
    }

    const hash = await sha256File(p);
    const row: Row = {
      path: p.replaceAll("\\", "/"),
      size: st.size,
      mtime: st.mtime.toISOString(),
      sha256: hash,
      ext,
      kind,
      head: kind === "text" ? head(p) : "",
      protected: isProtected,
    };
    rows.push(row);
    byHash.set(hash, [...(byHash.get(hash) ?? []), p]);
    vlog(`  [ok] ${p} (${kind}${isProtected ? ", protected" : ""})`);
  } catch (err) {
    logError(p, "read_error", String(err));
    vlog(`  [error] ${p}: ${err}`);
  }
}
endProgress();

mkdirSync(INBOX, { recursive: true });
writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
if (errors.length) {
  mkdirSync(INBOX, { recursive: true });
  writeFileSync(errorLog, errors.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

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
if (protectedSeen) {
  console.log(
    `  ${protectedSeen} password-protected file(s) detected` +
      (skipProtected ? " and skipped (not in manifest)" : " (kept, \"protected\": true — re-run with --skip-protected to exclude)"),
  );
}
if (errors.length) console.log(`  ${errors.length} error(s) logged to ${errorLog}`);
console.log(`\nNext: khb catalog   — extract text + build label batches so clustering isn't blind`);
console.log(`  (already know the bundles? skip it: write inbox/routing.yaml, then khb route)`);
