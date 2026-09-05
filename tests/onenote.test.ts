import { describe, expect, test } from "bun:test";
import { oneNoteMarkdown, type OneNoteFile, type OneNoteSection } from "../scripts/lib/extract";

/** A file block as `pyscripts/onenote.py` emits one. */
function file(overrides: Partial<OneNoteFile> = {}): OneNoteFile {
  return {
    kind: "file",
    guid: "1f0d0a1e-0000-0000-0000-000000000000",
    name: "forecast.xlsx",
    ext: ".xlsx",
    bytes: 2_411_724,
    image: false,
    icon: false,
    revision: false,
    recovered: true,
    ...overrides,
  };
}

const page = (title: string, blocks: OneNoteSection["pages"][number]["blocks"] = [], level = 1) => ({
  title,
  level,
  blocks,
});

const text = (md: string) => ({ kind: "text" as const, md });

describe("oneNoteMarkdown", () => {
  test("the section is h1, its pages h2, in the order the parser gave them", () => {
    const md = oneNoteMarkdown({
      sectionName: "Tanay Therapy",
      pages: [page("Reports", [text("EEG on the 14th.")]), page("Vocab List", [text("said 'more' today")])],
    });
    expect(md).toBe(
      "# Tanay Therapy\n\n## Reports\n\nEEG on the 14th.\n\n## Vocab List\n\nsaid 'more' today",
    );
  });

  test("a subpage nests by its own PageLevel, and h6 is the floor", () => {
    const md = oneNoteMarkdown({
      sectionName: "Diary",
      pages: [page("2022 Week 42-43", [], 1), page("20 Oct 2022", [text("Met monkeys.")], 2), page("Deep", [], 9)],
    });
    expect(md).toBe("# Diary\n\n## 2022 Week 42-43\n\n### 20 Oct 2022\n\nMet monkeys.\n\n###### Deep");
  });

  test("falls back to the file's own name when the section declares none", () => {
    expect(oneNoteMarkdown({ pages: [page("Only page")] }, "Quick Notes")).toBe("# Quick Notes\n\n## Only page");
    expect(oneNoteMarkdown({ sectionName: "", pages: [] }, "")).toBe("");
  });

  test("tables and lists arrive as rendered markdown and pass through in place", () => {
    const table = { kind: "table" as const, md: "| a | b |\n| --- | --- |\n| 1 | 2 |" };
    const md = oneNoteMarkdown({ pages: [page("Costs", [text("Before:"), table, text("- one\n  - nested")])] });
    expect(md).toBe("## Costs\n\nBefore:\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n- one\n  - nested");
  });

  test("a creation timestamp is kept as a page's own line when the parser found one", () => {
    expect(oneNoteMarkdown({ pages: [{ ...page("Reports"), created: "2023-02-25 09:14:02" }] })).toBe(
      "## Reports\n\n_Created: 2023-02-25 09:14:02_",
    );
  });

  test("embedded files are named with a readable size, images labeled as images", () => {
    const md = oneNoteMarkdown({
      pages: [page("Reports", [file(), file({ name: "scan.jpg", ext: ".jpg", image: true, bytes: 348_160 })])],
    });
    expect(md).toBe(
      "## Reports\n\n_Embedded file: forecast.xlsx (2.3 MB)_\n\n_Image: scan.jpg (340 KB)_",
    );
  });

  test("an unpacked payload is linked, and an image is shown rather than described", () => {
    const md = oneNoteMarkdown({
      pages: [
        page("Reports", [
          file({ name: "EEG Tanay.pdf", ext: ".pdf", file: "EEG Tanay.pdf" }),
          file({ name: "scan.jpg", ext: ".jpg", image: true, bytes: 348_160, file: "scan.jpg" }),
        ]),
      ],
    });
    // The prefix is the placeholder the acquiring side rewrites; the target is URL-encoded.
    expect(md).toBe(
      "## Reports\n\n" +
        "_Embedded file: [EEG Tanay.pdf](khb-attachments/EEG%20Tanay.pdf) (2.3 MB)_\n\n" +
        "![scan.jpg](khb-attachments/scan.jpg)",
    );
  });

  test("a linked payload from an earlier revision stays labeled, never inlined", () => {
    const md = oneNoteMarkdown({
      pages: [page("P", [file({ name: "old.png", ext: ".png", image: true, revision: true, file: "old.png", bytes: 1024 })])],
    });
    expect(md).toBe("## P\n\n_Image from an earlier revision: [old.png](khb-attachments/old.png) (1.0 KB)_");
  });

  test("an icon is dropped — the document it stands for is named on its own line", () => {
    const md = oneNoteMarkdown({
      pages: [page("Reports", [file({ name: "CAPAAR.pdf", ext: ".pdf" }), file({ name: "", ext: ".png", image: true, icon: true })])],
    });
    expect(md).toBe("## Reports\n\n_Embedded file: CAPAAR.pdf (2.3 MB)_");
  });

  test("a revision-only attachment says so, and is never mixed into current text", () => {
    const md = oneNoteMarkdown({ pages: [page("Goals", [text("Current plan."), file({ revision: true, name: "old.pdf", ext: ".pdf" })])] });
    expect(md).toBe("## Goals\n\nCurrent plan.\n\n_Embedded file from an earlier revision: old.pdf (2.3 MB)_");
  });

  test("an unrecoverable payload is reported rather than sized", () => {
    expect(oneNoteMarkdown({ pages: [page("P", [file({ recovered: false, bytes: 0 })])] })).toBe(
      "## P\n\n_Embedded file: forecast.xlsx (not recoverable from this file)_",
    );
  });

  test("unassigned files are listed at the end with no owner inferred", () => {
    const md = oneNoteMarkdown({
      pages: [page("P")],
      orphanFiles: [file({ name: "", ext: ".pdf", bytes: 1024 })],
    });
    expect(md).toContain("## Unassigned embedded files");
    expect(md).toContain("No owner is inferred for them.");
    expect(md.trimEnd().endsWith("- Embedded file: Attachment.pdf (1.0 KB)")).toBe(true);
  });

  test("unresolved references are surfaced on the page they belong to", () => {
    const md = oneNoteMarkdown({ pages: [{ ...page("P", [text("Body.")]), unresolved: ["attachment abc", "def:2"] }] });
    expect(md).toBe("## P\n\nBody.\n\n_2 content reference(s) on this page could not be resolved._");
  });

  test("a page's own text cannot impersonate the document's structure", () => {
    const md = oneNoteMarkdown({
      pages: [page("Creating Docker Image", [text("# installing base image\nFROM node:18\n---\nkeep ## inline")])],
    });
    expect(md).toBe(
      "## Creating Docker Image\n\n\\# installing base image\nFROM node:18\n\\---\nkeep ## inline",
    );
  });

  test("a rendered table is left exactly as the parser built it", () => {
    const table = { kind: "table" as const, md: "| # | note |\n| --- | --- |\n| 1 | a |" };
    expect(oneNoteMarkdown({ pages: [page("T", [table])] })).toBe("## T\n\n| # | note |\n| --- | --- |\n| 1 | a |");
  });

  test("empty and malformed input produce nothing rather than throwing", () => {
    expect(oneNoteMarkdown({ pages: [] })).toBe("");
    expect(oneNoteMarkdown(undefined as unknown as OneNoteSection)).toBe("");
    expect(oneNoteMarkdown({ pages: [{ title: "", level: 0, blocks: [text("   "), text("")] }] })).toBe("## Untitled");
  });
});
