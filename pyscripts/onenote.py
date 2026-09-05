"""Parse a OneNote `.one` section into page-structured JSON on stdout.

khb owns conversion, not interpretation (AGENTS.md), so this script resolves the file
faithfully and stops: pages in section order, each page's current text in content order,
tables, lists, and the identity of every embedded file. It writes nothing, contacts no
model, and makes no judgement about what any of it means.

Usage:  python onenote.py <file.one> [--files <dir>]   → JSON to stdout, errors to stderr

With `--files`, every embedded payload is written into that directory under a readable,
collision-free name, and each file block gains the name it was written as. Without it,
nothing is written anywhere: the JSON still names every attachment, so the script stays
usable for inspecting a section without unpacking it.

Requires pyOneNote (github.com/DissectMalware/pyOneNote); the caller probes for it and
reports the install command, so an ImportError here is the caller's problem to explain.

The approach — and most of the hard-won detail — is ported from a working exporter and its
parser invariants (D:/backup/Onenote/extraction-tools/extract_readable_notes.py). The five
that matter, because getting any of them wrong yields text that looks plausible and is
wrong:

  1. Advance the object-reference cursor. Installed pyOneNote's
     `ObjectSpaceObjectStreamOfIDs.read()` returns `body[head]` and never increments `head`,
     so every reference in a property set resolves to the same first object. Without the
     correction below, no content tree can be walked at all.
  2. Resolve each page's *explicitly current* revision and its dependency chain. A `.one`
     stores its own history; traversal order does not identify what the page says today.
  3. Take a page's title and level from its root-role-2 metadata. One page series holds a
     parent and its subpages, each separately titled — assigning the series' first title to
     all of them is the classic wrong answer.
  4. Walk actual content references, in order. Never reconstruct pages by grouping on GUID
     prefixes or by globally de-duplicating text fragments.
  5. Resolve file containers to payloads. An embedded document's `PictureContainer` is its
     *icon*, not the document; substituting one for the other loses the real attachment.
"""
from __future__ import annotations

import ast
import hashlib
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

from pyOneNote.FileNode import ObjectSpaceObjectStreamOfIDs
from pyOneNote.OneDocument import OneDocment


def read_id(self):
    """Invariant 1. Kept local to this script — no installed package is modified."""
    if self.head >= len(self.body):
        raise ValueError("OneNote object reference stream exhausted")
    result = self.body[self.head]
    self.head += 1
    return result


ObjectSpaceObjectStreamOfIDs.read = read_id

# The three property names under which a node lists its content children. A page's text is
# whatever these point at, in this order — invariant 4.
CHILDREN = (
    "ContentChildNodesOfPageManifest",
    "ElementChildNodesOfVersionHistory",
    "StructureElementChildNodes",
)
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".tif", ".tiff"}


def identity(value):
    """`(guid, n)` object ids stringified by pyOneNote, normalized to `guid:n`."""
    text = str(value)
    match = re.search(r"([a-fA-F0-9-]{36}).*?(\d+)\)", text)
    if not match:
        raise ValueError(f"Unrecognized identity: {text}")
    return f"{match[1].lower()}:{match[2]}"


def clean(value):
    return str(value or "").replace("\x00", "").strip()


def integer(value, default=0):
    """Numeric properties arrive as the *repr* of their bytes, e.g. "b'\\x02\\x00'"."""
    try:
        return int.from_bytes(ast.literal_eval(value), "little")
    except (ValueError, TypeError, SyntaxError):
        return default


def safe_name(value, limit=80):
    """A payload name that is safe on every filesystem khb runs on, Windows included."""
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "-", clean(value))
    value = re.sub(r"\s+", " ", value).strip(" .")[:limit].rstrip(" .") or "Attachment"
    if re.match(r"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)", value, re.I):
        value = "_" + value
    return value


