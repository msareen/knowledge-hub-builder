import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  adopt,
  identify,
  isFresh,
  readLedger,
  record,
  writeLedger,
  type Entry,
} from "../scripts/lib/ledger";
import { makeTmpBundle, writeRawFile } from "./helpers/tmphub";

let cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.forEach((fn) => fn());
  cleanups = [];
});

function bundle() {
  const b = makeTmpBundle();
  cleanups.push(b.cleanup);
  return b;
}

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    source: "/src/one.md",
    sha256: "a".repeat(64),
    fetched: "2026-08-30T00:00:00.000Z",
    raw: "one.md",
    curated: "",
    ...overrides,
  };
}

describe("readLedger / writeLedger round trip", () => {
  test("skips header and separator rows, unwraps backticks", () => {
    const { dir } = bundle();
    const entries = new Map<string, Entry>();
    entries.set("/src/one.md", entry());
    writeLedger(dir, entries, "test-bundle");
    const back = readLedger(dir);
    expect(back.size).toBe(1);
    // sha256 is always written truncated to 12 chars — see the dedicated test below.
    expect(back.get("/src/one.md")).toEqual(entry({ sha256: entry().sha256.slice(0, 12) }));
  });

  test("a source containing a pipe is backslash-escaped in the written table", () => {
    const { dir } = bundle();
    const entries = new Map<string, Entry>();
    entries.set("/src/a|b.md", entry({ source: "/src/a|b.md" }));
    writeLedger(dir, entries, "test-bundle");
    const text = readFileSync(join(dir, "log.md"), "utf8");
    // wrap() escapes "|" for markdown table rendering. Note: readLedger's line.split("|")
    // does not honor this escape on the way back in, so a source containing "|" does not
    // actually round-trip through readLedger — a pre-existing gap, not something this test
    // suite is asked to fix.
    expect(text).toContain("/src/a\\|b.md");
  });

  test("sha256 is written truncated to 12 characters but is prefix-comparable", () => {
    const { dir } = bundle();
    const entries = new Map<string, Entry>();
    const fullHash = "b".repeat(64);
    entries.set("/src/one.md", entry({ sha256: fullHash }));
    writeLedger(dir, entries, "test-bundle");
    const raw = readLedger(dir).get("/src/one.md")!;
    expect(raw.sha256).toBe(fullHash.slice(0, 12));
  });

  test("prose preamble above the table is preserved on rewrite", () => {
    const { dir } = bundle();
    const preamble = "# custom-bundle — ingest log\n\nSome hand-written note.";
    writeFileSync(join(dir, "log.md"), preamble + "\n\n| source | sha256 | fetched | raw | curated |\n|---|---|---|---|---|\n");
    const entries = readLedger(dir);
    entries.set("/src/one.md", entry());
    writeLedger(dir, entries, "custom-bundle");
    const text = readFileSync(join(dir, "log.md"), "utf8");
    expect(text).toContain("Some hand-written note.");
  });

  test("rows are sorted by source", () => {
    const { dir } = bundle();
    const entries = new Map<string, Entry>();
    entries.set("/src/z.md", entry({ source: "/src/z.md" }));
    entries.set("/src/a.md", entry({ source: "/src/a.md" }));
    writeLedger(dir, entries, "test-bundle");
    const text = readFileSync(join(dir, "log.md"), "utf8");
    const rowLines = text.split("\n").filter((l: string) => l.startsWith("|") && l.includes("/src/"));
    expect(rowLines[0]).toContain("/src/a.md");
    expect(rowLines[1]).toContain("/src/z.md");
  });
});

describe("record", () => {
  test("preserves an existing curated value on upsert", () => {
    const entries = new Map<string, Entry>();
    entries.set("/src/one.md", entry({ curated: "bundles/x/concept.md" }));
    const merged = record(entries, {
      source: "/src/one.md",
      sha256: "c".repeat(64),
      fetched: "2026-08-30T01:00:00.000Z",
      raw: "one.md",
    });
    expect(merged.curated).toBe("bundles/x/concept.md");
  });

  test("a new source starts with empty curated", () => {
    const entries = new Map<string, Entry>();
    const merged = record(entries, {
      source: "/src/new.md",
      sha256: "d".repeat(64),
      fetched: "2026-08-30T01:00:00.000Z",
      raw: "new.md",
    });
    expect(merged.curated).toBe("");
  });
});

