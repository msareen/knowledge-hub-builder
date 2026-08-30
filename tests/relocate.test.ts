// Pure string tests for the four interacting invariants in scripts/lib/relocate.ts:
// longest-match ordering, identity-shielding the new path, per-spelling mapping, and
// path-boundary lookahead. No filesystem — substituter() takes strings and returns strings.
import { describe, expect, test } from "bun:test";
import { sameLocation, substituter } from "../scripts/lib/relocate";

describe("substituter — per-spelling mapping", () => {
  test("native backslash spelling rewrites to the native spelling of the new path", () => {
    const substitute = substituter(["D:\\a\\old"], "D:\\a\\new");
    expect(substitute("see D:\\a\\old\\file.md here").text).toBe("see D:\\a\\new\\file.md here");
  });

  test("forward-slash spelling rewrites to the forward-slash spelling of the new path", () => {
    const substitute = substituter(["D:\\a\\old"], "D:\\a\\new");
    expect(substitute("see D:/a/old/file.md here").text).toBe("see D:/a/new/file.md here");
  });

  test("JSON-escaped spelling rewrites to the JSON-escaped spelling of the new path", () => {
    const substitute = substituter(["D:\\a\\old"], "D:\\a\\new");
    const result = substitute('{"path": "D:\\\\a\\\\old\\\\file.md"}');
    expect(result.text).toBe('{"path": "D:\\\\a\\\\new\\\\file.md"}');
    expect(result.count).toBe(1);
  });
});

describe("substituter — longest-first ordering", () => {
  test("the escaped form is consumed whole, not partly matched by the bare spelling", () => {
    const substitute = substituter(["D:\\a\\old"], "D:\\a\\new");
    // Bare spelling "D:\a\old" is a substring of the escaped "D:\\a\\old" — if the bare form
    // matched first, the escaped text would come out only half-rewritten.
    const result = substitute('"D:\\\\a\\\\old"');
    expect(result.text).toBe('"D:\\\\a\\\\new"');
  });
});

describe("substituter — path-boundary lookahead", () => {
  test("a sibling whose name merely starts the same way is left untouched", () => {
    const substitute = substituter(["D:\\a\\old"], "D:\\a\\new");
    const result = substitute("D:\\a\\older\\file.md");
    expect(result.text).toBe("D:\\a\\older\\file.md");
    expect(result.count).toBe(0);
  });

  test("every documented boundary character terminates a match", () => {
    const substitute = substituter(["D:\\a\\old"], "D:\\a\\new");
    const boundaries = ["\\", "/", '"', "'", " ", ",", ";", ":", ")", "]", "}", ""];
    for (const boundary of boundaries) {
      const result = substitute(`D:\\a\\old${boundary}`);
      expect(result.text).toBe(`D:\\a\\new${boundary}`);
    }
  });
});

describe("substituter — identity shielding", () => {
  test("hub pushed down (…\\kb → …\\kb\\hub): the move is not prepended twice", () => {
    const substitute = substituter(["D:\\kb"], "D:\\kb\\hub");
    // Every reference already correct in the moved location must not be rewritten again.
    const result = substitute("see D:\\kb\\hub\\bundles\\meta");
    expect(result.text).toBe("see D:\\kb\\hub\\bundles\\meta");
    expect(result.count).toBe(0);
  });

  test("hub pushed down: a second run over the output is a no-op (idempotence)", () => {
    const substitute = substituter(["D:\\kb"], "D:\\kb\\hub");
    const once = substitute("D:\\kb\\bundles\\meta");
    expect(once.text).toBe("D:\\kb\\hub\\bundles\\meta");
    const twice = substitute(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.count).toBe(0);
  });

  test("hub lifted out (…\\kb\\hub → …\\kb): old prefix rewritten, new path left alone", () => {
    const substitute = substituter(["D:\\kb\\hub"], "D:\\kb");
    const result = substitute("D:\\kb\\hub\\bundles\\meta and D:\\kb\\other");
    expect(result.text).toBe("D:\\kb\\bundles\\meta and D:\\kb\\other");
  });

  test("hub lifted out: a second run over the output is a no-op (idempotence)", () => {
    const substitute = substituter(["D:\\kb\\hub"], "D:\\kb");
    const once = substitute("D:\\kb\\hub\\bundles\\meta");
    const twice = substitute(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.count).toBe(0);
  });
});

describe("substituter — several froms", () => {
  test("a short-name spelling alongside the canonical one both rewrite, each in its own spelling", () => {
    const substitute = substituter(
      ["C:\\Users\\MANASV~1\\hub", "C:\\Users\\Manasvi Sareen\\hub"],
      "D:\\code\\hub",
    );
    const result = substitute(
      "old short: C:\\Users\\MANASV~1\\hub\\bundles, old long: C:\\Users\\Manasvi Sareen\\hub\\bundles",
    );
    expect(result.text).toBe(
      "old short: D:\\code\\hub\\bundles, old long: D:\\code\\hub\\bundles",
    );
    expect(result.count).toBe(2);
  });
});

describe("substituter — case sensitivity", () => {
  test("caseInsensitive: true matches a differently-cased reference and writes canonical casing", () => {
    const substitute = substituter(["D:\\a\\old"], "D:\\a\\new", { caseInsensitive: true });
    const result = substitute("D:\\A\\OLD\\file.md");
    expect(result.text).toBe("D:\\a\\new\\file.md");
    expect(result.count).toBe(1);
  });

  test("caseInsensitive: false (default) leaves a differently-cased reference alone", () => {
    const substitute = substituter(["D:\\a\\old"], "D:\\a\\new");
    const result = substitute("D:\\A\\OLD\\file.md");
    expect(result.text).toBe("D:\\A\\OLD\\file.md");
    expect(result.count).toBe(0);
  });
});

describe("sameLocation", () => {
  test("differs only by trailing slash is the same location", () => {
    expect(sameLocation("D:\\a\\hub\\", "D:\\a\\hub")).toBe(true);
  });

  test("does not normalize separator flavour — only a trailing separator is stripped", () => {
    // sameLocation only lowercases (on win32) and strips a trailing slash/backslash; it does
    // not convert "/" to "\" throughout, so a fully forward-slashed path is NOT considered
    // the same location as its backslashed twin unless every separator already matches.
    expect(sameLocation("D:/a/hub", "D:\\a\\hub")).toBe(false);
    expect(sameLocation("D:\\a\\hub/", "D:\\a\\hub")).toBe(true);
  });

  test("differs only by casing is the same location on Windows", () => {
    if (process.platform === "win32") {
      expect(sameLocation("D:\\A\\HUB", "D:\\a\\hub")).toBe(true);
    }
  });

  test("genuinely different paths are not the same location", () => {
    expect(sameLocation("D:\\a\\hub", "D:\\a\\other")).toBe(false);
  });
});
