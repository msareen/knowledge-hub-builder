#!/usr/bin/env python3
"""Render images/demo.gif — the demo at the top of README.md.

The GIF shows what KHB actually looks like in use. It opens in the shell, because
`khb init` and starting the agent are the two things a person really types, and
then stays inside the agent for everything after — nobody runs `khb ingest` by
hand. The agent loads the skill, asks the questions the protocol makes it ask,
runs the CLI as a tool call, and does the cataloging the CLI deliberately cannot.
So the first frames are a shell (`$`) and the rest is a Claude Code register: `>`
for the human turn, a bullet for each agent turn or tool call, and indented dim
lines for tool output.

Kept in the repo so the GIF can be regenerated when the CLI output changes; it is not
part of the published package (see the `files` allowlist in package.json). The tool
output below is transcribed from a real run, so re-record rather than invent when a
command's output changes.

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
ACCENT = (215, 119, 87)     # the agent's turn marker
TOOL = (233, 236, 241)      # tool name, before its parenthesised argument

FONT = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", FONT_SIZE)
FONT_B = ImageFont.truetype("C:/Windows/Fonts/consolab.ttf", FONT_SIZE)

# Consolas has none of Claude Code's own glyphs (U+23FA, U+23BF), and a missing glyph
# renders as tofu, so the markers here are the nearest shapes the font does carry.
BULLET = "\u25cf "          # agent turn / tool call
ELBOW = "  \u2514 "         # first line of a tool result
CONT = "     "              # subsequent result lines, aligned under the elbow

# (kind, text, colour):
#   cmd    a shell command, typed out a character at a time, prefixed `$`
#   out    shell output
#   user   the human's turn inside the agent, typed out, prefixed `>`
#   agent  what the agent says
#   tool   a tool call — "Name(argument)", split and coloured on the paren
#   res    tool output, first line          cont  tool output, continued
#   note   an unprefixed aside (the bundle menu)
# Tool output is transcribed from a real run; see the module docstring.
SCRIPT = [
    # The only part anyone types by hand: make the hub, then hand it to an agent.
    ("cmd",   "khb init ~/knowledge", CMD),
    ("out",   "Hub created: ~/knowledge", FG),
    ("out",   "  khb.json, outer.index.md, bundles/, .gitignore", DIM),
    ("out",   "  contract docs: AGENTS.md, CLAUDE.md, SPEC.md, skills/", DIM),
    ("gap",   "", FG),

    # Stylised banner, not verbatim startup output: what matters is that the hub's
    # own contract and skills are what the agent picks up on entry.
    ("cmd",   "cd knowledge && claude", CMD),
    ("out",   "* Welcome to Claude Code   —   cwd: ~/knowledge", WARN),
    ("out",   "  CLAUDE.md -> AGENTS.md  ·  skills: ingest, catalog, query, lint, …", DIM),
    ("gap",   "", FG),

    ("user",  "add my finance docs to the hub and write them up", CMD),
    ("gap",   "", FG),

    ("tool",  "Skill(ingest)", TOOL),
    ("res",   "acquire into raw/ with provenance — no interpretation", DIM),
    ("gap",   "", FG),

    # Step 1 of the protocol: the destination is the user's decision, never a guess.
    ("agent", "Which bundle owns this material?", FG),
    ("note",  "  finances  — Personal finances: budgets, tax", DIM),
    ("note",  "  a new bundle", DIM),
    ("gap",   "", FG),
    ("user",  "finances", CMD),
    ("gap",   "", FG),

    ("tool",  "Bash(khb ingest finances)", TOOL),
    ("res",   "[1/1] folder — ~/documents/finances -> raw/folder/", DIM),
    ("cont",  "  copied -> raw/folder/budget.txt.md (0.0s)", PATH),
    ("cont",  "  copied -> raw/folder/tax-notes.txt.md (0.0s)", PATH),
    ("cont",  "ledger: 2 source(s), 2 not yet cataloged (empty 'curated')", DIM),
    ("gap",   "", FG),

    # Ingest ends in an offer; curation happens only on a yes.
    ("agent", "2 files uncurated. Catalog them into concept docs now?", WARN),
    ("user",  "yes", CMD),
    ("gap",   "", FG),

    # The half no CLI can do: splitting text into concepts and labelling them.
    ("tool",  "Skill(catalog)", TOOL),
    ("tool",  "Write(bundles/finances/tax.md)", TOOL),
    ("res",   "type: Reference  ·  self-assessment deadlines", DIM),
    ("tool",  "Write(bundles/finances/budget.md)", TOOL),
    ("tool",  "Edit(bundles/finances/index.md)", TOOL),
    ("res",   "2 concepts registered  ·  log.md 'curated' filled in", DIM),
    ("gap",   "", FG),

    ("tool",  "Bash(khb lint)", TOOL),
    ("res",   "lint: 0 error(s), 0 warning(s) across 1 bundle(s)", OK),
    ("gap",   "", FG),

    ("user",  "when is my tax deadline?", CMD),
    ("agent", "outer.index.md -> finances -> tax.md", DIM),
    ("agent", "31 January.  [finances/tax.md]", FG),
]

# Typed out a character at a time — a shell command and a prompt to the agent read the
# same way to a viewer: someone is at a keyboard.
TYPED = {"cmd", "user"}

PREFIX = {
    "cmd":   ("$ ", PROMPT),
    "out":   ("", FG),
    "user":  ("> ", PROMPT),
    "agent": (BULLET, ACCENT),
    "tool":  (BULLET, ACCENT),
    "res":   (ELBOW, DIM),
    "cont":  (CONT, DIM),
    "note":  ("", DIM),
    "gap":   ("", DIM),
}


def segments(kind, text, colour):
    """One line as (text, font, colour) runs — the only place styling is decided."""
    pre, pre_colour = PREFIX[kind]
    typed = kind in TYPED
    out = [(pre, FONT_B if typed else FONT, pre_colour)] if pre else []
    if kind == "tool" and "(" in text:
        # `Write(path.md)` — the name carries the weight, the argument the colour.
        name, arg = text.split("(", 1)
        out += [(name, FONT_B, TOOL), ("(" + arg[:-1], FONT, PATH), (")", FONT, TOOL)]
    else:
        out.append((text, FONT_B if typed else FONT, colour))
    return out


def width(segs):
    return sum(f.getlength(t) for t, f, _ in segs)


W = int(PAD * 2 + max(width(segments(*s)) for s in SCRIPT)) + 12
H = TITLE_H + PAD * 2 + LINE_H * len(SCRIPT)

CHARS_PER_FRAME = 2
FRAME_MS = 45           # typing cadence
HOLD_AFTER_CMD = 400    # pause once a prompt is fully typed, ms
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
    d.text((96, TITLE_H // 2 - 9), "claude  —  ~/knowledge", font=FONT, fill=DIM)


def render(lines, cursor_on):
    """lines: list of (kind, text, colour). Returns one frame."""
    img = Image.new("RGB", (W, H), BG)
    chrome(img)
    d = ImageDraw.Draw(img)
    visible = lines[-MAX_LINES:]
    y = TITLE_H + PAD
    for n, (kind, text, colour) in enumerate(visible):
        x = PAD
        segs = segments(kind, text, colour)
        for t, font, c in segs:
            d.text((x, y), t, font=font, fill=c)
            x += font.getlength(t)
        if kind in TYPED and cursor_on and n == len(visible) - 1:
            d.rectangle([x + 1, y + 2, x + 9, y + LINE_H - 5], fill=FG)
        y += LINE_H
    return img


def build():
    frames, durations, lines = [], [], []

    def emit(cursor, ms):
        frames.append(render([tuple(l) for l in lines], cursor))
        durations.append(ms)

    for kind, text, colour in SCRIPT:
        if kind in TYPED:
            lines.append([kind, "", colour])
            for i in range(0, len(text), CHARS_PER_FRAME):
                lines[-1][1] = text[:i]
                emit(True, FRAME_MS)
            lines[-1][1] = text
            emit(True, HOLD_AFTER_CMD)
        else:
            lines.append([kind, text, colour])
            emit(False, HOLD_AFTER_OUT if kind != "gap" else HOLD_GAP)
    durations[-1] = HOLD_END

    pal = [f.quantize(colors=64, method=Image.MEDIANCUT, dither=Image.NONE) for f in frames]
    pal[0].save(
        OUT, save_all=True, append_images=pal[1:], duration=durations, loop=0, optimize=True
    )
    secs = sum(durations) / 1000
    print(f"{OUT}  {len(pal)} frames  {secs:.1f}s  {OUT.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    build()
