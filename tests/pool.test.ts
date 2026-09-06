import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mapPool } from "../scripts/lib/pool";
import { rawNameFor } from "../scripts/lib/util";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The pool is what turns ingest from one file at a time into several, so the properties that
 * matter are: everything runs, never more than `limit` at once, and a lane that finishes
 * early picks up the next item rather than idling.
 */
describe("mapPool", () => {
  test("runs every item exactly once", async () => {
    const items = Array.from({ length: 25 }, (_, i) => i);
    const seen: number[] = [];
    await mapPool(items, 4, async (item) => {
      await sleep(1);
      seen.push(item);
    });
    expect(seen.sort((a, b) => a - b)).toEqual(items);
  });

  test("never exceeds the limit, and actually uses it", async () => {
    let running = 0;
    let peak = 0;
    await mapPool(Array.from({ length: 20 }, (_, i) => i), 5, async () => {
      running++;
      peak = Math.max(peak, running);
      await sleep(5);
      running--;
    });
    expect(peak).toBe(5);
  });

  test("a limit above the item count is clamped, not spun up empty", async () => {
    let peak = 0;
    let running = 0;
    await mapPool([1, 2], 10, async () => {
      running++;
      peak = Math.max(peak, running);
      await sleep(2);
      running--;
    });
    expect(peak).toBe(2);
  });

  test("limit 1 is strictly sequential — the escape hatch for reading a run", async () => {
    const order: string[] = [];
    await mapPool([30, 1, 1], 1, async (ms, index) => {
      order.push(`start${index}`);
      await sleep(ms);
      order.push(`end${index}`);
    });
    // Nothing starts before the previous one ends, however slow the previous one was.
    expect(order).toEqual(["start0", "end0", "start1", "end1", "start2", "end2"]);
  });

  test("an empty list is a no-op rather than a hang", async () => {
    let calls = 0;
    await mapPool([], 4, async () => { calls++; });
    expect(calls).toBe(0);
  });

  test("the first failure is rethrown and stops new work being picked up", async () => {
    const started: number[] = [];
    const run = mapPool(Array.from({ length: 50 }, (_, i) => i), 2, async (item) => {
      started.push(item);
      await sleep(1);
      if (item === 1) throw new Error("boom");
    });
    await expect(run).rejects.toThrow("boom");
    // The lanes stop pulling, so the tail of the list is never reached.
    expect(started.length).toBeLessThan(50);
  });
});

/**
 * A raw name is chosen before extraction and written after it — minutes later for a scan.
 * With files in flight together, two sources that want the same name must not both get it,
 * or one raw file ends up with two ledger rows pointing at it.
 */
describe("rawNameFor under concurrency", () => {
  test("two unwritten sources wanting one name get different names", () => {
    const dir = mkdtempSync(join(tmpdir(), "khb-raw-"));
    try {
      const first = rawNameFor(dir, "report.md", "C:/a/report.pdf", []);
      // Nothing has been written yet — exactly the window a parallel run opens.
      const second = rawNameFor(dir, "report.md", "C:/b/report.pdf", []);
      expect(first).toBe("report.md");
      expect(second).not.toBe(first);
      expect(second.startsWith("report--")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a source re-acquiring its own name keeps it", () => {
    const dir = mkdtempSync(join(tmpdir(), "khb-raw-"));
    try {
      const source = "C:/a/notes.pdf";
      const entries = [{ source, raw: `${["raw", "files"].join("/")}/notes.md` }];
      const name = rawNameFor(join(dir, "files"), "notes.md", source, entries, dir);
      expect(name).toBe("notes.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
