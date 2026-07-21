// Lightweight, dependency-free heuristics for detecting password-protected documents,
// so a corpus can be triaged without silently shipping files no CLI tool downstream
// (pdftotext/pandoc) will be able to open. Covers only the two EXTRACTABLE formats
// (exts.ts) where a cheap byte-level signal exists:
//   .pdf  — trailer/xref carries an /Encrypt dictionary reference
//   .docx — MS wraps an encrypted OOXML payload in an OLE2 (CFB) container instead
//           of the normal PK zip; that's a hard format marker, not a text scan
// Legacy binary Office formats (.doc/.xls/.ppt) always use the CFB container whether
// encrypted or not, so there's no cheap signal and they're not checked here.
import { openSync, readSync, closeSync } from "node:fs";

export const PROTECTABLE = new Set([".pdf", ".docx"]);

const CFB_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** Best-effort: false negatives are possible (unusual encoders), false positives are not — both signals are exact format markers. */
export function detectPasswordProtected(path: string, ext: string, size: number): boolean {
  const fd = openSync(path, "r");
  try {
    if (ext === ".docx") {
      const buf = Buffer.alloc(8);
      readSync(fd, buf, 0, 8, 0);
      return buf.equals(CFB_MAGIC);
    }
    if (ext === ".pdf") {
      const headLen = Math.min(size, 8192);
      const headBuf = Buffer.alloc(headLen);
      readSync(fd, headBuf, 0, headLen, 0);
      if (headBuf.includes("/Encrypt")) return true;
      if (size > headLen) {
        const tailLen = Math.min(8192, size);
        const tailBuf = Buffer.alloc(tailLen);
        readSync(fd, tailBuf, 0, tailLen, size - tailLen);
        if (tailBuf.includes("/Encrypt")) return true;
      }
      return false;
    }
    return false;
  } finally {
    closeSync(fd);
  }
}
