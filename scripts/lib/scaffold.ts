// Scaffold a bundle from .bundle_template and register it in outer.index.md.
// Takes the hub path as an argument rather than importing util.ts: `khb init` calls this
// while creating a hub, before util.ts could resolve one.
import { cpSync, readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { TEMPLATE } from "./paths";

export const BUNDLE_NAME = /^[a-z0-9][a-z0-9-]*$/;

/** The bundle everything lands in when nothing says otherwise. See ingest.md phase 0. */
export const DEFAULT_PRIMARY = "main";

export const PRIMARY_SCOPE =
  "Everything not yet split into its own bundle — the default landing bundle";

export function scaffoldBundle(hub: string, name: string, scope = "TODO scope"): string {
  const dest = join(hub, "bundles", name);
  if (existsSync(dest)) throw new Error(`Bundle '${name}' already exists`);

  cpSync(TEMPLATE, dest, { recursive: true });

  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
  for (const f of walk(dest)) {
    const c = readFileSync(f, "utf8");
    if (c.includes("{{name}}")) writeFileSync(f, c.replaceAll("{{name}}", name));
  }

  registerBundle(hub, name, scope);
  return dest;
}

/** Append a row to the first table in outer.index.md. */
export function registerBundle(hub: string, name: string, scope: string, when = "TODO") {
  const outerPath = join(hub, "outer.index.md");
  const lines = readFileSync(outerPath, "utf8").split("\n");
  const row = `| [${name}](bundles/${name}/index.md) | ${scope} | ${when} |`;
  let lastTableRow = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i].startsWith("|")) lastTableRow = i;
  lines.splice(lastTableRow + 1, 0, row);
  writeFileSync(outerPath, lines.join("\n"));
}
