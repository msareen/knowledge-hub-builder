// bun scripts/route.ts [routing.yaml] — apply phase-0 routing decisions.
// Reads inbox/routing.yaml (written by the agent after reading the manifest) and merges
// each bundle's assigned paths into its sources.yaml as a `files` source. Copies nothing:
// acquisition still happens per-bundle via `khb ingest <bundle>`.
import { parse, stringify } from "yaml";
import { readFileSync, writeFileSync } from "node:fs";
import { INBOX, BUNDLES, listBundles, join, existsSync } from "./lib/util";

type Routing = { routes?: Record<string, string[]>; unrouted?: string[] };

const path = process.argv[2] ?? join(INBOX, "routing.yaml");
if (!existsSync(path)) {
  console.error(`No routing file: ${path}`);
  console.error(`Write one after triage:\n\nroutes:\n  <bundle>:\n    - D:/path/to/file.pdf\nunrouted: []`);
  process.exit(1);
}

const routing = (parse(readFileSync(path, "utf8")) ?? {}) as Routing;
const routes = routing.routes ?? {};
const known = listBundles();

const missing = Object.keys(routes).filter((b) => !known.includes(b));
if (missing.length) {
  console.error(`Unknown bundle(s): ${missing.join(", ")}`);
  console.error(`Create them first: ${missing.map((b) => `khb new-bundle ${b} "<scope>"`).join(" && ")}`);
  process.exit(1);
}

for (const [bundle, paths] of Object.entries(routes)) {
  const sp = join(BUNDLES, bundle, "sources.yaml");
  const text = readFileSync(sp, "utf8");
  // Preserve the leading comment block; the rest is regenerated from parsed data.
  const preamble = text.split("\n").filter((l) => l.startsWith("#")).join("\n");
  const cfg = (parse(text) ?? {}) as { sources?: any[] };
  const sources = cfg.sources ?? [];

  let filesSource = sources.find((s) => s?.type === "files");
  if (!filesSource) {
    filesSource = { type: "files", paths: [] };
    sources.push(filesSource);
  }
  const before = filesSource.paths.length;
  filesSource.paths = [...new Set([...filesSource.paths, ...paths.map((p) => p.replaceAll("\\", "/"))])];

  writeFileSync(sp, preamble + "\n" + stringify({ ...cfg, sources }));
  console.log(`${bundle}: +${filesSource.paths.length - before} path(s) (${filesSource.paths.length} total)`);
}

const unrouted = routing.unrouted?.length ?? 0;
if (unrouted) console.log(`\n${unrouted} path(s) left unrouted — revisit or drop them.`);
console.log(`\nNext: ${Object.keys(routes).map((b) => `khb ingest ${b}`).join(" && ")}`);