describe("isFresh", () => {
  test("true only when the hash prefix matches and the raw/ file is still on disk", () => {
    const { dir, rawDir } = bundle();
    writeRawFile(dir, join("raw", "one.md"));
    const entries = new Map<string, Entry>();
    const hash = "e".repeat(64);
    entries.set("/src/one.md", entry({ sha256: hash.slice(0, 12), raw: "raw/one.md" }));
    expect(isFresh(entries, dir, "/src/one.md", hash)).toBe(true);
  });

  test("false when raw is empty", () => {
    const { dir } = bundle();
    const entries = new Map<string, Entry>();
    const hash = "e".repeat(64);
    entries.set("/src/one.md", entry({ sha256: hash.slice(0, 12), raw: "" }));
    expect(isFresh(entries, dir, "/src/one.md", hash)).toBe(false);
  });

  test("false when the raw/ file was deleted", () => {
    const { dir } = bundle();
    const entries = new Map<string, Entry>();
    const hash = "e".repeat(64);
    entries.set("/src/one.md", entry({ sha256: hash.slice(0, 12), raw: "raw/gone.md" }));
    expect(isFresh(entries, dir, "/src/one.md", hash)).toBe(false);
  });

  test("false when the hash prefix does not match", () => {
    const { dir } = bundle();
    writeRawFile(dir, join("raw", "one.md"));
    const entries = new Map<string, Entry>();
    entries.set("/src/one.md", entry({ sha256: "f".repeat(12), raw: "raw/one.md" }));
    expect(isFresh(entries, dir, "/src/one.md", "e".repeat(64))).toBe(false);
  });
});

describe("identify", () => {
  function setupSourceFile(root: string, relPath: string) {
    const full = join(root, relPath);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, "content");
    return full;
  }

  test("a known path is always 'new' (freshness, not identity)", () => {
    const { dir } = bundle();
    const entries = new Map<string, Entry>();
    entries.set("/src/one.md", entry());
    expect(identify(entries, dir, "/src/one.md", "a".repeat(64))).toEqual({ kind: "new" });
  });

  test("no twins is 'new'", () => {
    const { dir } = bundle();
    const entries = new Map<string, Entry>();
    expect(identify(entries, dir, "/src/never-seen.md", "a".repeat(64))).toEqual({ kind: "new" });
  });

  test("a single twin whose old path no longer exists is 'moved'", () => {
    const { dir } = bundle();
    writeRawFile(dir, join("raw", "one.md"));
    const oldSourcePath = join(dir, "old-src", "one.md"); // deliberately never created
    const entries = new Map<string, Entry>();
    entries.set(oldSourcePath, entry({ source: oldSourcePath, sha256: "a".repeat(12), raw: "raw/one.md" }));
    const result = identify(entries, dir, "/new-src/one.md", "a".repeat(64));
    expect(result.kind).toBe("moved");
    if (result.kind === "moved") expect(result.from.source).toBe(oldSourcePath);
  });

  test("a twin still on disk is 'copy'", () => {
    const { dir } = bundle();
    writeRawFile(dir, join("raw", "one.md"));
    const oldSourcePath = setupSourceFile(dir, join("old-src", "one.md"));
    const entries = new Map<string, Entry>();
    entries.set(oldSourcePath, entry({ source: oldSourcePath, sha256: "a".repeat(12), raw: "raw/one.md" }));
    const result = identify(entries, dir, join(dir, "new-src", "one.md"), "a".repeat(64));
    expect(result.kind).toBe("copy");
    if (result.kind === "copy") expect(result.twin.source).toBe(oldSourcePath);
  });

  test("two orphaned twins is 'ambiguous'", () => {
    const { dir } = bundle();
    writeRawFile(dir, join("raw", "one.md"));
    writeRawFile(dir, join("raw", "two.md"));
    const oldA = join(dir, "old-src", "a.md");
    const oldB = join(dir, "old-src", "b.md");
    const entries = new Map<string, Entry>();
    entries.set(oldA, entry({ source: oldA, sha256: "a".repeat(12), raw: "raw/one.md" }));
    entries.set(oldB, entry({ source: oldB, sha256: "a".repeat(12), raw: "raw/two.md" }));
    const result = identify(entries, dir, "/new-src/x.md", "a".repeat(64));
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") expect(result.twins.length).toBe(2);
  });

  test("a URL twin is never a move/copy candidate", () => {
    const { dir } = bundle();
    writeRawFile(dir, join("raw", "one.md"));
    const entries = new Map<string, Entry>();
    entries.set("https://example.com/doc", entry({ source: "https://example.com/doc", sha256: "a".repeat(12), raw: "raw/one.md" }));
    expect(identify(entries, dir, "/new-src/one.md", "a".repeat(64))).toEqual({ kind: "new" });
  });

  test("a twin whose raw/ file is missing is never a candidate", () => {
    const { dir } = bundle();
    const oldSourcePath = join(dir, "old-src", "one.md");
    const entries = new Map<string, Entry>();
    entries.set(oldSourcePath, entry({ source: oldSourcePath, sha256: "a".repeat(12), raw: "raw/missing.md" }));
    expect(identify(entries, dir, "/new-src/one.md", "a".repeat(64))).toEqual({ kind: "new" });
  });
});

describe("adopt", () => {
  test("re-points the row, keeping raw and curated, and drops the old key", () => {
    const entries = new Map<string, Entry>();
    const oldEntry = entry({ source: "/old/one.md", raw: "raw/one.md", curated: "bundles/x/concept.md" });
    entries.set("/old/one.md", oldEntry);
    const moved = adopt(entries, oldEntry, "/new/one.md");
    expect(entries.has("/old/one.md")).toBe(false);
    expect(entries.get("/new/one.md")).toEqual(moved);
    expect(moved.raw).toBe("raw/one.md");
    expect(moved.curated).toBe("bundles/x/concept.md");
    expect(moved.source).toBe("/new/one.md");
  });
});
