import { describe, expect, test } from "bun:test";
import {
  EFFORTS,
  EFFORT_PROFILES,
  countText,
  estimateTokens,
  humanBytes,
  millions,
  parsePrice,
  priceOf,
  project,
  summarize,
  type CountedFile,
} from "../scripts/lib/tokens";

/**
 * The estimate is the number someone decides a spend on, so the properties that matter are
 * the ones that stop it lying: it never comes in under either rule of thumb, it never
 * reports a real corpus as free, and effort levels stay ordered.
 */
describe("estimateTokens", () => {
  test("takes the larger of the two rules of thumb", () => {
    // Prose: ~5.5 chars/word, so chars÷4 wins.
    expect(estimateTokens(1100, 200)).toBe(275);
    // Dense text — long unbroken strings, tables, OCR runs — where words×1.33 is the bigger.
    expect(estimateTokens(400, 500)).toBe(665);
  });

  test("empty text costs nothing", () => {
    expect(estimateTokens(0, 0)).toBe(0);
  });
});

describe("countText", () => {
  test("counts words, characters and tokens together", () => {
    const counted = countText("alpha beta gamma");
    expect(counted.words).toBe(3);
    expect(counted.chars).toBe(16);
    expect(counted.tokens).toBe(estimateTokens(16, 3));
  });

  test("whitespace-only content is zero words, not one", () => {
    expect(countText("   \n\t ").words).toBe(0);
  });

  test("newlines and runs of spaces do not inflate the word count", () => {
    expect(countText("one\n\ntwo    three\tfour").words).toBe(4);
  });
});

const corpusOf = (...tokenCounts: number[]) =>
  summarize(
    tokenCounts.map(
      (tokens, index): CountedFile => ({
        path: `raw/folder/f${index}.md`,
        bytes: tokens * 4,
        chars: tokens * 4,
        words: tokens,
        tokens,
      }),
    ),
  );

describe("summarize", () => {
  test("totals every column across the files", () => {
    const corpus = corpusOf(100, 250, 50);
    expect(corpus.files.length).toBe(3);
    expect(corpus.tokens).toBe(400);
    expect(corpus.words).toBe(400);
    expect(corpus.bytes).toBe(1600);
  });

  test("an empty worklist summarizes to zero rather than NaN", () => {
    const corpus = summarize([]);
    expect(corpus.tokens).toBe(0);
    expect(corpus.bytes).toBe(0);
  });
});

describe("project", () => {
  test("input always exceeds the raw material — the prompt and the re-reads are billed too", () => {
    const corpus = corpusOf(1000, 1000);
    for (const effort of EFFORTS) expect(project(corpus, 600, effort).input).toBeGreaterThan(corpus.tokens);
  });

  test("the per-file prompt is charged once per file, not once per run", () => {
    const one = project(corpusOf(1000), 600, "medium");
    const four = project(corpusOf(250, 250, 250, 250), 600, "medium");
    // Same material, four times the prompts — so four times the overhead, resent as the pass runs.
    expect(four.input - one.input).toBe(Math.round(3 * 600 * EFFORT_PROFILES.medium.reread));
  });

  test("effort levels stay ordered — more effort is never cheaper", () => {
    const corpus = corpusOf(5000);
    const [low, medium, high] = EFFORTS.map((effort) => project(corpus, 600, effort));
    expect(low.total).toBeLessThan(medium.total);
    expect(medium.total).toBeLessThan(high.total);
  });

  test("output is a distillation of the material only, never of the prompt overhead", () => {
    const corpus = corpusOf(10_000);
    const cheap = project(corpus, 0, "medium");
    const expensive = project(corpus, 5_000, "medium");
    expect(expensive.input).toBeGreaterThan(cheap.input);
    expect(expensive.output).toBe(cheap.output);
    expect(cheap.output).toBeLessThan(corpus.tokens); // cataloging distils
  });

  test("total is the two halves and nothing else", () => {
    const projection = project(corpusOf(1234, 5678), 650, "high");
    expect(projection.total).toBe(projection.input + projection.output);
  });

  test("an empty corpus projects to nothing", () => {
    expect(project(summarize([]), 600, "high")).toMatchObject({ input: 0, output: 0, total: 0 });
  });
});

describe("millions", () => {
  test("the headline unit is millions, to two decimals", () => {
    expect(millions(8_310_000)).toBe("8.31M");
    expect(millions(1_000_000)).toBe("1.00M");
  });

  test("a small corpus keeps enough decimals not to read as free", () => {
    expect(millions(32_000)).toBe("0.032M");
    expect(millions(4_100)).toBe("0.0041M");
    expect(millions(0)).toBe("0M");
  });
});

describe("parsePrice", () => {
  test("reads input/output rates in dollars per million", () => {
    expect(parsePrice("3/15")).toEqual({ input: 3, output: 15 });
    expect(parsePrice("0.25/1.25")).toEqual({ input: 0.25, output: 1.25 });
  });

  test("rejects anything that is not two non-negative numbers", () => {
    for (const spec of ["3", "3/15/75", "abc/15", "3/", "-3/15", ""]) expect(parsePrice(spec)).toBeUndefined();
  });
});

describe("priceOf", () => {
  test("charges each half at its own rate", () => {
    const projection = { effort: "medium" as const, input: 2_000_000, output: 500_000, total: 2_500_000 };
    expect(priceOf(projection, 3, 15)).toBeCloseTo(2 * 3 + 0.5 * 15, 6);
  });
});

describe("humanBytes", () => {
  test("scales to the unit that reads", () => {
    expect(humanBytes(0)).toBe("0 B");
    expect(humanBytes(512)).toBe("512 B");
    expect(humanBytes(2048)).toBe("2.0 KB");
    expect(humanBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
