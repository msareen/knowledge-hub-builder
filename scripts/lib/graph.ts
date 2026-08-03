// Graph data for `khb visualize` — bundles + refs (outer graph) and, per bundle, concept
// docs + the markdown links between them (inner graph). Read-only: this never writes
// anything, so the live server's `/api/graph` and `/api/file` can call it freely.
import { readdirSync, statSync } from "node:fs";
import { dirname, relative, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { HUB, BUNDLES, listBundles, read, mdLinks, join, existsSync } from "./util";

export type ConceptNode = {
  id: string;
  title: string;
  type: string;
  bytes: number;
  /** Top-level subdirectory the concept lives in ("" for bundle-root files). The inner
   *  graph clusters by this, so nesting deeper than one level collapses into its parent —
   *  a handful of labelled regions reads better than one region per directory. */
  folder: string;
};
export type ConceptEdge = { from: string; to: string };
export type BundleGraph = { concepts: ConceptNode[]; edges: ConceptEdge[] };
export type BundleNode = { id: string; notes: number; scope: string };
export type BundleEdge = { from: string; to: string; why: string };
export type GraphData = {
  builtAt: string;
  bundles: BundleNode[];
  bundleEdges: BundleEdge[];
  bundleGraphs: Record<string, BundleGraph>;
};

const RESERVED = ["index.md", "log.md", "refs.md"];

/** All files under dir (bundle-relative, posix separators), skipping raw/. */
function walk(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "raw" ? [] : walk(p, base);
    return [relative(base, p).replaceAll("\\", "/")];
  });
}

function frontmatter(body: string): Record<string, unknown> {
  const fm = body.match(/^---\n([\s\S]*?)\n---/)?.[1];
  if (fm === undefined) return {};
  try {
    return (parseYaml(fm) ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function buildGraphData(): GraphData {
  const bundles = listBundles();
  const bundleNodes: BundleNode[] = [];
  const bundleEdges: BundleEdge[] = [];
  const bundleGraphs: Record<string, BundleGraph> = {};

  const scopes: Record<string, string> = {};
  const outerIndexPath = join(HUB, "outer.index.md");
  if (existsSync(outerIndexPath)) {
    for (const line of read(outerIndexPath).split("\n")) {
      const m = line.match(/^\|\s*\[([a-z0-9-]+)\][^|]*\|\s*([^|]+)\|/);
      if (m) scopes[m[1]] = m[2].trim();
    }
  }

  for (const b of bundles) {
    const dir = join(BUNDLES, b);
    const files = existsSync(dir) ? walk(dir) : [];
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    const concepts = mdFiles.filter((f) => !RESERVED.includes(f.split("/").pop()!));

    const conceptNodes: ConceptNode[] = [];
    const conceptEdges: ConceptEdge[] = [];
    for (const c of concepts) {
      const body = read(join(dir, c));
      const fm = frontmatter(body);
      conceptNodes.push({
        id: c,
        title: typeof fm.title === "string" && fm.title ? fm.title : c,
        type: typeof fm.type === "string" ? fm.type : "",
        bytes: body.length,
        folder: c.includes("/") ? c.split("/")[0] : "",
      });
      for (const l of mdLinks(body)) {
        if (l.target.startsWith("http") || !l.target.endsWith(".md")) continue;
        const target = l.target.startsWith("/")
          ? l.target.slice(1)
          : relative(dir, join(dir, dirname(c), l.target)).replaceAll("\\", "/");
        if (concepts.includes(target)) conceptEdges.push({ from: c, to: target });
      }
    }
    bundleGraphs[b] = { concepts: conceptNodes, edges: conceptEdges };

    bundleNodes.push({ id: b, notes: concepts.length, scope: scopes[b] ?? "" });
    const refsPath = join(dir, "refs.md");
    if (existsSync(refsPath)) {
      for (const line of read(refsPath).split("\n")) {
        const m = line.match(/^\|\s*\[?([a-z0-9][a-z0-9-]*)\]?[^|]*\|\s*([^|]*)\|/);
        if (m && !["bundle", "---"].includes(m[1]) && bundles.includes(m[1]))
          bundleEdges.push({ from: b, to: m[1], why: m[2].trim() });
      }
    }
  }

  return { builtAt: new Date().toISOString(), bundles: bundleNodes, bundleEdges, bundleGraphs };
}

/** A single concept's body, for the graph page's on-demand file panel. Guards against
 *  path traversal since `path` comes off a request query string. */
export function readConceptFile(bundle: string, path: string): string | undefined {
  if (!listBundles().includes(bundle)) return undefined;
  const dir = join(BUNDLES, bundle);
  const full = join(dir, path);
  if (full !== dir && !full.startsWith(dir + sep)) return undefined;
  if (!existsSync(full)) return undefined;
  return read(full);
}
