// Bounded concurrency for the ingest walks.
//
// Ingest used to await each file's whole pipeline — hash, extract, OCR, write — before
// starting the next file's hash, so a corpus was as slow as the sum of its files. The
// expensive stages do not actually occupy the main thread while they run: tesseract.js
// recognizes in a `worker_threads` Worker, and whisper/pdftotext/pandoc are spawned
// binaries. Running several files at once therefore buys real parallelism without khb
// having to fork a process per file and reconcile ledgers afterwards.
//
// The limit is the point. Unbounded `Promise.all` over thousands of files would spawn a
// tesseract worker and its language data per file at once, and thrash worse than running
// them one at a time.

/**
 * Run `worker` over every item, at most `limit` at a time, preserving nothing about order.
 *
 * Lanes pull from one shared cursor rather than being handed a fixed slice each: a slice
 * split evenly by count is not split evenly by cost, and one lane holding all the scanned
 * PDFs would still be running long after the others had finished their text files.
 *
 * The first failure stops lanes from picking up new work and is rethrown once every lane
 * has settled. Callers whose per-item work already degrades internally (`acquireFile`
 * records a pending row rather than throwing) will never see it.
 */
export async function mapPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failure: unknown;
  const lane = async () => {
    while (next < items.length && failure === undefined) {
      const index = next++;
      try {
        await worker(items[index], index);
      } catch (error) {
        failure ??= error;
      }
    }
  };
  const lanes = Math.max(1, Math.min(Math.trunc(limit) || 1, items.length));
  await Promise.all(Array.from({ length: lanes }, lane));
  if (failure !== undefined) throw failure;
}