def values_of(node):
    """
    A node's properties, with text decoded from the actual bytes.

    pyOneNote's own formatter guesses UTF-16 for every string property and falls back to a
    hex dump when that raises — so an extended-ASCII run reaches a caller as mojibake or as
    hex digits. Decode the two text properties per their real encoding instead.
    """
    body = node.propertySet.body
    values = dict(body.get_properties())
    for prop, raw in zip(body.rgPrids, body.rgData):
        key = str(prop)
        if key in ("RichEditTextUnicode", "TextExtendedAscii") and hasattr(raw, "Data"):
            encoding = "utf-16-le" if key == "RichEditTextUnicode" else "utf-8"
            try:
                values[key] = raw.Data.decode(encoding)
            except UnicodeDecodeError:
                values[key] = raw.Data.decode("cp1252", errors="replace")
    return values


class NotebookSection:
    """One `.one` file: its revisions, its current object snapshot per page, its files."""

    def __init__(self, source: Path):
        with source.open("rb") as stream:
            document = OneDocment(stream)
        nodes = []
        OneDocment.traverse_nodes(document.root_file_node_list, nodes, [])
        self.files = document.get_files()
        self.revisions = {}
        self.current = {}
        self.aliases = {}
        self.all_objects = defaultdict(list)
        space = None
        revision = None

        for node in nodes:
            data = getattr(node, "data", None)
            kind = type(data).__name__
            if kind == "RevisionManifestListStartFND":
                space = identity(data.gosid)
            elif kind in ("RevisionManifestStart4FND", "RevisionManifestStart6FND", "RevisionManifestStart7FND"):
                base = data.base if hasattr(data, "base") else data
                revision = {"space": space, "parent": identity(base.ridDependent), "objects": {}, "roots": {}}
                self.revisions[identity(base.rid)] = revision
                # Invariant 2: role 1 is "current". The 7FND variant does not declare it.
                if base.RevisionRole == 1 and kind != "RevisionManifestStart7FND":
                    self.current[space] = identity(base.rid)
            elif kind == "RevisionRoleDeclarationFND" and data.RevisionRole == 1:
                self.current[space] = identity(data.rid)
            elif kind in ("RootObjectReference2FNDX", "RootObjectReference3FND"):
                revision["roots"][data.RootRole] = identity(data.oidRoot)
            elif kind == "ObjectDeclarationFileData3RefCountFND":
                guid = data.FileDataReference.StringData.replace("<ifndf>{", "").replace("}", "").lower()
                self.aliases[identity(data.oid)] = guid
            if hasattr(node, "propertySet"):
                obj = {"type": str(data.body.jcid), "val": values_of(node), "id": identity(data.body.oid)}
                revision["objects"][obj["id"]] = obj
                # Kept per object space, not per revision: an attachment that only exists in
                # an older revision still belongs to this page (invariant 6 of the source).
                self.all_objects[space].append(obj)

        self.snapshots = {}
        self.spaces = {space: self.snapshot(rid) for space, rid in self.current.items()}

    def snapshot(self, rid):
        """A revision's objects = its parent's, overlaid with its own. Invariant 2."""
        if rid in self.snapshots:
            return self.snapshots[rid]
        revision = self.revisions[rid]
        if revision["parent"] in self.revisions:
            parent_objects, parent_roots = self.snapshot(revision["parent"])
            objects, roots = dict(parent_objects), dict(parent_roots)
        else:
            objects, roots = {}, {}
        objects.update(revision["objects"])
        roots.update(revision["roots"])
        self.snapshots[rid] = objects, roots
        return objects, roots

    def display_name(self):
        for objects, _roots in self.spaces.values():
            for obj in objects.values():
                name = clean(obj["val"].get("SectionDisplayName"))
                if name:
                    return name
        return ""

    def pages(self):
        """Every current page, in the order the section presents them."""
        ordered = []
        found = set()
        series_metadata = {}

        # Section node → page series → the page object spaces each series holds. This is
        # what puts pages in section order rather than in file order.
        for objects, roots in self.spaces.values():
            root = objects.get(roots.get(1))
            if not root or root["type"] != "jcidSectionNode":
                continue
            for series_ref in root["val"].get("ElementChildNodesOfVersionHistory", []):
                series = objects.get(identity(series_ref))
                if not series:
                    continue
                metas = [objects.get(identity(ref), {}) for ref in series["val"].get("MetaDataObjectsAboveGraphSpace", [])]
                meta = next((obj["val"] for obj in metas if obj.get("type") == "jcidPageMetaData"), {})
                for page_ref in series["val"].get("ChildGraphSpaceElementNodes", []):
                    page_space = identity(page_ref)
                    series_metadata[page_space] = meta
                    if page_space in self.spaces and page_space not in found:
                        ordered.append(page_space)
                        found.add(page_space)

        # A page whose series never named it is still a page — keep it, after the ordered set.
        for page_space, (objects, roots) in self.spaces.items():
            obj = objects.get(roots.get(1))
            if obj and obj["type"] == "jcidPageManifestNode" and page_space not in found:
                ordered.append(page_space)

        pages = []
        for page_space in ordered:
            objects, roots = self.spaces[page_space]
            manifest = objects.get(roots.get(1))
            if not manifest or manifest["type"] != "jcidPageManifestNode":
                continue
            # Invariant 3: root role 2 is *this* page's metadata, so a parent and its
            # subpages keep their own titles and levels.
            root_meta = objects.get(roots.get(2), {})
            meta = root_meta.get("val", {}) if root_meta.get("type") == "jcidPageMetaData" else {}
            if not meta:
                above = [objects.get(identity(ref), {}) for ref in manifest["val"].get("MetaDataObjectsAboveGraphSpace", [])]
                meta = series_metadata.get(page_space) or next(
                    (obj["val"] for obj in above if obj.get("type") == "jcidPageMetaData"), {}
                )
            title = clean(meta.get("CachedTitleString"))
            if not title:
                title = self.title_from_nodes(objects)
            pages.append(
                {
                    "space": page_space,
                    "objects": objects,
                    "root": manifest["id"],
                    "title": title or "Untitled",
                    "created": clean(meta.get("TopologyCreationTimeStamp")),
                    "level": max(1, integer(meta.get("PageLevel"), 1)),
                }
            )
        return pages

    def title_from_nodes(self, objects):
        """No cached title: walk the title node's content for the text it displays."""
        queue = [obj["id"] for obj in objects.values() if obj["type"] == "jcidTitleNode"]
        checked = set()
        while queue:
            oid = queue.pop(0)
            if oid in checked:
                continue
            checked.add(oid)
            values = objects.get(oid, {}).get("val", {})
            text = clean(values.get("RichEditTextUnicode") or values.get("TextExtendedAscii"))
            if text:
                return text
            queue.extend(identity(ref) for key in CHILDREN for ref in values.get(key, []))
        return ""


