import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { rawRel } from "../scripts/lib/util";

/**
 * `rawRel` decides how the ledger spells a directory inside `raw/`, which is what makes a
 * row's `raw` value and the file on disk the same string. A container's payloads nest one
 * level deeper than an ordinary source, and that is where `basename` alone used to lie.
 */
describe("rawRel", () => {
  const bundle = join("D:", "hub", "bundles", "nb");
  const rawRoot = join(bundle, "raw");

  test("an ordinary source directory is one level down", () => {
    expect(rawRel(join(rawRoot, "folder"), rawRoot)).toBe("raw/folder");
    expect(rawRel(join(rawRoot, "web"), rawRoot)).toBe("raw/web");
  });

  test("a container's payload directory keeps every segment", () => {
    expect(rawRel(join(rawRoot, "folder", "Work__Docker.one.files"), rawRoot)).toBe(
      "raw/folder/Work__Docker.one.files",
    );
  });

  test("the raw root itself is just raw/", () => {
    expect(rawRel(rawRoot, rawRoot)).toBe("raw");
  });

  test("with no root given it falls back to the directory's own name", () => {
    // The pre-existing callers (folder, files, web) pass no root and must not change.
    expect(rawRel(join(rawRoot, "folder"))).toBe("raw/folder");
    expect(rawRel(join(rawRoot, "folder", "nested"))).toBe("raw/nested");
  });
});
