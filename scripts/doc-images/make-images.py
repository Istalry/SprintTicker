"""
Renders the BUSY Bar pictures the documentation shows, as the LED panel looks.

    python scripts/doc-images/make-images.py                 # scenes and icons
    python scripts/doc-images/make-images.py --frames <dir>  # also what
                                                             # capture-app.js recorded

Two sources, one look:

- The scenes and animated icons are read from `Animations/`, the same frames
  the app compiles into `.anim` files. Nothing has to run for these.
- The screens the app composes itself -- the session, Unity, banners -- come
  from `capture-app.js`, which records the frames the app sends to its own
  emulator while it runs on a throwaway profile. Each one is a JSON file of
  72x16 pixels with the time it arrived.

Pillow only, like `seq2anim.py`: Pillow is already what compiling an animation
asks of a contributor, and NumPy would be one more thing to install for a
picture.

Everything lands in `docs/images/` as `bar-*.webp` (animated) or `bar-*.png`. The files
are plain Git blobs, not LFS: `.gitattributes` keeps LFS to `Animations/` on
purpose, since its bandwidth is the scarce part. Hence the frame-rate halving
and the size check at the end -- a 60 fps scene at full rate is a megabyte
of a repository everyone clones.
"""

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageChops

ROOT = Path(__file__).resolve().parents[2]
ANIMATIONS = ROOT / "Animations"
OUT = ROOT / "docs" / "images"

# One LED is CELL pixels square in the picture, the lit dot DOT across. Small
# enough that the 72x16 panel fits GitHub's column (576 + bezel), large enough
# that each LED reads as a dot rather than a pixel.
CELL = 8
DOT = 6
PAD = 14  # bezel around the matrix
SUPERSAMPLE = 4

BACKGROUND = (13, 17, 23)  # GitHub's dark canvas, so the bezel sits on either theme
BEZEL = (6, 8, 10)
BEZEL_EDGE = (40, 46, 54)
UNLIT = (24, 29, 36)

# The device plays at 60 fps. Every second frame is plenty for a picture and
# halves the file; 30 ms is a delay every browser honours (below 20 ms some
# clamp to 100 ms, and the animation crawls).
FRAME_STEP = 2
FRAME_MS = 30
WEBP_QUALITY = 70

# A budget, not a limit the formats impose: see the module docstring.
MAX_BYTES = 300 * 1024

SCENES = {
    "lunch": "lunch_sandwich_72x16",
    "away": "away_coffee_72x16",
    "meeting": "meeting_table_72x16",
    "task-started": "task_started_72x16",
    "task-logged": "task_logged_72x16",
    "task-done": "task_done_72x16",
    "eod": "eod_moon_72x16",
}


def _dot_mask(size):
    """An antialiased disc, drawn large and scaled down."""
    big = Image.new("L", (size * SUPERSAMPLE, size * SUPERSAMPLE), 0)
    ImageDraw.Draw(big).ellipse((0, 0, size * SUPERSAMPLE - 1, size * SUPERSAMPLE - 1), fill=255)
    return big.resize((size, size), Image.LANCZOS)


_MASK = _dot_mask(DOT)
_GLOW_MASK = _dot_mask(CELL + 2)


def _matrix_size(width, height):
    return (PAD * 2 + width * CELL, PAD * 2 + height * CELL)


def _bezel(width, height):
    """The panel with every LED off: the plate each frame is drawn onto."""
    size = _matrix_size(width, height)
    plate = Image.new("RGB", size, BACKGROUND)
    big = Image.new("RGB", (size[0] * SUPERSAMPLE, size[1] * SUPERSAMPLE), BACKGROUND)
    ImageDraw.Draw(big).rounded_rectangle(
        (0, 0, big.width - 1, big.height - 1),
        radius=10 * SUPERSAMPLE,
        fill=BEZEL,
        outline=BEZEL_EDGE,
        width=2 * SUPERSAMPLE,
    )
    plate = big.resize(size, Image.LANCZOS)
    inset = (CELL - DOT) // 2
    for y in range(height):
        for x in range(width):
            plate.paste(UNLIT, (PAD + x * CELL + inset, PAD + y * CELL + inset), _MASK)
    return plate


_PLATES = {}


