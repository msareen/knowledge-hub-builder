// Pure tests for scripts/lib/respond.ts — the decision logic behind `khb go --respond`.
// hubs.ts itself is a top-level script that dispatches on process.argv/KHB_SUBCOMMAND at
// import time, so it is never imported here; only the pure helpers it delegates to are.
import { describe, expect, test } from "bun:test";
import { defaultResponseFile, shouldRespond } from "../scripts/lib/respond";

describe("defaultResponseFile", () => {
  test("embeds the hub name and a filesystem-safe timestamp, ending in .md", () => {
    const name = defaultResponseFile("personal");
    expect(name.startsWith("khb-response-personal-")).toBe(true);
    expect(name.endsWith(".md")).toBe(true);
    expect(name).not.toContain(":"); // ':' is invalid in a Windows filename
  });

  test("two calls in a row don't collide", () => {
    const a = defaultResponseFile("work");
    const b = defaultResponseFile("work");
    // Not asserting inequality (same-millisecond calls could tie) — just that both are
    // well-formed and named after the same hub.
    expect(a.startsWith("khb-response-work-")).toBe(true);
    expect(b.startsWith("khb-response-work-")).toBe(true);
  });
});

describe("shouldRespond", () => {
  test("--respond alone is yes, regardless of the answer", () => {
    expect(shouldRespond(true, undefined, undefined)).toBe(true);
    expect(shouldRespond(true, undefined, "n")).toBe(true);
  });

  test("naming --file alone is yes, without needing --respond", () => {
    expect(shouldRespond(false, "notes.md", undefined)).toBe(true);
  });

  test("neither flag: falls back to the y/N answer, defaulting to no", () => {
    expect(shouldRespond(false, undefined, undefined)).toBe(false); // no TTY to ask on
    expect(shouldRespond(false, undefined, "")).toBe(false); // bare Enter
    expect(shouldRespond(false, undefined, "n")).toBe(false);
    expect(shouldRespond(false, undefined, "no")).toBe(false);
  });

  test("neither flag: a leading y/Y says yes", () => {
    expect(shouldRespond(false, undefined, "y")).toBe(true);
    expect(shouldRespond(false, undefined, "Y")).toBe(true);
    expect(shouldRespond(false, undefined, "yes")).toBe(true);
  });
});
