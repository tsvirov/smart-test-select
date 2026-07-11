#!/usr/bin/env python3
"""
Renders examples/wow-demo.gif from the exact same real CLI run as wow_demo.py —
no separate fake data path, no external recording tool (no ffmpeg/asciinema/vhs
available in this environment, and no way to brew-install them). Frames are
rasterized directly with Pillow from the real `sts select --json` output.

Requires: pip install rich pillow
Requires: npm run build has already produced dist/cli.js
Run: python3 examples/make_gif.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wow_demo  # noqa: E402  (reuses setup_repo/sts/run/paths from the flashy demo)

from PIL import Image, ImageDraw, ImageFont  # noqa: E402

FONT_PATH = "/System/Library/Fonts/Menlo.ttc"
FONT_SIZE = 16
LINE_HEIGHT = 22
PAD = 24
BG = (13, 17, 23)
COLORS = {
    "default": (201, 209, 217),
    "dim": (139, 148, 158),
    "green": (63, 185, 80),
    "red": (248, 81, 73),
    "cyan": (121, 192, 255),
    "magenta": (210, 168, 255),
}


def build_lines() -> list[tuple[str, str, int]]:
    """Runs the real CLI twice (same two scenarios as wow_demo.py) and turns the
    real JSON output into (text, color, hold_ms) lines for the GIF."""
    if not wow_demo.CLI_JS.exists():
        print("dist/cli.js not found — run `npm run build` first.", file=sys.stderr)
        sys.exit(1)

    wow_demo.setup_repo()

    with (wow_demo.DEMO_DIR / "src" / "a.ts").open("a") as f:
        f.write("\nexport const demoMarker = true;\n")
    wow_demo.run(["git", "add", "-A"], wow_demo.DEMO_DIR)
    wow_demo.run(["git", "commit", "-q", "-m", "change a.ts"], wow_demo.DEMO_DIR)
    out1 = wow_demo.sts(["select", "--base", "main", "--json"], wow_demo.DEMO_DIR)

    with (wow_demo.DEMO_DIR / "tsconfig.json").open("a") as f:
        f.write("\n")
    wow_demo.run(["git", "add", "-A"], wow_demo.DEMO_DIR)
    wow_demo.run(["git", "commit", "-q", "-m", "touch tsconfig.json"], wow_demo.DEMO_DIR)
    out2 = wow_demo.sts(["select", "--base", "main", "--json"], wow_demo.DEMO_DIR)

    lines: list[tuple[str, str, int]] = []
    lines.append(("$ sts select --base main", "dim", 500))
    lines.append(("", "default", 0))
    lines.append((f"{len(out1['selected'])} of {out1['total']} tests affected:", "cyan", 350))
    for test in out1["selected"]:
        chain = out1["reasons"].get(test, [test])
        lines.append((f"  {test}", "green", 90))
        lines.append((f"    {' -> '.join(chain)}", "dim", 120))

    skipped = out1["total"] - len(out1["selected"])
    pct = round(100 * skipped / out1["total"])
    lines.append(("", "default", 0))
    lines.append((f"-> {skipped} of {out1['total']} tests skipped — {pct}% fewer tests run", "green", 2000))
    lines.append(("", "default", 0))
    lines.append(("$ touch tsconfig.json && sts select --base main", "dim", 600))
    lines.append(("", "default", 0))
    lines.append((f"SAFE MODE — running the full suite ({out2['total']} tests)", "red", 350))
    for reason in out2["safeModeReasons"]:
        lines.append((f"  - {reason}", "red", 350))
    lines.append(("", "default", 0))
    lines.append(("Real CLI. Real fixture. Real numbers.", "magenta", 2500))
    return lines


def render_gif(lines: list[tuple[str, str, int]], out_path: Path) -> None:
    font = ImageFont.truetype(FONT_PATH, FONT_SIZE)
    metrics_img = Image.new("RGB", (10, 10))
    metrics_draw = ImageDraw.Draw(metrics_img)
    widths = [metrics_draw.textlength(text, font=font) for text, _, _ in lines]
    width = int(max(widths, default=400)) + PAD * 2
    height = len(lines) * LINE_HEIGHT + PAD * 2

    frames: list[Image.Image] = []
    durations: list[int] = []
    for i in range(1, len(lines) + 1):
        img = Image.new("RGB", (width, height), BG)
        draw = ImageDraw.Draw(img)
        for j, (text, color_key, _) in enumerate(lines[:i]):
            draw.text((PAD, PAD + j * LINE_HEIGHT), text, font=font, fill=COLORS[color_key])
        frames.append(img)
        durations.append(max(lines[i - 1][2], 60))

    frames[0].save(
        out_path,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        optimize=True,
    )


if __name__ == "__main__":
    out_path = Path(__file__).resolve().parent / "wow-demo.gif"
    render_gif(build_lines(), out_path)
    print(f"wrote {out_path} ({out_path.stat().st_size} bytes)")