class PayloadWriter:
    """
    Writes embedded payloads out under readable names, once each per section.

    Names come from the note's own property (`EmbeddedFileName`, `ImageFilename`) because
    that is what the user typed or the file was called; a payload with no name of its own
    gets `Image`/`Attachment` plus its real extension. Every write is read back and hashed
    against the payload, since a truncated attachment that still looks like a file is the
    one failure a later reader cannot detect.
    """

    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.written = {}
        self.by_digest = {}
        self.used = set()

    def unique(self, filename):
        stem, suffix = Path(filename).stem, Path(filename).suffix
        candidate, number = filename, 2
        while candidate.casefold() in self.used:
            candidate = f"{stem} ({number}){suffix}"
            number += 1
        self.used.add(candidate.casefold())
        return candidate

    def write(self, guid, name, extension, content):
        if guid in self.written:
            return self.written[guid]
        # A section stores the same document under more than one object id routinely — a
        # revision keeps its own copy. One payload is one file: writing it twice would earn
        # two ledger rows, two extractions and eventually two concepts for one attachment.
        digest = hashlib.sha256(content).hexdigest()
        if digest in self.by_digest:
            self.written[guid] = self.by_digest[digest]
            return self.written[guid]
        given = Path(name)
        stem = safe_name(given.stem) if given.stem else ("Image" if extension in IMAGE_EXT else "Attachment")
        # Keep the payload's real extension unless the note's name already carries it.
        suffix = given.suffix if given.suffix.lower() == extension else extension
        filename = self.unique(stem + suffix)
        target = self.directory / filename
        target.write_bytes(content)
        if hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            raise ValueError(f"embedded file {guid} did not survive being written out")
        self.written[guid] = filename
        self.by_digest[digest] = filename
        return filename