def render(pixels, width, height):
    """
    One frame of the panel.

    `pixels` is a row-major list of (r, g, b, a). A pixel with no alpha, or
    pure black, is an LED that is off -- on the device those are the same thing.
    """
    key = (width, height)
    if key not in _PLATES:
        _PLATES[key] = _bezel(width, height)
    frame = _PLATES[key].copy()
    glow = Image.new("RGB", frame.size, (0, 0, 0))
    inset = (CELL - DOT) // 2
    glow_inset = (CELL - _GLOW_MASK.width) // 2
    dots = []
    for i, (r, g, b, a) in enumerate(pixels):
        x, y = i % width, i // width
        at = (PAD + x * CELL + inset, PAD + y * CELL + inset)
        if a < 8 or r + g + b == 0:
            dots.append((UNLIT, at))
            continue
        if a < 255:
            # Transparent edges of a scene composite over black, as on the panel.
            r, g, b = (r * a // 255, g * a // 255, b * a // 255)
        glow.paste((r, g, b), (PAD + x * CELL + glow_inset, PAD + y * CELL + glow_inset), _GLOW_MASK)
        dots.append(((r, g, b), at))
    # A soft bloom between the dots, as a lit LED bleeds into its neighbours.
    # Laid under the dots, not over them: an LED that is off stays dark however
    # bright its neighbours, or the dark letters inside the paused screen's
    # FINISH bar drown in the bar's own glow.
    bloom = glow.filter(ImageFilter.GaussianBlur(4)).point(lambda v: v * 6 // 10)
    frame = ImageChops.add(frame, bloom)
    for colour, at in dots:
        frame.paste(colour, at, _MASK)
    return frame


def read_frames(folder):
    """The PNG frames of one animation in `Animations/`, and its frame rate."""
    inner = folder / folder.name
    meta = json.loads((inner / "meta.json").read_text(encoding="utf-8"))
    paths = sorted(inner.glob("frame_*.png"))
    if not paths:
        raise SystemExit(f"{inner} holds no frames -- is Git LFS installed? (README, Git LFS is mandatory)")
    with Image.open(paths[0]) as first:
        if first.size[0] < 2:
            raise SystemExit(f"{paths[0]} is not an image -- an LFS pointer file?")
    return paths, meta.get("fps", 60)


def _pixels(image):
    return list(image.convert("RGBA").getdata())


def save_anim(frames, durations, name):
    """
    Saves an animated WebP, or a PNG when every frame is the same picture.

    WebP rather than GIF: the bloom under each LED is hundreds of distinct
    colours, which a GIF palette either bands or pays for -- the Away scene
    was a megabyte as a GIF and is 150 KB here, at the same frame rate. Lossy
    at quality 70 is indistinguishable at this size; GitHub and every current
    browser play it.
    """
    if len(frames) == 1 or all(ImageChops.difference(frames[0], f).getbbox() is None for f in frames[1:]):
        path = OUT / f"{name}.png"
        frames[0].save(path, optimize=True)
        return path
    path = OUT / f"{name}.webp"
    frames[0].save(
        path,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        quality=WEBP_QUALITY,
        method=6,
        minimize_size=True,
    )
    return path


def scene_clip(short, folder_name):
    paths, fps = read_frames(ANIMATIONS / folder_name)
    picked = paths[::FRAME_STEP]
    frames = []
    for p in picked:
        with Image.open(p) as im:
            frames.append(render(_pixels(im), im.width, im.height))
    step_ms = round(1000 * FRAME_STEP / fps)
    return save_anim(frames, [max(step_ms, FRAME_MS)] * len(frames), f"bar-scene-{short}")


def icon_clips():
    """
    Every animated icon, one clip each, over its own whole loop.

    One clip per icon rather than a sheet of all of them: a sheet has to pick
    one length for thirteen loops, so most of them would jump at its end --
    and STYLE-GUIDE.md's rule is that a loop ends on its first frame. It was
    also a megabyte.
    """
    written = []
    for folder in sorted(p for p in ANIMATIONS.glob("icon_*_16x16") if p.is_dir()):
        short = folder.name.replace("icon_", "").replace("_16x16", "").replace("_", "-")
        paths, fps = read_frames(folder)
        frames = []
        for p in paths[::FRAME_STEP]:
            with Image.open(p) as im:
                frames.append(render(_pixels(im), im.width, im.height))
        step_ms = round(1000 * FRAME_STEP / fps)
        written.append(save_anim(frames, [max(step_ms, FRAME_MS)] * len(frames), f"bar-icon-{short}"))
    return written


def _clip_frames(frames_dir, name):
    """One recorded clip as rendered frames and their durations."""
    clip = json.loads((Path(frames_dir) / f"{name}.json").read_text(encoding="utf-8"))
    rows = clip["frames"]
    frames, durations = [], []
    for i, row in enumerate(rows):
        hexes = row["px"]
        pixels = [
            (int(hexes[j : j + 2], 16), int(hexes[j + 2 : j + 4], 16), int(hexes[j + 4 : j + 6], 16), 255)
            for j in range(0, len(hexes), 6)
        ]
        frames.append(render(pixels, 72, 16))
        nxt = rows[i + 1]["t"] if i + 1 < len(rows) else row["t"] + clip.get("holdMs", 1000)
        durations.append(max(int(nxt - row["t"]), FRAME_MS))
    return frames, durations


def _cut(frames, durations, ms):
    """The first `ms` of a clip, holding its last frame if it is shorter."""
    out_f, out_d, total = [], [], 0
    for f, d in zip(frames, durations):
        d = min(d, ms - total)
        out_f.append(f)
        out_d.append(d)
        total += d
        if total >= ms:
            break
    if total < ms:
        out_d[-1] += ms - total
    return out_f, out_d


# The README's opening picture: a working day on the bar in eight seconds.
HERO = [("captured", "tracking", 2200), ("captured", "unity-compile", 2000),
        ("scene", "lunch", 2600), ("captured", "banner", 1800)]


def hero(frames_dir):
    frames, durations = [], []
    for kind, name, ms in HERO:
        if kind == "captured":
            f, d = _clip_frames(frames_dir, name)
        else:
            paths, fps = read_frames(ANIMATIONS / SCENES[name])
            f = []
            for p in paths[::FRAME_STEP]:
                with Image.open(p) as im:
                    f.append(render(_pixels(im), im.width, im.height))
            d = [max(round(1000 * FRAME_STEP / fps), FRAME_MS)] * len(f)
        f, d = _cut(f, d, ms)
        frames.extend(f)
        durations.extend(d)
    return save_anim(frames, durations, "bar-hero")


def captured(frames_dir):
    """
    The screens capture-app.js recorded.

    Each file holds the frames the app sent its emulator, with the moment each
    arrived. The clip keeps those gaps, so it runs at the app's own pace: a
    stopwatch hand ticks once a second because the app redrew it once a second.
    """
    written = []
    for path in sorted(Path(frames_dir).glob("*.json")):
        if not json.loads(path.read_text(encoding="utf-8"))["frames"]:
            print(f"  {path.name}: no frames, skipped")
            continue
        frames, durations = _clip_frames(frames_dir, path.stem)
        written.append(save_anim(frames, durations, f"bar-{path.stem}"))
    if all((Path(frames_dir) / f"{name}.json").exists() for kind, name, _ in HERO if kind == "captured"):
        written.append(hero(frames_dir))
    return written


def shrink_screenshots():
    """
    Quantises the app's screenshots to a 256-colour palette, in place.

    The interface is a handful of flat colours and antialiased text, which a
    palette keeps indistinguishable at a third of the size -- about 35 KB a
    panel instead of 110. Already paletted files pass through unchanged.
    """
    written = []
    for path in sorted(OUT.glob("app-*.png")):
        with Image.open(path) as im:
            if im.mode == "P":
                written.append(path)
                continue
            paletted = im.convert("RGB").quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        paletted.save(path, optimize=True)
        written.append(path)
    return written


def main():
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("--frames", help="directory of JSON clips written by capture-app.js")
    parser.add_argument("--only", help="comma-separated: scenes, icons, captured, screenshots")
    args = parser.parse_args()
    only = set(args.only.split(",")) if args.only else {"scenes", "icons", "captured", "screenshots"}
    OUT.mkdir(parents=True, exist_ok=True)

    written = []
    if "scenes" in only:
        for short, folder in SCENES.items():
            written.append(scene_clip(short, folder))
    if "icons" in only:
        written.extend(icon_clips())
    if "captured" in only and args.frames:
        written.extend(captured(args.frames))
    if "screenshots" in only:
        written.extend(shrink_screenshots())

    over = False
    for path in written:
        size = path.stat().st_size
        flag = "  OVER BUDGET" if size > MAX_BYTES else ""
        over = over or bool(flag)
        print(f"  {path.relative_to(ROOT)}  {size // 1024} KB{flag}")
    if over:
        sys.exit(f"An image is over {MAX_BYTES // 1024} KB; see MAX_BYTES.")


if __name__ == "__main__":
    main()
