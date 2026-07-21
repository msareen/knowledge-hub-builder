// A bundle read as a graph: concept docs (front matter) + the links between them.
//
// The graph is what makes a late split safe. A concept doc is never self-contained — it
// links to the docs that give it meaning, and those link on in turn. So the unit that can
// move to a new bundle is not a doc, and not even a tag: it is a **link-connected
// component**. Move a whole component and no link is broken by construction; move less
// than one and you have cut edges that `refs.md` must absorb (lint L6).
import { readdirSync, statSync } from "node:fs";
import { relative, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import { BUNDLES, read, mdLinks, join, existsSync } from "./util";

export const RESERVED = ["index.md", "log.md", "refs.md"];

export type Doc = {
  path: string; // bundle-relative
  type?: string;
  title?: string;
  description?: string;
  resource?: string;
  tags: string[];
  timestamp?: string;
  derived_from: string[];
  links: string[]; // in-bundle concept docs this one points at (resolved, existing)
  indexed_in: string[]; // index files that route to it
};

export type TagStat = { docs: string[]; types: string[]; co: Map<string, number> };

export type BundleGraph = {
  bundle: string;
  dir: string;
  docs: Map<string, Doc>;
  /** Link-connected groups, largest first. The atoms of any split. */
  components: string[][];
  tags: Map<string, TagStat>;
};

const stripComments = (md: string) => md.replace(/<!--[\s\S]*?-->/g, "");

/** Every .md under the bundle except raw/ and the reserved names. */
export function walkConcepts(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "raw" ? [] : walkConcepts(p, base);
    if (!f.endsWith(".md") || RESERVED.includes(f)) return [];
    return [relative(base, p).replaceAll("\\", "/")];
  });
}

/**
 * Resolve a link or `derived_from` entry, written from `from`, to a bundle-relative path.
 * Returns null for external targets. Shared by lint and the split machinery so "what a
 * link points at" has exactly one definition.
 */
export function makeResolver(dir: string) {
  return (from: string, target: string): string | null => {
    const t = target.split("#")[0].trim();
    if (!t || /^(https?:|mailto:)/.test(t)) return null;
    if (t.startsWith("/")) return t.slice(1);
    const rel = relative(dir, join(dir, dirname(from), t)).replaceAll("\\", "/");
    // Front matter conventionally writes paths from the bundle root; prose links are
    // relative to the doc. Accept either, preferring whichever exists.
    if (!existsSync(join(dir, rel)) && existsSync(join(dir, t))) return t;
    return rel;
  };
}

/** Index files (bundle-relative) → the concept paths they route to. */
export function indexTargets(dir: string): Map<string, string[]> {
  const resolve = makeResolver(dir);
  const out = new Map<string, string[]>();
  const walkIdx = (d: string): string[] =>
    readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      if (statSync(p).isDirectory()) return f === "raw" ? [] : walkIdx(p);
      return f === "index.md" ? [relative(dir, p).replaceAll("\\", "/")] : [];
    });
  for (const idx of walkIdx(dir)) {
    const targets: string[] = [];
    for (const l of mdLinks(stripComments(read(join(dir, idx))))) {
      const r = resolve(idx, l.target);
      if (r) targets.push(r);
    }
    out.set(idx, targets);
  }
  return out;
}

export function loadBundle(bundle: string): BundleGraph {
  const dir = join(BUNDLES, bundle);
  if (!existsSync(dir)) {
    console.error(`No such bundle: ${bundle}`);
    process.exit(1);
  }
  const resolve = makeResolver(dir);
  const paths = walkConcepts(dir);
  const known = new Set(paths);
  const docs = new Map<string, Doc>();

  for (const p of paths) {
    const body = read(join(dir, p));
    const rawFm = body.match(/^---\n([\s\S]*?)\n---/)?.[1];
    let fm: any = {};
    if (rawFm) try { fm = parseYaml(rawFm) ?? {}; } catch { fm = {}; }

    const list = (v: unknown): string[] =>
      v == null ? [] : (Array.isArray(v) ? v : [v]).map(String).filter(Boolean);

    const links = new Set<string>();
    for (const l of mdLinks(stripComments(body))) {
      const r = resolve(p, l.target);
      if (r && r !== p && known.has(r)) links.add(r);
    }
    // derived_from is a real dependency: a synthesis without its sources is unreadable.
    for (const d of list(fm.derived_from)) {
      const r = resolve(p, d);
      if (r && r !== p && known.has(r)) links.add(r);
    }

    docs.set(p, {
      path: p,
      type: fm.type ? String(fm.type) : undefined,
      title: fm.title ? String(fm.title) : undefined,
      description: fm.description ? String(fm.description) : undefined,
      resource: fm.resource ? String(fm.resource) : undefined,
      tags: list(fm.tags),
      timestamp: fm.timestamp ? String(fm.timestamp) : undefined,
      derived_from: list(fm.derived_from),
      links: [...links],
      indexed_in: [],
    });
  }

  for (const [idx, targets] of indexTargets(dir))
    for (const t of targets) docs.get(t)?.indexed_in.push(idx);

  return { bundle, dir, docs, components: componentsOf(docs), tags: tagStats(docs) };
}

/** Undirected connected components over the link graph. */
export function componentsOf(docs: Map<string, Doc>): string[][] {
  const adj = new Map<string, Set<string>>();
  for (const p of docs.keys()) adj.set(p, new Set());
  for (const [p, d] of docs)
    for (const l of d.links) {
      adj.get(p)!.add(l);
      adj.get(l)?.add(p);
    }

  const seen = new Set<string>();
  const out: string[][] = [];
  for (const p of docs.keys()) {
    if (seen.has(p)) continue;
    const group: string[] = [];
    const stack = [p];
    seen.add(p);
    while (stack.length) {
      const cur = stack.pop()!;
      group.push(cur);
      for (const n of adj.get(cur) ?? []) if (!seen.has(n)) { seen.add(n); stack.push(n); }
    }
    out.push(group.sort());
  }
  return out.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

export function tagStats(docs: Map<string, Doc>): Map<string, TagStat> {
  const out = new Map<string, TagStat>();
  for (const d of docs.values())
    for (const t of d.tags) {
      const st = out.get(t) ?? { docs: [], types: [], co: new Map() };
      st.docs.push(d.path);
      if (d.type && !st.types.includes(d.type)) st.types.push(d.type);
      for (const o of d.tags) if (o !== t) st.co.set(o, (st.co.get(o) ?? 0) + 1);
      out.set(t, st);
    }
  return out;
}

/**
 * Expand a seed set to whole components — "links of links". This is the set that can move
 * without breaking a link; `seeds` alone cannot, unless it happens to already be closed.
 */
export function linkClosure(g: BundleGraph, seeds: Iterable<string>): { closure: string[]; dragged: string[] } {
  const seed = new Set(seeds);
  const closure = new Set<string>();
  for (const comp of g.components) if (comp.some((p) => seed.has(p))) for (const p of comp) closure.add(p);
  return {
    closure: [...closure].sort(),
    dragged: [...closure].filter((p) => !seed.has(p)).sort(),
  };
}