class PageReader:
    """
    One page's content tree → an ordered list of blocks.

    Blocks are `{"kind": "text"|"table"|"file", …}`. Text and tables carry finished markdown
    because the recursion that walks the tree is also what renders them; files carry their
    identity instead of bytes, and khb's markdown side decides how to name them. Nothing is
    written to disk here.
    """

    def __init__(self, section: NotebookSection, page, writer: PayloadWriter | None = None):
        self.section = section
        self.page = page
        self.writer = writer
        self.visited = set()
        self.unresolved = []
        self.seen_files = set()

    def file_blocks(self, obj):
        blocks = []
        values = obj["val"]
        for key, name in (
            ("EmbeddedFileContainer", values.get("EmbeddedFileName")),
            ("PictureContainer", values.get("ImageFilename")),
        ):
            for ref in values.get(key, []):
                guid = self.section.aliases.get(identity(ref))
                if not guid:
                    self.unresolved.append(f"file reference {identity(ref)}")
                    continue
                # Invariant 5: a PictureContainer on an embedded *file* node is that
                # document's icon. Keep it flagged so no caller mistakes it for content.
                icon = key == "PictureContainer" and obj["type"] != "jcidImageNode"
                blocks.append(self.file_block(guid, clean(name), icon))
        return blocks

    def file_block(self, guid, name, icon=False, revision=False):
        item = self.section.files.get(guid)
        content = item.get("content") if item else None
        extension = clean(item.get("extension") if item else "").lower()
        if extension and not extension.startswith("."):
            extension = "." + extension
        if not re.fullmatch(r"\.[a-z0-9]{1,10}", extension or ""):
            extension = ""
        basename = name.replace("\\", "/").split("/")[-1]
        self.seen_files.add(guid)
        if not isinstance(content, bytes):
            self.unresolved.append(f"attachment {guid}")
        block = {
            "kind": "file",
            "guid": guid,
            "name": basename,
            "ext": extension,
            "bytes": len(content) if isinstance(content, bytes) else 0,
            "image": extension in IMAGE_EXT,
            "icon": icon,
            "revision": revision,
            "recovered": isinstance(content, bytes),
        }
        # An icon is not worth a file on disk: the document it stands for is written out
        # under its own name, and unpacking thumbnails would put junk in front of curation.
        if self.writer and isinstance(content, bytes) and not icon:
            block["file"] = self.writer.write(guid, basename, extension, content)
        return block

    def render(self, oid):
        if oid in self.visited:
            return []
        self.visited.add(oid)
        obj = self.page["objects"].get(oid)
        if obj is None:
            self.unresolved.append(oid)
            return []

        kind, values = obj["type"], obj["val"]
        if kind == "jcidTitleNode":
            return []  # the title is the page's heading, not a paragraph of its body
        if kind in ("jcidImageNode", "jcidEmbeddedFileNode"):
            return self.file_blocks(obj)

        children = [identity(ref) for key in CHILDREN for ref in values.get(key, [])]
        if kind == "jcidTableNode":
            table = self.table(children)
            if table:
                return [table]

        text = clean(values.get("RichEditTextUnicode") or values.get("TextExtendedAscii"))
        blocks = [{"kind": "text", "md": text}] if text else []
        for child in children:
            blocks.extend(self.render(child))
        if kind == "jcidOutlineElementNode" and values.get("ListNodes"):
            blocks = [self.bullet(block) for block in blocks]
        return blocks

    @staticmethod
    def bullet(block):
        if block["kind"] != "text":
            return block
        return {"kind": "text", "md": "- " + block["md"].replace("\n", "\n  ")}

    def table(self, rows):
        cells = []
        for row_id in rows:
            row = self.page["objects"].get(row_id)
            if row is None:
                self.unresolved.append(row_id)
                continue
            line = [
                self.as_text(self.render(identity(ref))).replace("|", "\\|").replace("\n", "<br>")
                for key in CHILDREN
                for ref in row["val"].get(key, [])
            ]
            if line:
                cells.append(line)
        if not cells:
            return None
        width = max(len(line) for line in cells)
        lines = ["| " + " | ".join(line + [""] * (width - len(line))) + " |" for line in cells]
        lines.insert(1, "| " + " | ".join(["---"] * width) + " |")
        return {"kind": "table", "md": "\n".join(lines)}

    def as_text(self, blocks):
        """Flatten blocks for a table cell, where only text can live."""
        parts = [block["md"] if block["kind"] in ("text", "table") else self.label(block) for block in blocks]
        return "\n\n".join(part for part in parts if part)

    @staticmethod
    def label(block):
        return block["name"] or ("Image" + block["ext"] if block["image"] else "Attachment" + block["ext"])


