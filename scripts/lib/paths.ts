// Package-side paths. Importing this must never require a hub to exist — `bkr init`
// runs before there is one. Hub-side paths live in util.ts.
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";

/** Root of the installed @msareen/bkr package (NOT the user's hub). */
export const PKG = fileURLToPath(new URL("../..", import.meta.url));

export const TEMPLATE = join(PKG, ".bundle_template");
export const HUB_TEMPLATE = join(PKG, "templates", "hub");

/** Marker file that identifies a hub root; `bkr` walks up from cwd looking for it. */
export const MARKER = "bkr.json";

/**
 * Package-owned files copied into every hub by `bkr init` and refreshed by
 * `bkr upgrade`. These are the agent contract — the hub needs its own copies so an
 * agent opened on the hub folder can read them without knowing where bkr is installed.
 * Anything here is overwritten on upgrade, so users must not edit them.
 */
export const MANAGED = ["AGENT.md", "CLAUDE.md", "SPEC.md", "query.md", "ingest.md", "lint.md", "skills"];

export const version = (): string =>
  JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")).version ?? "0.0.0";
