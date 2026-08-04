#!/usr/bin/env python3
"""Render images/demo.gif — the terminal demo at the top of README.md.

Kept in the repo so the GIF can be regenerated when the CLI output changes; it is not
part of the published package (see the `files` allowlist in package.json). The command
output below is transcribed from a real session, so re-record rather than invent when
a command's output changes.

    python images/make-demo-gif.py
"""
from PIL import Image, ImageDraw, ImageFont
import pathlib

OUT = pathlib.Path(__file__).parent / "demo.gif"

PAD = 22
TITLE_H = 34
LINE_H = 22
FONT_SIZE = 15
# Canvas is sized to the content (below) rather than fixed: a hardcoded box leaves dead
# space that GitHub then scales down, softening the text.

BG = (13, 17, 23)
CHROME = (22, 27, 34)
BORDER = (48, 54, 61)
FG = (201, 209, 217)
DIM = (110, 118, 129)
PROMPT = (126, 231, 135)
CMD = (233, 236, 241)
PATH = (121, 192, 255)
OK = (126, 231, 135)
WARN = (210, 168, 255)

FONT = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", FONT_SIZE)
FONT_B = ImageFont.truetype("C:/Windows/Fonts/consolab.ttf", FONT_SIZE)

# (kind, text, colour) — "cmd" is typed out a character at a time, everything else lands
# whole. Transcribed from a real run; see the module docstring.
SCRIPT = [
    ("cmd",  "khb init ~/knowledge", CMD),
    ("out",  "Hub created: ~/knowledge", FG),
    ("out",  "  khb.json, outer.index.md, bundles/, .gitignore, .gitattributes", DIM),
    ("out",  "  contract docs: AGENTS.md, CLAUDE.md, SPEC.md, skills/", DIM),
    ("gap",  "", FG),

    ("cmd",  'khb new-bundle finances "Personal finances: budgets, tax"', CMD),
    ("out",  "Created bundles/finances/ and registered it in outer.index.md", FG),
    ("gap",  "", FG),

    ("cmd",  "khb ingest finances", CMD),
    ("out",  "khb ingest -> bundle 'finances'", FG),
    ("out",  "  sources:  1 declared in bundles/finances/sources.yaml", DIM),
    ("out",  "  options:  ocr=on  audio=on  force=off", DIM),
    ("out",  "[1/1] folder — ~/documents/finances -> raw/folder/", DIM),
    ("out",  "  [1/2] ~/documents/finances/budget.txt", DIM),
    ("out",  "         copied -> raw/folder/budget.txt.md (0.0s)", PATH),
    ("out",  "  [2/2] ~/documents/finances/tax-notes.txt", DIM),
    ("out",  "         copied -> raw/folder/tax-notes.txt.md (0.0s)", PATH),
    ("out",  "ledger: 2 source(s) in log.md", FG),
    ("out",  "  2 in raw/ but not yet cataloged (empty 'curated')", DIM),
    ("gap",  "", FG),

    # Ingest ends by offering the catalog pass; the agent curates only on a yes.
    ("out",  '  agent  "2 files uncurated. Catalog them into concepts now?"', WARN),
    ("out",  '  you    "yes"', WARN),
    ("out",  "  agent  wrote finances/budget.md, finances/tax.md", DIM),
    ("gap",  "", FG),

    ("out",  '  you    "when is my tax deadline?"', WARN),
    ("out",  "  agent  outer.index.md -> finances -> tax.md", DIM),
    ("out",  '  agent  "31 January."  [finances/tax.md]', FG),
    ("gap",  "", FG),

    ("cmd",  "khb lint", CMD),
    ("out",  "lint: 0 error(s), 0 warning(s) across 1 bundle(s)", OK),
]

_longest = max(FONT_B.getlength("$ " + t) if k == "cmd" else FONT.getlength(t)
               for k, t, _ in SCRIPT)
W = int(PAD * 2 + _longest) + 12
H = TITLE_H + PAD * 2 + LINE_H * len(SCRIPT)

CHARS_PER_FRAME = 2
FRAME_MS = 45           # typing cadence
HOLD_AFTER_CMD = 400    # pause once a command is fully typed, ms
HOLD_AFTER_OUT = 180
HOLD_GAP = 90
HOLD_END = 2200
# Pauses are per-frame durations, never repeated frames: PIL's optimizer collapses
# identical consecutive frames and a scalar duration would silently drop the pauses.
MAX_LINES = (H - TITLE_H - PAD * 2) // LINE_H


def chrome(img):
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, TITLE_H], fill=CHROME)
    d.line([0, TITLE_H, W, TITLE_H], fill=BORDER)
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        x = 20 + i * 20
        d.ellipse([x, TITLE_H // 2 - 6, x + 12, TITLE_H // 2 + 6], fill=c)
    d.text((96, TITLE_H // 2 - 9), "khb — knowledge hub builder", font=FONT, fill=DIM)


def render(lines, cursor_on):
    """lines: list of (text, colour, is_prompt). Returns one frame."""
    img = Image.new("RGB", (W, H), BG)
    chrome(img)
    d = ImageDraw.Draw(img)
    visible = lines[-MAX_LINES:]
    y = TITLE_H + PAD
    for n, (text, colour, is_prompt) in enumerate(visible):
        x = PAD
        if is_prompt:
            d.text((x, y), "$", font=FONT_B, fill=PROMPT)
            x += FONT.getlength("$ ")
        d.text((x, y), text, font=FONT if not is_prompt else FONT_B, fill=colour)
        if is_prompt and cursor_on and n == len(visible) - 1:
            cx = x + FONT.getlength(text)
            d.rectangle([cx + 1, y + 2, cx + 9, y + LINE_H - 5], fill=FG)
        y += LINE_H
    return img


def build():
    frames, durations, lines = [], [], []

    def emit(cursor, ms):
        frames.append(render([tuple(l) for l in lines], cursor))
        durations.append(ms)

    for kind, text, colour in SCRIPT:
        if kind == "cmd":
            lines.append(["", colour, True])
            for i in range(0, len(text), CHARS_PER_FRAME):
                lines[-1][0] = text[:i]
                emit(True, FRAME_MS)
            lines[-1][0] = text
            emit(True, HOLD_AFTER_CMD)
        else:
            lines.append([text, colour, False])
            emit(False, HOLD_AFTER_OUT if kind == "out" else HOLD_GAP)
    durations[-1] = HOLD_END

    pal = [f.quantize(colors=64, method=Image.MEDIANCUT, dither=Image.NONE) for f in frames]
    pal[0].save(
        OUT, save_all=True, append_images=pal[1:], duration=durations, loop=0, optimize=True
    )
    secs = sum(durations) / 1000
    print(f"{OUT}  {len(pal)} frames  {secs:.1f}s  {OUT.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    build()