def read_section(source: Path, files_dir=None):
    section = NotebookSection(source)
    writer = PayloadWriter(files_dir) if files_dir else None
    pages = []
    claimed = set()

    def payload_key(block):
        """One payload, however many object ids point at it."""
        return block.get("file") or (block["name"], block["bytes"], block["ext"])

    for page in section.pages():
        reader = PageReader(section, page, writer)
        blocks = reader.render(page["root"])
        present = {payload_key(block) for block in blocks if block["kind"] == "file"}
        # Attachments that only exist in a stored revision of *this* page: kept, labeled, and
        # never mixed in with current text. A revision that merely kept its own copy of a
        # document the page still shows is not an extra attachment, so it is not listed twice.
        for obj in section.all_objects[page["space"]]:
            if obj["type"] not in ("jcidImageNode", "jcidEmbeddedFileNode"):
                continue
            for key, field in (("EmbeddedFileContainer", "EmbeddedFileName"), ("PictureContainer", "ImageFilename")):
                for ref in obj["val"].get(key, []):
                    guid = section.aliases.get(identity(ref))
                    if not guid or guid in reader.seen_files:
                        continue
                    block = reader.file_block(guid, clean(obj["val"].get(field, "")), revision=True)
                    if payload_key(block) in present:
                        continue
                    present.add(payload_key(block))
                    blocks.append(block)
        claimed |= reader.seen_files
        pages.append(
            {
                "title": page["title"],
                "level": page["level"],
                "created": page["created"],
                "blocks": blocks,
                "unresolved": sorted(set(reader.unresolved)),
            }
        )

    # Files no current page claims: written out and named, never guessed at an owner for.
    orphans = []
    if pages:
        spare = PageReader(section, {"objects": {}}, writer)
        orphans = [spare.file_block(guid, "") for guid in sorted(set(section.files) - claimed)]

    return {
        "sectionName": section.display_name(),
        "pages": pages,
        "orphanFiles": orphans,
        "stats": {
            "pages": len(pages),
            "files": len(section.files),
            "claimed": len(claimed),
            "unassigned": len(orphans),
            "unresolved": sum(len(page["unresolved"]) for page in pages),
        },
    }


def main():
    argv = sys.argv[1:]
    files_dir = None
    if "--files" in argv:
        index = argv.index("--files")
        if index + 1 >= len(argv):
            sys.exit("usage: onenote.py <file.one> [--files <dir>]")
        files_dir = argv[index + 1]
        argv = argv[:index] + argv[index + 2 :]
    if len(argv) != 1:
        sys.exit("usage: onenote.py <file.one> [--files <dir>]")
    # Straight to the byte stream: notes are full of characters a Windows console's cp1252
    # stdout cannot encode, and the caller decodes UTF-8 regardless of the local codepage.
    payload = json.dumps(read_section(Path(argv[0]), files_dir), ensure_ascii=False)
    sys.stdout.buffer.write(payload.encode("utf-8"))


if __name__ == "__main__":
    main()
