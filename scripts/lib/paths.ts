// Package-side paths. Importing this must never require a hub to exist — `khb init`
// runs before there is one. Hub-side paths live in util.ts.
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";

/** Root of the installed @msareen/khb package (NOT the user's hub). */
export const PKG = fileURLToPath(new URL("../..", import.meta.url));

export const TEMPLATE = join(PKG, ".bundle_template");
export const HUB_TEMPLATE = join(PKG, "templates", "hub");

/** Marker file that identifies a hub root; `khb` walks up from cwd looking for it. */
export const MARKER = "khb.json";

/**
 * Pre-rename marker, from when this was BKR. Hubs created then still carry it, and they
 * are the user's knowledge — the tool renames itself, not their folders — so both are
 * accepted and `khb upgrade` migrates the file in place.
 */
export const LEGACY_MARKER = "bkr.json";

export const MARKERS = [MARKER, LEGACY_MARKER];

/**
 * Package-owned files copied into every hub by `khb init` and refreshed by
 * `khb upgrade`. These are the agent contract — the hub needs its own copies so an
 * agent opened on the hub folder can read them without knowing where khb is installed.
 * Anything here is overwritten on upgrade, so users must not edit them.
 */
export const MANAGED = ["AGENT.md", "CLAUDE.md", "SPEC.md", "query.md", "ingest.md", "lint.md", "skills"];

export const version = (): string =>
  JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")).version ?? "0.0.0";
