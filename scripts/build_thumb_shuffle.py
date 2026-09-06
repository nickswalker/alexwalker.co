#!/usr/bin/env python3
"""Build-time analysis + derivative generation for the homepage thumbnail shuffle.

For every project tile in the NARRATIVE and COMMERCIAL grids that has more than
one still in its lightbox, this:

  1. reads the tile's still list from the single source of truth
     (RICH_CONFIG in js/lightbox.js, plus _data/tll.yml for the TLL entry),
     minus anything opted out in _data/shuffle_exclusions.yml,
  2. strips any baked-in letterbox/pillarbox padding (see detect_bars) and
     writes a FULL-WIDTH, CENTRED VERTICAL crop at the tile's aspect ratio into
     img/shuffle/<key>/ — originals are never touched,
  3. runs each still through Apple's Vision framework (scripts/vision_probe.swift)
     for face rectangles + head yaw, and turns those into a per-frame FACING
     and CLOSE-UP signal used only to order the shuffle,
  4. measures the CROP (not the original) for palette, luminance, contrast and
     composition, and
  5. emits _data/thumb_shuffle.json (canonical) and data/thumb-shuffle.json
     (fetched by js/thumb-shuffle.js at runtime).

THE CROP RULE, which overrides everything else in this file:

    The horizontal composition of a frame is the cinematographer's decision.
    This script does not get a vote. Every derivative keeps 100% of the
    source's PICTURE width — no horizontal crop, no pan, no zoom, no upscale —
    and reaches the tile's aspect ratio by removing an EQUAL number of rows
    from the top and the bottom. Nothing about the picture content moves the
    window. Faces and saliency are read for SELECTION ORDERING ONLY (see
    facing_signal); if you are ever tempted to feed them back into the
    geometry, don't.

    "Picture" is the operative word: black the frame was PADDED with is not
    picture, and detect_bars takes it off before any of the above runs. That
    is the one thing allowed to change the window, and it only ever gives
    picture back — it never takes any.

    THE ESCAPE HATCH, which is Alex's call and never the script's (2026-09-05):
    a still may be named in _data/shuffle_crop.yml with a vertical anchor, and
    then the rows it has to lose come off asymmetrically — `top` spends the
    whole trim on the bottom, `bottom` on the top, a number in 0..1 splits it.
    ABSENT AN ENTRY THE CROP IS CENTRED, so this changes no frame Alex has not
    named. It also cannot do anything but slide: the kept height, the full
    width and the no-zoom rule are computed before the anchor is consulted,
    and both this file and scripts/verify_thumb_crops.py fail the run if an
    anchored window comes out a different size from the centred one it
    replaced. Existence of the hatch is not a licence to infer an anchor from
    the picture — Vision data is as unwelcome here as it is everywhere else.

    THE ONE EXCEPTION, and it is Alex's call, not this script's (2026-09-05):
    a COMMERCIAL still whose picture is WIDER than its 16:9 cell is centre-
    cropped horizontally to the cell ratio — equal columns off left and right,
    full height kept, no zoom, no vertical shift. Alex accepts losing the
    sides on those frames because the alternative is what the layout was
    doing: letterboxing a 2.39:1 delivery into a 16:9 cell and painting black
    across the top and bottom of the tile. The exception is narrow on purpose:

      * COMMERCIAL only. Narrative cells are 2.35 and the scope frames that
        overhang them do so by ~1.6%; they keep the full-width rule, and a
        narrative frame wider than its cell is REPORTED and left alone.
      * Only frames that are actually wider than the cell. A frame already at
        or under the cell ratio is untouched by this and takes the vertical
        trim exactly as before.
      * Still symmetric, still content-blind. see centred_crop: it takes the
        dimensions and the target ratio and nothing else. Vision data is no
        more welcome in the horizontal decision than it ever was in the
        vertical one — the crop is centred because centred is the only
        defensible answer, not because anything in the frame asked for it.

All the expensive work happens here. The browser only ever reads the JSON.

Usage:  python3 scripts/build_thumb_shuffle.py [--verify]
"""

import colorsys
import hashlib
import json
import re
import shutil
import subprocess
import sys
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PROBE = ROOT / "scripts" / ".bin" / "vision_probe"
OUT_IMG = ROOT / "img" / "shuffle"
DATA_JSON = ROOT / "data" / "thumb-shuffle.json"
SITE_DATA_JSON = ROOT / "_data" / "thumb_shuffle.json"
EXCLUSIONS_YML = ROOT / "_data" / "shuffle_exclusions.yml"

# Tile geometry. Narrative cells are locked to 2.35:1 by
# `.narrative-cinema li > a` in css/style.css; the commercial grid keeps the
# 16:9 the existing thumbnails already use.
GEOMETRY = {
    "narrative": {"aspect": 2.35, "width": 1152},
    "commercial": {"aspect": 16 / 9, "width": 1152},
}
JPEG_QUALITY = 82

# --- facing / close-up thresholds (SELECTION ONLY — never crop geometry) ---
# Below this much head turn the subject reads as frontal, which is not a
# direction. ~17 degrees. Measured on this corpus, yaw agrees with the
# lookroom convention 74% of the time above 0.20 rad but 85-100% above 0.30,
# so the threshold sits where the signal is actually trustworthy — a frame
# we're unsure about is better called neutral than called wrong.
FACING_YAW = 0.30
# Calibration uses only unmistakable head turns (~26 degrees), where the
# lookroom cross-check is itself reliable.
CALIB_YAW = 0.45
# A face taller than this fraction of the CROP height is a tight close-up.
TIGHT_FACE = 0.42
# Two faces within this area ratio count as co-equal subjects; if they disagree
# about direction the frame has no single facing.
CO_SUBJECT_RATIO = 1.6


# ---------------------------------------------------------------- source data

@lru_cache(maxsize=None)
def _digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def load_rich_config():
    """Extract `key -> [frame, ...]` from RICH_CONFIG in js/lightbox.js.

    lightbox.js is the one place the still lists live; duplicating them into a
    YAML file here would guarantee they drift. The TLL entry is a Liquid loop
    over _data/tll.yml, so it is resolved from that file directly.
    """
    src = (ROOT / "js" / "lightbox.js").read_text()
    body = src[src.index("export const RICH_CONFIG = {"):]
    body = body[: body.index("\n};") + 3]

    config = {}
    # Split on top-level `    key: {` entries.
    for m in re.finditer(r"\n    (\w+):\s*\{", body):
        key = m.group(1)
        start = m.end() - 1
        depth, i = 0, start
        while i < len(body):
            if body[i] == "{":
                depth += 1
            elif body[i] == "}":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        entry = body[start : i + 1]

        fm = re.search(r"frames:\s*\[(.*?)\n\s*\],", entry, re.S)
        if not fm:
            config[key] = {"title": _title(entry), "frames": []}
            continue

        frames = []
        for line in fm.group(1).splitlines():
            line = line.strip()
            if not line or line.startswith("//") or line.startswith("{%"):
                continue
            # Object form: { src: '/x.jpg', aspect: '…', alt: '…' }
            om = re.search(r"src:\s*['\"]([^'\"]+)['\"]", line)
            if om:
                alt = re.search(r"alt:\s*['\"](.*?)['\"]\s*[,}]", line)
                frames.append({"src": om.group(1), "alt": alt.group(1) if alt else None})
                continue
            # Bare string form: '/img/hoa/frame1.jpg',
            sm = re.match(r"['\"]([^'\"]+)['\"],?$", line)
            if sm:
                frames.append({"src": sm.group(1), "alt": None})
        config[key] = {"title": _title(entry), "frames": frames}

    # TLL's frames are Liquid-generated; read the real list from _data/tll.yml.
    config.setdefault("tll", {"title": "", "frames": []})
    config["tll"]["frames"] = load_tll_frames()
    config["tll"]["title"] = tll_title()
    return config


def _title(entry):
    m = re.search(r"title:\s*['\"](.*?)['\"]", entry)
    return m.group(1) if m else ""


def _yaml_scalar(raw):
    raw = raw.strip()
    if len(raw) >= 2 and raw[0] in "'\"" and raw[-1] == raw[0]:
        inner = raw[1:-1]
        return inner.replace("''", "'") if raw[0] == "'" else inner
    # Unquoted scalar: a " #" ends it and starts a comment. Jekyll parses these
    # same _data files as real YAML, so this reader has to agree with it —
    # otherwise an annotated entry silently becomes a path that matches nothing.
    return re.split(r"\s+#", raw, 1)[0].strip()


def load_tll_frames():
    """Minimal reader for the `frames:` list in _data/tll.yml (src + alt)."""
    text = (ROOT / "_data" / "tll.yml").read_text()
    frames, cur, in_frames = [], None, False
    for line in text.splitlines():
        if re.match(r"^frames:\s*$", line):
            in_frames = True
            continue
        if in_frames and line and not line.startswith((" ", "-", "\t")):
            break
        if not in_frames:
            continue
        m = re.match(r"^\s*-\s*src:\s*(.+)$", line)
        if m:
            if cur:
                frames.append(cur)
            cur = {"src": _yaml_scalar(m.group(1)), "alt": None}
            continue
        m = re.match(r"^\s*alt:\s*(.+)$", line)
        if m and cur:
            cur["alt"] = _yaml_scalar(m.group(1))
    if cur:
        frames.append(cur)
    return frames


def tll_title():
    for line in (ROOT / "_data" / "tll.yml").read_text().splitlines():
        m = re.match(r"^title:\s*(.+)$", line)
        if m:
            return _yaml_scalar(m.group(1))
    return "Texas Legacy in Lights"


GRID_PATTERNS = (
    ("narrative", r'<ul class="thumbnails lightbox playbuttons narrative-cinema">(.*?)</ul>'),
    ("commercial", r"<h3>Commercial [^<]*Documentary Work</h3>(.*?)</ul>"),
)

# The anchor + its <img>, so we can read (and later rewrite) the tile's own
# server-rendered thumbnail.
TILE_RE = re.compile(r'data-rich="(\w+)"[^>]*>\s*(?:<[^/][^>]*>\s*)*?<img\b([^>]*)>', re.S)
SRC_RE = re.compile(r'\bsrc="([^"]+)"')


def load_tile_order():
    """Read on-page tile order, section, and each tile's current <img src>.

    The thumbnail Alex chose for a tile is a still too — it belongs in that
    tile's rotation, and cropping it at build time is what lets the page stop
    shipping the uncropped original.

    Returns (order, thumbs, rewritten) where `rewritten` is the set of tiles
    whose <img src> a previous run already pointed at a generated crop — the
    only tiles that could need their authored thumbnail put back.
    """
    html = (ROOT / "index.html").read_text()
    order, thumbs, was_rewritten = [], {}, set()
    for section, pat in GRID_PATTERNS:
        m = re.search(pat, html, re.S)
        if not m:
            sys.exit(f"index.html parse failed for the {section} grid — markup moved")
        keys = []
        for key, attrs in TILE_RE.findall(m.group(1)):
            keys.append(key)
            s = SRC_RE.search(attrs)
            if s:
                thumbs[key] = s.group(1)
        order.append((section, keys))

    # A previous run rewrote these srcs to point at its own crops. Recover the
    # authored thumbnail from that run's manifest so re-running the build is
    # idempotent instead of quietly dropping each tile's own thumbnail out of
    # its rotation.
    if SITE_DATA_JSON.exists():
        prior = json.loads(SITE_DATA_JSON.read_text()).get("tiles", {})
        for key, src in list(thumbs.items()):
            if src.lstrip("/").startswith("img/shuffle/"):
                was_rewritten.add(key)
                orig = (prior.get(key) or {}).get("originalThumb")
                # Never accept a previously-rewritten path as the "original".
                if orig and orig.lstrip("/").startswith("img/shuffle/"):
                    orig = None
                if orig:
                    thumbs[key] = orig
                else:
                    del thumbs[key]
    return order, thumbs, was_rewritten


def rewrite_index_srcs(mapping):
    """Point each tile's server-rendered <img src> at its build-time crop.

    Idempotent: the mapping is keyed by data-rich, and rewriting an already-
    rewritten src is a no-op. The pre-existing path is recorded in
    _data/thumb_shuffle.json under `originalThumb` so this is reversible.
    """
    path = ROOT / "index.html"
    html = path.read_text()
    changed = 0

    def sub_block(block):
        nonlocal changed
        def fix(m):
            nonlocal changed
            key, attrs = m.group(1), m.group(2)
            new = mapping.get(key)
            if not new:
                return m.group(0)
            s = SRC_RE.search(attrs)
            if not s or s.group(1) == new.lstrip("/"):
                return m.group(0)
            newattrs = attrs[: s.start(1)] + new.lstrip("/") + attrs[s.end(1):]
            changed += 1
            return m.group(0)[: m.start(2) - m.start(0)] + newattrs + ">"
        return TILE_RE.sub(fix, block)

    for _, pat in GRID_PATTERNS:
        m = re.search(pat, html, re.S)
        html = html[: m.start(1)] + sub_block(m.group(1)) + html[m.end(1):]

    path.write_text(html)
    return changed


# ------------------------------------------------------------------- analysis

def run_vision(paths):
    payload = "\n".join(str(p) for p in paths) + "\n"
    proc = subprocess.run([str(PROBE)], input=payload, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.exit(f"vision_probe failed: {proc.stderr}")
    out = {}
    for line in proc.stdout.splitlines():
        if line.strip():
            rec = json.loads(line)
            out[rec["path"]] = rec
    return out


# ------------------------------------------------- baked-in padding removal
#
# A few source stills are delivery frames that were PADDED to a different
# container ratio before being saved, so the black is in the file rather than
# in the shot. Left alone, the centred vertical trim below spends its rows on
# that padding instead of on picture, and any padding the trim doesn't happen
# to reach survives into the tile as a black edge.
#
# So padding comes off FIRST and the trim then runs on the recovered picture
# exactly as it always has. This is padding removal, not reframing: what comes
# back is the WHOLE picture area, nothing is scaled or repositioned, and no
# picture content — face, saliency or otherwise — has any say in it.

# Every pixel in a bar must sit at or below this luminance (0-255). Bars are
# regularly crushed-near-black rather than 0,0,0, so this is a tolerance and
# not an equality test.
BAR_TOL = 26.0
# ...and the first line of picture must be at least this much brighter. A
# padded edge STOPS, abruptly. A shot that merely falls off into shadow at the
# border has no such step, and that darkness is the frame, not padding.
BAR_STEP = 30.0
# Opposite bars must BOTH be present and agree to within this many pixels.
# Padding is applied symmetrically, so a one-sided dark run is a dark part of
# the shot — a night exterior that falls off to black at frame left, say. A
# genuinely one-sided pad is indistinguishable from that, so it is left on:
# this file would rather ship a bar than invent a reframe.
BAR_SYMMETRY = 2
# ...and each side must be at least this thick. Encoders leave the odd single
# crushed scan line at an edge (img/comm_earthspeed/frame1.jpg has one); that
# is a compression artefact, not a delivery pad, and trimming it would count
# as touching a frame that has no bars.
BAR_MIN = 3
# Hard ceiling on how much of a dimension can be called padding.
BAR_MAX_FRAC = 0.40
# A line at the bar/picture boundary counts as a half-mixed BLEND line — and
# comes off with the bar — while it is below this fraction of the brightness
# of the picture just behind it. A real first line of picture sits at roughly
# 1.0 of its neighbours; the blend lines in img/attad/frame3.jpg sit at 0.52
# and 0.50. 0.6 clears both with room to spare and still leaves a wide margin
# before it could reach picture. This only ever runs on a frame already proven
# to be padded, so it cannot pull rows off an unpadded frame.
BAR_BLEND_FRAC = 0.6


def _bar_run(line_max, line_p90):
    """Length of the leading run of pure-padding lines, or 0 if there is none.

    `line_max` is the brightest pixel in each line, so a line only counts as
    padding when the WHOLE line is dark — one lit pixel disqualifies it. The
    step test then uses the 90th percentile of the first surviving line, which
    is robust to a soft encode boundary without being fooled by a stray
    highlight.

    The run is then extended over up to two BLEND lines. Whatever rescaled
    these frames left a partially-mixed line where the bar met the picture —
    in img/attad/frame3.jpg, 62 rows of exact 0, then a row peaking at 61,
    then picture at 126. That line is too bright to count as padding above and
    too dark to be picture, and leaving it on ships a grey smear along the
    tile edge: the very defect the bar removal is here to fix. A line is
    absorbed only when it is still under half as bright as the picture behind
    it, which a genuine first line of picture never is.
    """
    n = len(line_max)
    k = 0
    while k < n and line_max[k] <= BAR_TOL:
        k += 1
    if k == 0 or k >= n:
        return 0
    if line_p90[k] - line_max[:k].max() < BAR_STEP:
        return 0
    for _ in range(2):
        if k + 11 >= n:
            break
        if line_p90[k] < BAR_BLEND_FRAC * float(np.median(line_p90[k + 1:k + 11])):
            k += 1
        else:
            break
    return k


def detect_bars(im):
    """Baked-in padding thickness as (top, bottom, left, right) pixels.

    Measured per frame, never hardcoded. Deliberately conservative in both
    directions: anything this can't prove is padding it reports as no padding,
    because leaving a bar on is a cosmetic problem while trimming picture is a
    reframe — and reframing is the one thing this script must never do.
    """
    rgb = np.asarray(im.convert("RGB")).astype(np.float32)
    lum = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    h, w = lum.shape
    rmax, rp90 = lum.max(axis=1), np.percentile(lum, 90, axis=1)
    cmax, cp90 = lum.max(axis=0), np.percentile(lum, 90, axis=0)

    def paired(lead, tail, span):
        # Both sides, both thick enough, and the same size to within a
        # rounding pixel — otherwise this is not padding and nothing comes off.
        # Returning min() for both keeps the removal exactly symmetric, so the
        # picture's centre cannot move even by half a pixel, and errs toward
        # leaving a row of padding on rather than taking a row of picture off.
        if min(lead, tail) < BAR_MIN or abs(lead - tail) > BAR_SYMMETRY:
            return 0, 0
        # And no amount of evidence justifies surrendering this much of a
        # dimension — past here something has gone wrong with the measurement,
        # and the safe failure is to leave the frame exactly as it arrived.
        if 2 * min(lead, tail) > BAR_MAX_FRAC * span:
            return 0, 0
        return min(lead, tail), min(lead, tail)

    top, bottom = paired(_bar_run(rmax, rp90),
                         _bar_run(rmax[::-1], rp90[::-1]), h)
    left, right = paired(_bar_run(cmax, cp90),
                         _bar_run(cmax[::-1], cp90[::-1]), w)
    return top, bottom, left, right


def _edge_luma(im):
    """Mean luminance of the outermost row/column on each side.

    Reported rather than thresholded: it's the raw number that says whether a
    tile edge is black, and a repaired frame's edges should read as picture.
    """
    a = np.asarray(im.convert("RGB")).astype(np.float32)
    lum = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    return {"top": float(lum[0].mean()), "bottom": float(lum[-1].mean()),
            "left": float(lum[:, 0].mean()), "right": float(lum[:, -1].mean())}


def strip_bars(im):
    """(picture, bars) — the frame with its padding removed, and what came off."""
    bars = detect_bars(im)
    if not any(bars):
        return im, bars
    top, bottom, left, right = bars
    w, h = im.size
    return im.crop((left, top, w - right, h - bottom)), bars


def _symmetric_extent(span, ideal):
    """Largest-fitting extent that leaves an EQUAL cut on both sides.

    A symmetric cut requires the kept extent to have the same parity as the
    span, so `ideal` is snapped to the NEAREST value of that parity rather
    than simply rounded down — for a 1600x669 scope frame in a 16:9 cell the
    ideal width is 1189.33, and 1190 (error 0.67px) beats 1188 (error 1.33px)
    and happens to be the one that lands on an exact 1152x648 after the
    delivery downscale. Never returns more than the span.
    """
    lo = min(int(ideal) - ((int(ideal) - span) % 2), span)
    hi = min(lo + 2, span)
    keep = hi if abs(hi - ideal) < abs(lo - ideal) and hi <= span else lo
    return max(keep, 2 if span >= 2 else 1)


def centred_crop(w, h, aspect, allow_horizontal=False, anchor=None):
    """Centre the picture in the tile's ratio. Geometry only — see THE CROP RULE.

    Takes only the source dimensions, the target ratio, and an OPTIONAL
    per-frame vertical anchor Alex set by hand in _data/shuffle_crop.yml — no
    image content, no Vision data, because there is still no input the machine
    could read that would legitimately move this window. Returns (box,
    rows_off_top, rows_off_bottom, cols_off_left, cols_off_right).

    `anchor` is None for every frame that isn't named in that file, and None
    reproduces the old behaviour exactly. When it is a float in 0..1 it is the
    fraction of the trim taken off the TOP: 0.0 flush top, 0.5 centred (byte
    identical to None), 1.0 flush bottom. It changes only the SPLIT — the kept
    height, the full width, and the absence of any zoom are computed first and
    are not the anchor's to touch.

    Three cases:

      * Source TALLER than the tile (a 16:9 or 4:3 still in a 2.35 cell):
        keep the full width, trim to `w / aspect` rows, equally off the top
        and the bottom. The default, and the only case for narrative.
      * Source WIDER than the tile, `allow_horizontal` (commercial only):
        keep every row, take `(w - h*aspect)` columns off — half from each
        side. This is the exception Alex authorised; nothing else may use it.
      * Source WIDER than the tile, `allow_horizontal` false (narrative
        scope frames): there are no spare rows to remove and cutting width is
        not this function's decision to make. The frame is emitted whole and
        CSS handles the last ~1.6%, centred and symmetric as before.

    The removed count is forced EVEN in whichever axis is cut, so the two
    sides are exactly equal by arithmetic rather than by rounding. That costs
    at most one pixel of extent, and the picture's centre cannot move.
    """
    if allow_horizontal and w > h * aspect:
        tw = _symmetric_extent(w, h * aspect)
        cut = (w - tw) // 2
        return (cut, 0, cut + tw, h), 0, 0, cut, cut

    th = min(h, int(round(w / aspect)))
    if (h - th) % 2:
        th -= 1
    th = max(th, 1)
    slack = h - th
    if anchor is None:
        trim = slack // 2
        return (0, trim, w, trim + th), trim, trim, 0, 0
    # An anchored frame keeps the SAME window height and width; only the split
    # moves. The parity snap above is a symmetry device, so it is harmless
    # here and kept so an anchored frame and its centred twin are the same size.
    top = min(max(int(round(slack * anchor)), 0), slack)
    return (0, top, w, top + th), top, slack - top, 0, 0


def scale_to_width(crop, max_width):
    """Downscale to the tile's delivery width. Never upscales."""
    w, h = crop.size
    if w <= max_width:
        return crop
    # Height follows width exactly, so the crop's own ratio is preserved —
    # a wider-than-2.35 scope frame must not be squashed into 2.35.
    return crop.resize((max_width, max(1, int(round(h * max_width / w)))), Image.LANCZOS)


# ----------------------------------------- facing + close-up (SELECTION ONLY)
#
# These two numbers exist so the shuffle stops putting two tight close-ups of
# people looking the same way on top of each other. They are consumed by
# scoreCandidate() in js/thumb-shuffle.js and by nothing else. They are
# computed AFTER the crop box is fixed and are never passed back into it.

def _face_px(f, w, h):
    """Face box in pixels, clamped to the frame (Vision overruns clipped heads)."""
    x0 = max(f["x"] * w, 0.0)
    y0 = max(f["y"] * h, 0.0)
    x1 = min((f["x"] + f["w"]) * w, float(w))
    y1 = min((f["y"] + f["h"]) * h, float(h))
    return x0, y0, max(x1 - x0, 0.0), max(y1 - y0, 0.0)


def calibrate_yaw_sign(vision):
    """Work out which yaw sign means "facing screen-left", from the corpus.

    Vision documents yaw in radians but not in terms of screen direction, and
    guessing wrong would invert the whole constraint. So: take every frame
    with exactly one clearly-turned, clearly-off-centre face and compare the
    yaw sign against the lookroom convention — a subject placed right of
    centre is framed that way because they are looking screen-left. Whichever
    mapping the corpus agrees with wins.

    Returns (sign, agreement, sample_size); `sign` multiplies yaw so that a
    positive product means screen-left.
    """
    agree = total = 0
    for rec in vision.values():
        faces = rec.get("faces") or []
        if len(faces) != 1:
            continue                      # two-shots have no single lookroom
        yaw = faces[0].get("yaw")
        if yaw is None or abs(yaw) < CALIB_YAW:
            continue
        cx = faces[0]["x"] + faces[0]["w"] / 2
        if abs(cx - 0.5) < 0.10:
            continue                      # centred: lookroom says nothing
        total += 1
        if (yaw < 0) == (cx > 0.5):       # hypothesis: negative yaw = screen-left
            agree += 1
    if not total:
        return -1, 0.0, 0
    sign = -1 if agree * 2 >= total else 1
    return sign, max(agree, total - agree) / total, total


def facing_signal(vis, box, w, h, sign):
    """(facing, tightness) for one frame.

    facing is 'left' | 'right' | 'neutral', from the head yaw of the largest
    detected face. Frames with no face, a frontal face, or two co-equal
    subjects looking opposite ways are NEUTRAL — the constraint should only
    fire when the direction is unambiguous.

    tightness is that face's height as a fraction of the CROP height, which is
    what a visitor actually sees in the tile.
    """
    crop_h = box[3] - box[1]
    faces = []
    for f in vis.get("faces") or []:
        fx, fy, fw, fh = _face_px(f, w, h)
        if fw > 1 and fh > 1:
            faces.append((fw * fh, fh, f.get("yaw")))
    if not faces:
        return "neutral", 0.0

    faces.sort(reverse=True, key=lambda t: t[0])
    area, fh, yaw = faces[0]

    def direction(y):
        if y is None or abs(y) < FACING_YAW:
            return "neutral"
        return "left" if y * sign > 0 else "right"

    facing = direction(yaw)
    # A two-shot of people facing each other has no single facing.
    for other_area, _, other_yaw in faces[1:]:
        if other_area * CO_SUBJECT_RATIO < area:
            break
        od = direction(other_yaw)
        if od != "neutral" and facing != "neutral" and od != facing:
            facing = "neutral"
            break

    return facing, round(fh / max(crop_h, 1), 4)


# ------------------------------------------------------------------ exclusions

def load_exclusions():
    """Source stills opted out of the HOMEPAGE ROTATION only.

    Read here and nowhere else, which is what keeps an excluded still fully
    present in the lightbox: the lightbox's frame lists live in js/lightbox.js
    and _data/tll.yml and this build never edits them.
    """
    if not EXCLUSIONS_YML.exists():
        return set()
    out, in_list = set(), False
    for line in EXCLUSIONS_YML.read_text().splitlines():
        if re.match(r"^exclude_from_shuffle:\s*$", line):
            in_list = True
            continue
        if in_list and line.strip() and not line.startswith((" ", "-", "\t", "#")):
            break
        if not in_list:
            continue
        m = re.match(r"^\s*-\s+(.+?)\s*$", line)
        if m:
            val = _yaml_scalar(m.group(1))
            if val:
                out.add(val.lstrip("/"))
    return out


def load_thumb_pool_optin():
    """Tile keys whose AUTHORED THUMBNAIL counts toward the 2-still minimum.

    Read from _data/shuffle_thumb_pool.yml, which is keyed by TILE KEY (the
    `data-rich` value) rather than by still path — the other two shuffle data
    files are keyed by path, this one deliberately is not.

    Default OFF for every tile, and off is the behaviour this build has always
    had: the minimum is tested on the lightbox stills alone, so a tile that
    exclusions took to one still stops rotating even though its own thumbnail
    is a perfectly good second candidate. A tile listed here folds its
    thumbnail in FIRST and is then measured against the minimum. That is the
    only thing the flag moves — see fold_authored_thumb, which is the same
    code on both paths.
    """
    path = ROOT / "_data" / "shuffle_thumb_pool.yml"
    if not path.exists():
        return set()
    out, in_map = set(), False
    for line in path.read_text().splitlines():
        if re.match(r"^count_authored_thumb:\s*$", line):
            in_map = True
            continue
        if in_map and line.strip() and not line.startswith((" ", "\t", "#")):
            break
        if not in_map:
            continue
        m = re.match(r"^\s+([^#\s][^:]*?)\s*:\s*(.+?)\s*$", line)
        if not m:
            continue
        key = _yaml_scalar(m.group(1)).strip()
        raw = _yaml_scalar(m.group(2)).strip().strip("'\"").lower()
        if not key:
            continue
        if raw in ("true", "yes", "on"):
            out.add(key)
        elif raw in ("false", "no", "off"):
            continue
        else:
            print(f"  ! count_authored_thumb for '{key}' is '{raw}' — expected "
                  f"true or false; IGNORED", file=sys.stderr)
    return out


def load_never_adjacent():
    """Pairs of SOURCE stills that must never land next to each other.

    Read from _data/shuffle_never_adjacent.yml as a list of two-item lists.
    Returns [(a, b), ...] of source paths with any leading slash stripped —
    the same identifier _data/shuffle_exclusions.yml and _data/shuffle_crop.yml
    use, so one line covers a lightbox still or a tile's authored thumbnail
    without either consumer needing to know this file exists.

    Resolving those source paths to the generated crops the browser actually
    compares happens in build(), which is the only place that knows the
    mapping. Keeping this function to pure parsing means a typo is reported
    against the line Alex typed, not against a derivative path he never saw.
    """
    path = ROOT / "_data" / "shuffle_never_adjacent.yml"
    if not path.exists():
        return []
    out, in_list = [], False
    for line in path.read_text().splitlines():
        if re.match(r"^never_adjacent:\s*$", line):
            in_list = True
            continue
        if in_list and line.strip() and not line.startswith((" ", "-", "\t", "#")):
            break
        if not in_list:
            continue
        m = re.match(r"^\s*-\s*\[\s*(.+?)\s*,\s*(.+?)\s*\]\s*$", line)
        if not m:
            # A list entry that isn't a two-item pair is a mistake worth
            # naming — silently skipping it would look like the rule applied.
            if re.match(r"^\s*-\s+\S", line):
                print(f"  ! not a [a, b] pair: {line.strip()} — check "
                      f"_data/shuffle_never_adjacent.yml", file=sys.stderr)
            continue
        a = _yaml_scalar(m.group(1)).strip().strip("'\"").lstrip("/")
        b = _yaml_scalar(m.group(2)).strip().strip("'\"").lstrip("/")
        if a and b and a != b:
            out.append((a, b))
        elif a == b:
            print(f"  ! '{a}' is paired with itself — ignored", file=sys.stderr)
    return out


ANCHOR_WORDS = {"top": 0.0, "center": 0.5, "centre": 0.5, "middle": 0.5, "bottom": 1.0}


def load_crop_anchors():
    """Per-still vertical crop anchors from _data/shuffle_crop.yml.

    Returns `source path -> fraction of the trim taken off the top`. A still
    that isn't in the file isn't in the dict, and centred_crop treats a missing
    anchor and an explicit 0.5 as the same geometry — so the default is centred
    whether or not this file exists at all.

    Keyed by SOURCE path, exactly like _data/shuffle_exclusions.yml, which is
    what lets one line cover a lightbox still (js/lightbox.js, _data/tll.yml)
    or a tile's own authored thumbnail (index.html) without either consumer
    needing to know this file exists.
    """
    path = ROOT / "_data" / "shuffle_crop.yml"
    if not path.exists():
        return {}
    out, in_map = {}, False
    for line in path.read_text().splitlines():
        if re.match(r"^crop_y:\s*$", line):
            in_map = True
            continue
        if in_map and line.strip() and not line.startswith((" ", "\t", "#")):
            break
        if not in_map:
            continue
        m = re.match(r"^\s+([^#\s][^:]*?)\s*:\s*(.+?)\s*$", line)
        if not m:
            continue
        key = _yaml_scalar(m.group(1)).lstrip("/")
        raw = _yaml_scalar(m.group(2))
        if not key or not raw:
            continue
        word = raw.strip().strip("'\"").lower()
        if word in ANCHOR_WORDS:
            out[key] = ANCHOR_WORDS[word]
            continue
        try:
            val = float(word)
        except ValueError:
            print(f"  ! crop_y for '{key}' is '{raw}' — expected one of "
                  f"{sorted(ANCHOR_WORDS)} or a number 0..1; IGNORED",
                  file=sys.stderr)
            continue
        if not 0.0 <= val <= 1.0:
            print(f"  ! crop_y for '{key}' is {val} — out of range 0..1; "
                  f"IGNORED", file=sys.stderr)
            continue
        out[key] = val
    return out


def measure(img):
    """Palette / luminance / contrast / composition, measured on the crop."""
    small = img.convert("RGB").resize((80, 45), Image.LANCZOS)
    a = np.asarray(small).astype(np.float32) / 255.0

    lum = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    luminance = float(lum.mean())
    contrast = float(lum.std())

    # Dominant hue family: average the saturated pixels in HSV space, using a
    # circular mean so red (hue ~0/1) doesn't average to cyan.
    hsv = np.array([colorsys.rgb_to_hsv(*p) for p in a.reshape(-1, 3)])
    sat_mask = hsv[:, 1] >= 0.15
    if sat_mask.sum() >= 40:
        hues = hsv[sat_mask, 0] * 2 * np.pi
        weights = hsv[sat_mask, 1]
        hue = float((np.arctan2((np.sin(hues) * weights).sum(),
                                (np.cos(hues) * weights).sum()) % (2 * np.pi)) / (2 * np.pi))
    else:
        hue = 0.0
    saturation = float(hsv[:, 1].mean())

    # Edge density = mean gradient magnitude. High = busy/detailed frame,
    # low = clean/graphic frame. Used to keep adjacent tiles from all being
    # the same visual texture.
    gx = np.abs(np.diff(lum, axis=1)).mean()
    gy = np.abs(np.diff(lum, axis=0)).mean()
    edge = float((gx + gy) / 2)

    # Composition: where the visual mass sits horizontally (0 = left third,
    # 1 = right third), from luminance-contrast weighting.
    weight = np.abs(lum - lum.mean())
    cols = weight.sum(axis=0)
    balance = float((cols * np.arange(cols.size)).sum() / max(cols.sum(), 1e-6) / (cols.size - 1))

    top = float(lum[: lum.shape[0] // 2].mean())
    bottom = float(lum[lum.shape[0] // 2 :].mean())

    return {
        "rgb": [int(round(c * 255)) for c in a.reshape(-1, 3).mean(axis=0)],
        "hue": round(hue, 4),
        "saturation": round(saturation, 4),
        "luminance": round(luminance, 4),
        "contrast": round(contrast, 4),
        "edge": round(edge, 4),
        "balance": round(balance, 4),
        "topBottom": round(top - bottom, 4),
    }


# ---------------------------------------------------------------------- build

def build(verify=False):
    config = load_rich_config()
    order, thumbs, rewritten_keys = load_tile_order()
    excluded = load_exclusions()
    anchors = load_crop_anchors()
    thumb_pool_optin = load_thumb_pool_optin()
    never_pairs = load_never_adjacent()
    seen_excluded, seen_anchored, dropped_tiles = set(), set(), {}
    seen_optin, pool_counts = set(), {}

    def fold_authored_thumb(key, frames):
        """Put the tile's own thumbnail at the front of its rotation.

        The thumbnail Alex chose for a tile is a still too, so it belongs in
        that tile's pool — unless it is byte-identical to a still already in
        the list (TLL's thumbnail is its 5th still), in which case it is
        already there, or unless it is itself excluded.

        Called from exactly one of two places depending on
        _data/shuffle_thumb_pool.yml, and it is the SAME call either way: the
        flag changes only whether it runs before or after the 2-still minimum,
        never what it does.
        """
        own = thumbs.get(key)
        if not own:
            return frames
        if own.lstrip("/") in excluded:
            seen_excluded.add(own.lstrip("/"))
            return frames
        own_abs = ROOT / own.lstrip("/")
        if not own_abs.exists() or "/img/shuffle/" in own:
            return frames
        digest = _digest(own_abs)
        dupe = any(
            (ROOT / f["src"].lstrip("/")).exists()
            and _digest(ROOT / f["src"].lstrip("/")) == digest
            for f in frames
        )
        if dupe:
            return frames
        return [{"src": own, "alt": None, "isThumb": True}] + frames

    all_paths, plan = [], []
    for section, keys in order:
        for key in keys:
            frames = list(config.get(key, {}).get("frames", []))
            title = config[key].get("title", "")

            # Number each still by its position in the LIGHTBOX's own list,
            # before anything is inserted into or removed from it. That
            # ordinal names the derivative and drives the generic alt text, so
            # neither shifts when the tile's thumbnail joins the rotation or
            # when a still is excluded from it.
            frames = [dict(fr, ord=pos + 1) for pos, fr in enumerate(frames)]

            # Homepage-rotation opt-out. Applied before anything is analysed
            # or written, so an excluded still costs no derivative and no
            # bytes — while staying exactly where it is in the lightbox.
            kept = []
            for fr in frames:
                rel = fr["src"].lstrip("/")
                if rel in excluded:
                    seen_excluded.add(rel)
                else:
                    kept.append(fr)
            frames = kept

            # THE MINIMUM, and the one thing _data/shuffle_thumb_pool.yml
            # moves. Off (every tile by default): the minimum is tested on the
            # lightbox stills alone and the thumbnail is folded in afterwards.
            # On: the thumbnail is folded in first, so it can be the second
            # candidate that keeps the tile rotating. Same fold either way.
            optin = key in thumb_pool_optin
            if optin:
                seen_optin.add(key)
                frames = fold_authored_thumb(key, frames)
            # Recorded for both worlds so the build log proves, per tile, that
            # the flag changed the count for the opted-in tile and no other.
            pool_counts[key] = (len(kept), len(frames) if optin else len(kept))

            if len(frames) < 2:
                # Not enough left to shuffle. Only tiles a previous run had
                # pointed at a crop need anything done — put the authored
                # thumbnail back so the page can't reference a derivative
                # this run won't write.
                own = thumbs.get(key)
                if own and key in rewritten_keys:
                    dropped_tiles[key] = own
                continue

            if not optin:
                frames = fold_authored_thumb(key, frames)

            entries = []
            for i, fr in enumerate(frames):
                abs_path = ROOT / fr["src"].lstrip("/")
                if not abs_path.exists():
                    print(f"  ! missing {fr['src']}", file=sys.stderr)
                    continue
                all_paths.append(str(abs_path))
                entries.append((i, fr, abs_path))
            if len(entries) < 2:
                continue
            plan.append((key, section, title, entries, thumbs.get(key)))

    print(f"Analysing {len(all_paths)} stills across {len(plan)} tiles…")
    vision = run_vision(all_paths)
    yaw_sign, yaw_conf, yaw_n = calibrate_yaw_sign(vision)
    print(f"Yaw convention: {'negative' if yaw_sign < 0 else 'positive'} = screen-left "
          f"({yaw_conf:.0%} agreement with lookroom over {yaw_n} single-subject frames)")

    # Every derivative is rewritten this pass. Clear the tree first so no crop
    # from the old saliency cropper can survive as a stale file.
    if OUT_IMG.exists():
        shutil.rmtree(OUT_IMG)
    OUT_IMG.mkdir(parents=True, exist_ok=True)
    out_tiles, audit = {}, []
    total_bytes = 0

    default_src = {}
    for key, section, title, entries, own in plan:
        geo = GEOMETRY[section]
        dest_dir = OUT_IMG / key
        dest_dir.mkdir(parents=True, exist_ok=True)
        items = []

        for i, fr, abs_path in entries:
            vis = vision.get(str(abs_path), {})
            with Image.open(abs_path) as im:
                im = im.convert("RGB")
                ow, oh = im.size
                # Padding off first, so the trim below is spent on picture.
                picture, bars = strip_bars(im)
                w, h = picture.size
                # Geometry only. `vis` is deliberately not in scope here — the
                # anchor is a value Alex typed into _data/shuffle_crop.yml, not
                # anything this script read out of the picture.
                rel_src = fr["src"].lstrip("/")
                anchor = anchors.get(rel_src)
                if anchor is not None:
                    seen_anchored.add(rel_src)
                box, trim_top, trim_bottom, cut_left, cut_right = centred_crop(
                    w, h, geo["aspect"], allow_horizontal=(section == "commercial"),
                    anchor=anchor)
                crop = scale_to_width(picture.crop(box), geo["width"])
                out_w, out_h = crop.size
                stats = measure(crop)
            # Face rectangles are normalised to the UNSTRIPPED file, so they
            # keep the original dimensions; `box` only supplies the crop
            # height that tightness is a fraction of.
            facing, tight = facing_signal(vis, box, ow, oh, yaw_sign)

            name = "thumb" if fr.get("isThumb") else str(fr["ord"])
            rel = f"/img/shuffle/{key}/{name}.jpg"
            dest = ROOT / rel.lstrip("/")
            crop.save(dest, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
            total_bytes += dest.stat().st_size

            # The tile's own thumbnail keeps whatever alt the page already
            # gave it — and none of them have one, so it falls back to the
            # project title rather than shipping an empty alt whenever the
            # shuffle lands on the thumbnail. Lightbox stills use their own
            # alt, falling back to the same positional label js/lightbox.js
            # frameAlt() produces.
            if fr.get("isThumb"):
                alt = fr.get("alt") or title
                default_src[key] = rel
            else:
                alt = fr.get("alt") or f"{title} still {fr['ord']}"
            items.append({"src": rel, "alt": alt, "i": i,
                          "facing": facing, "tight": tight, **stats})
            audit.append({
                "tile": key, "section": section, "src": fr["src"], "out": rel,
                "orig": [ow, oh], "bars": list(bars), "picture": [w, h],
                "box": list(box), "out_size": [out_w, out_h],
                "trimTop": trim_top, "trimBottom": trim_bottom,
                "cutLeft": cut_left, "cutRight": cut_right,
                "anchor": anchor,
                "facing": facing, "tight": tight,
                "faces": len(vis.get("faces") or []),
                "faceBoxes": vis.get("faces") or [],
            })

        # If the tile's thumbnail duplicated one of the stills, that still's
        # crop becomes the server-rendered default instead.
        default_src.setdefault(key, items[0]["src"])
        out_tiles[key] = {"section": section, "title": title,
                          "originalThumb": own, "default": default_src[key],
                          "frames": items}

    # --- never-adjacent pairs, resolved source -> generated crop ------------
    # The browser compares the crops it renders, not the sources Alex typed,
    # so the pairing is translated here — the one place that holds the
    # mapping. A side that resolves to nothing is REPORTED rather than
    # dropped: the usual cause is a typo, or a still that is also in
    # shuffle_exclusions.yml (in which case it can never be adjacent to
    # anything and the pair is simply redundant).
    src_to_out = {a["src"].lstrip("/"): a["out"] for a in audit}
    never_out, never_report = [], []
    for a, b in never_pairs:
        oa, ob = src_to_out.get(a), src_to_out.get(b)
        if oa and ob:
            never_out.append([oa, ob])
            never_report.append((a, b, oa, ob, None))
        else:
            missing = ", ".join(p for p, o in ((a, oa), (b, ob)) if not o)
            never_report.append((a, b, oa, ob, missing))

    payload = {
        "version": 1,
        "geometry": {k: {"aspect": round(v["aspect"], 4), "width": v["width"]}
                     for k, v in GEOMETRY.items()},
        # Flat list of [cropA, cropB]. Symmetric — js/thumb-shuffle.js indexes
        # it both ways — and deliberately NOT nested under a tile, because the
        # two halves of a pair live in different tiles by definition.
        "neverAdjacent": never_out,
        "tiles": out_tiles,
    }
    DATA_JSON.parent.mkdir(parents=True, exist_ok=True)
    DATA_JSON.write_text(json.dumps(payload, separators=(",", ":")))
    SITE_DATA_JSON.write_text(json.dumps(payload, indent=1))

    # Tiles that fell out of the rotation get their authored thumbnail back.
    rewritten = rewrite_index_srcs({**dropped_tiles, **default_src})
    print(f"index.html tile srcs pointed at build-time crops: {rewritten}")

    # --- exclusions -------------------------------------------------------
    unmatched = sorted(excluded - seen_excluded)
    print(f"\nExclusions: {len(excluded)} listed, {len(seen_excluded)} matched a still")
    for u in unmatched:
        print(f"  ! no still matches '{u}' — check the path in "
              f"{EXCLUSIONS_YML.relative_to(ROOT)}", file=sys.stderr)
    for key, src in dropped_tiles.items():
        print(f"  · tile '{key}' left the rotation (under 2 stills); "
              f"restored {src}")

    # --- authored-thumbnail opt-in (_data/shuffle_thumb_pool.yml) ----------
    # Printed for EVERY tile, not just the opted-in ones: "stills after
    # exclusions" is the count the minimum used to be tested on, and "counted"
    # is the count it is tested on now. They differ for exactly the tiles named
    # in that file, which is the proof that the flag is scoped.
    print(f"\nAuthored thumbnail counted toward the 2-still minimum "
          f"(_data/shuffle_thumb_pool.yml) — {len(thumb_pool_optin)} tile(s) "
          f"opted in; every other tile keeps the default:")
    for key in sorted(pool_counts):
        stills, counted = pool_counts[key]
        mark = "  <-- OPTED IN" if key in thumb_pool_optin else ""
        print(f"  · {key:18} stills after exclusions {stills}, counted toward "
              f"the minimum {counted} → "
              f"{'rotates' if counted >= 2 else 'holds its authored thumbnail'}"
              f"{mark}")
    for miss in sorted(thumb_pool_optin - seen_optin):
        print(f"  ! no tile matches '{miss}' — check the key in "
              f"_data/shuffle_thumb_pool.yml", file=sys.stderr)

    # --- never-adjacent pairs (_data/shuffle_never_adjacent.yml) -----------
    # Printed with each side's TILE POOL SIZE, because that is what decides
    # whether the constraint can actually bind: a tile with one candidate left
    # has nowhere else to go, and the runtime is documented to show a banned
    # frame rather than an empty tile. Two healthy pools means the rule holds.
    tile_of = {a["out"]: a["tile"] for a in audit}
    print(f"\nNever-adjacent pairs (_data/shuffle_never_adjacent.yml) — "
          f"{len(never_pairs)} listed, {len(never_out)} resolved to crops:")
    for a, b, oa, ob, missing in never_report:
        if missing:
            print(f"  ! no still matches '{missing}' — check the path in "
                  f"_data/shuffle_never_adjacent.yml (pair [{a}, {b}] is "
                  f"NOT in force)", file=sys.stderr)
            continue
        ta, tb = tile_of.get(oa, "?"), tile_of.get(ob, "?")
        na = len(out_tiles.get(ta, {}).get("frames", []))
        nb = len(out_tiles.get(tb, {}).get("frames", []))
        print(f"  · {a}  <->  {b}")
        print(f"      {oa} (tile '{ta}', {na} candidates)")
        print(f"      {ob} (tile '{tb}', {nb} candidates)")
        if na < 2 or nb < 2:
            print(f"  ! tile '{ta if na < 2 else tb}' has no alternative "
                  f"still — this pair cannot always be honoured",
                  file=sys.stderr)

    # --- baked-in padding --------------------------------------------------
    barred = [a for a in audit if any(a["bars"])]
    print(f"\nBaked-in padding stripped from {len(barred)}/{len(audit)} frames")
    for a in barred:
        t, b, l, r = a["bars"]
        pw, ph = a["picture"]
        ratio = pw / ph
        # A padded frame is usually a 16:9 container around something else.
        # Say what the picture actually is rather than forcing it to a ratio.
        print(f"  · {a['src']} ({a['section']}) {a['orig'][0]}x{a['orig'][1]}: "
              f"top {t}, bottom {b}, left {l}, right {r} → picture {pw}x{ph} "
              f"({ratio:.4f}:1{'' if abs(ratio - 16/9) < 0.002 else ' — NOT 16:9'})")

    # --- crop arithmetic, verified rather than asserted --------------------
    # Measured against the PICTURE area, which is the source once padding the
    # frame never owned has been taken off.
    # Width may only shrink via the sanctioned commercial centre-crop, and a
    # frame that took one must have taken the SAME number of columns off each
    # side and none off the top or bottom. Everything else still has to keep
    # 100% of the picture width at x=0.
    def cropped_h(a):
        return a["cutLeft"] > 0 or a["cutRight"] > 0

    bad_width = [a for a in audit
                 if a["box"][2] - a["box"][0] != a["picture"][0] and not cropped_h(a)]
    bad_x = [a for a in audit if a["box"][0] != 0 and not cropped_h(a)]
    # The exception's own guard rails, checked as hard as the rule they bend.
    h_asym = [a for a in audit if a["cutLeft"] != a["cutRight"]]
    h_wrong_section = [a for a in audit if cropped_h(a) and a["section"] != "commercial"]
    h_not_wider = [a for a in audit
                   if cropped_h(a)
                   and a["picture"][0] <= a["picture"][1] * GEOMETRY[a["section"]]["aspect"]]
    h_bad_box = [a for a in audit if cropped_h(a) and (
        a["box"][0] != a["cutLeft"]
        or a["picture"][0] - a["box"][2] != a["cutRight"]
        or a["box"][1] != 0 or a["box"][3] != a["picture"][1]
        or a["trimTop"] or a["trimBottom"])]
    # An ANCHORED frame is allowed to be asymmetric — that is the whole point
    # of the anchor — but only in the split. It is held to every other clause
    # of the rule, and harder: the window it produces must be the SAME SIZE as
    # the centred window it replaced (no zoom, no extra rows taken), must keep
    # the full picture width, and must still spend exactly the rows the ratio
    # demands. So an anchor can move the window and can do nothing else.
    anchored = [a for a in audit if a.get("anchor") is not None]
    asym = [a for a in audit
            if a["trimTop"] != a["trimBottom"] and a.get("anchor") is None]
    anchor_bad = []
    for a in anchored:
        pw, ph = a["picture"]
        want = centred_crop(pw, ph, GEOMETRY[a["section"]]["aspect"],
                            allow_horizontal=(a["section"] == "commercial"))[0]
        kept = a["box"][3] - a["box"][1]
        if (kept != want[3] - want[1]                       # same height
                or a["box"][0] != 0 or a["box"][2] != pw    # full width, x=0
                or a["trimTop"] + a["trimBottom"] != ph - kept  # rows accounted for
                or a["box"][1] < 0 or a["box"][3] > ph      # inside the picture
                or a["cutLeft"] or a["cutRight"]):          # no horizontal move
            anchor_bad.append(a)
    upscaled = [a for a in audit if a["out_size"][0] > a["picture"][0]]
    # Padding removal is the only step allowed to change the window, so it is
    # held to the same standard: equal off both sides, or it didn't happen.
    bar_asym = [a for a in audit
                if a["bars"][0] != a["bars"][1] or a["bars"][2] != a["bars"][3]]
    print(f"\n{len(audit)} derivatives, {total_bytes:,} bytes total "
          f"({total_bytes / len(audit):,.0f} avg)")
    h_cropped = [a for a in audit if cropped_h(a)]
    print(f"Full picture width kept: "
          f"{len(audit) - len(h_cropped) - len(bad_width)}/{len(audit)} "
          f"({len(h_cropped)} centre-cropped by the commercial exception, "
          f"{len(bad_width)} unexplained); "
          f"horizontal offset non-zero: {len(bad_x)}; "
          f"asymmetric vertical trim: {len(asym)} unexplained "
          f"({len(anchored)} explicitly anchored in _data/shuffle_crop.yml, "
          f"{len(anchor_bad)} of those breaking a rule the anchor doesn't bend); "
          f"upscaled: {len(upscaled)}; "
          f"asymmetric padding removal: {len(bar_asym)}")
    print(f"Commercial centre-crop guard rails — asymmetric: {len(h_asym)}; "
          f"outside commercial: {len(h_wrong_section)}; "
          f"applied to a frame not wider than its cell: {len(h_not_wider)}; "
          f"box disagrees with the recorded cut: {len(h_bad_box)}")
    if (bad_width or bad_x or asym or upscaled or bar_asym
            or h_asym or h_wrong_section or h_not_wider or h_bad_box
            or anchor_bad):
        sys.exit("CROP RULE VIOLATED — see above")

    # --- per-frame vertical anchors, frame by frame ------------------------
    print(f"\nVertical crop anchored by hand (_data/shuffle_crop.yml) — "
          f"{len(anchored)} frame(s); every other frame is centred:")
    for a in sorted(anchored, key=lambda a: a["src"]):
        ph = a["picture"][1]
        kept = a["box"][3] - a["box"][1]
        was = (ph - kept) // 2
        word = {0.0: "top", 0.5: "center", 1.0: "bottom"}.get(a["anchor"], a["anchor"])
        print(f"  · {a['src']}: picture {a['picture'][0]}x{ph} → keeps "
              f"{kept} rows at anchor '{word}'; trim was {was} off top / "
              f"{ph - kept - was} off bottom (centred), now {a['trimTop']} off "
              f"top / {a['trimBottom']} off bottom; full width "
              f"{a['box'][2] - a['box'][0]}px kept, no zoom")
    for miss in sorted(set(anchors) - seen_anchored):
        print(f"  ! no still matches '{miss}' — check the path in "
              f"_data/shuffle_crop.yml", file=sys.stderr)
    # An anchor on a frame with no rows to spend is a no-op, and silence there
    # would read as "applied".
    for a in anchored:
        if a["trimTop"] + a["trimBottom"] == 0:
            print(f"  ! '{a['src']}' is anchored but needs no vertical trim "
                  f"({a['picture'][0]}x{a['picture'][1]} is already at or wider "
                  f"than its cell) — the anchor changes nothing",
                  file=sys.stderr)

    # --- the commercial centre-crop, frame by frame ------------------------
    print(f"\nCommercial centre-crop to 16:9 — {len(h_cropped)} frame(s):")
    for a in sorted(h_cropped, key=lambda a: a["src"]):
        pw, ph = a["picture"]
        bw = a["box"][2] - a["box"][0]
        print(f"  · {a['src']}: source {pw}x{ph} ({pw / ph:.4f}:1) "
              f"− {a['cutLeft']}px left, {a['cutRight']}px right "
              f"({'symmetric' if a['cutLeft'] == a['cutRight'] else 'ASYMMETRIC'}) "
              f"→ crop {bw}x{ph} ({bw / ph:.4f}:1), full height kept "
              f"→ delivered {a['out_size'][0]}x{a['out_size'][1]} "
              f"({a['out_size'][0] / a['out_size'][1]:.4f}:1)")

    # Frames wider than their cell that this build did NOT crop. Narrative is
    # the whole point of the list: the exception stops at the section
    # boundary, so a wide narrative frame is reported and left exactly alone.
    wide_left = [a for a in audit if not cropped_h(a)
                 and a["picture"][0] > a["picture"][1] * GEOMETRY[a["section"]]["aspect"]]
    by_tile = {}
    for a in wide_left:
        by_tile.setdefault((a["section"], a["tile"]), []).append(a)
    print(f"\nWider than their cell and LEFT ALONE (full width preserved, "
          f"centred vertical trim only): {len(wide_left)} frame(s) across "
          f"{len(by_tile)} tile(s)")
    for (section, tile), group in sorted(by_tile.items()):
        pw, ph = group[0]["picture"]
        cell = GEOMETRY[section]["aspect"]
        print(f"  · {section}/{tile}: {len(group)} frame(s) at "
              f"{pw / ph:.4f}:1 in a {cell:.4f}:1 cell "
              f"(+{(pw / ph / cell - 1) * 100:.1f}%)")

    uncropped = [a for a in audit if a["trimTop"] == 0 and not cropped_h(a)]
    print(f"Frames needing no crop in either axis (source already at or wider "
          f"than the tile): {len(uncropped)}")

    # --- residual padding, measured on what actually got written -----------
    # Detecting a bar in the source proves nothing about the file on disk, so
    # every derivative is reopened and its own edges are read back. A repaired
    # frame has to come back clean, and so does a frame that never had bars —
    # this is also what would catch the trim itself introducing an edge.
    residual = []
    for a in audit:
        with Image.open(ROOT / a["out"].lstrip("/")) as out_im:
            found = detect_bars(out_im)
            edges = _edge_luma(out_im)
        a["outEdgeLuma"] = edges
        if any(found):
            residual.append((a["out"], found))
    repaired = [a for a in audit if any(a["bars"])]
    print(f"\nResidual-padding check on {len(audit)} written derivatives: "
          f"{len(residual)} still show a bar")
    for a in repaired:
        e = a["outEdgeLuma"]
        print(f"  · {a['out']} (was {a['src']}): edge means "
              f"top {e['top']:.1f}, bottom {e['bottom']:.1f}, "
              f"left {e['left']:.1f}, right {e['right']:.1f}")
    for out, found in residual:
        print(f"  ! {out} still has padding {found}", file=sys.stderr)
    if residual:
        sys.exit("RESIDUAL PADDING — see above")

    # Written last so the audit carries the read-back edge measurements too,
    # not just what the build intended to do.
    (ROOT / "scripts" / "thumb_shuffle_audit.json").write_text(
        json.dumps(audit, indent=1))

    # --- facing / close-up ------------------------------------------------
    fc = {"left": 0, "right": 0, "neutral": 0}
    for a in audit:
        fc[a["facing"]] += 1
    tight = [a for a in audit if a["tight"] >= TIGHT_FACE]
    print(f"Facing: {fc['left']} screen-left, {fc['right']} screen-right, "
          f"{fc['neutral']} neutral; tight close-ups: {len(tight)}")

    verify_no_residual_bars(audit)
    verify_commercial_fills_cell(audit)
    return audit


# The layout can only letterbox a tile when the derivative's ratio disagrees
# with the cell's, and the delivery downscale is the last thing that can move
# it, so the tolerance is expressed in DELIVERED PIXELS: half a pixel of bar
# across a 648px-tall tile is nothing a browser can paint.
CELL_RATIO_TOL_PX = 0.5


def verify_commercial_fills_cell(audit):
    """Prove no commercial derivative can letterbox in its 16:9 cell.

    Two independent things have to hold, and neither implies the other:

      * RATIO. The shipped file has to match the cell to within half a
        delivered pixel, or `object-fit: contain` pads the difference with the
        page background — which is exactly the black edge Alex reported.
      * CONTENT. The outermost row and column on every side has to be
        picture. A frame can fill its cell perfectly and still show a black
        edge if the black was baked into the source, so the edges are read
        back off the written JPEG rather than inferred from the arithmetic.

    Reported as measurements, not just a pass: the numbers are the evidence.
    """
    comm = [a for a in audit if a["section"] == "commercial"]
    cell = GEOMETRY["commercial"]["aspect"]
    bad_ratio, barred = [], []

    print(f"\nCommercial letterbox check — {len(comm)} derivative(s) against a "
          f"{cell:.4f}:1 cell (tolerance {CELL_RATIO_TOL_PX}px of delivered height):")
    for a in sorted(comm, key=lambda a: (a["tile"], a["out"])):
        with Image.open(ROOT / a["out"].lstrip("/")) as im:
            im = im.convert("RGB")
            ow, oh = im.size
            bars = detect_bars(im)
            e = _edge_luma(im)
        # How many rows/columns of bar the layout would have to paint.
        gap_px = abs(oh - ow / cell)
        flag = ""
        if gap_px > CELL_RATIO_TOL_PX:
            bad_ratio.append((a["out"], ow, oh, gap_px))
            flag = "  <-- WOULD LETTERBOX"
        if any(bars):
            barred.append((a["out"], bars))
            flag += "  <-- BAKED-IN BAR"
        print(f"  · {a['out']} {ow}x{oh} ({ow / oh:.4f}:1), layout bar "
              f"{gap_px:.2f}px; edge means top {e['top']:.1f}, "
              f"bottom {e['bottom']:.1f}, left {e['left']:.1f}, "
              f"right {e['right']:.1f}{flag}")

    print(f"  → {len(comm) - len(bad_ratio)}/{len(comm)} fill the cell exactly; "
          f"{len(comm) - len(barred)}/{len(comm)} have picture on all four edges")
    for out, ow, oh, gap in bad_ratio:
        print(f"  ! {out} is {ow}x{oh} — the cell would pad {gap:.2f}px",
              file=sys.stderr)
    for out, bars in barred:
        print(f"  ! {out} has a baked-in bar {bars}", file=sys.stderr)
    if bad_ratio or barred:
        sys.exit("COMMERCIAL TILE WOULD LETTERBOX — see above")
    return comm


def verify_no_residual_bars(audit):
    """Re-measure every derivative that SHIPPED for a surviving padded edge.

    Checks the written JPEG rather than the arithmetic that produced it, so a
    bar detected a pixel short — or one reintroduced by the resample — has
    somewhere to show up.

    Two distinct results, because conflating them is how you end up trimming
    picture. A RESIDUAL BAR is a dark edge that steps into picture: padding
    the strip missed, and a defect. A DARK EDGE is an outermost line that is
    merely dark, with no step behind it: a shadowed wall, a vignette, a night
    exterior running to frame edge. That is the shot, it is supposed to be
    there, and it is listed as a note rather than flagged.
    """
    residual, dark = [], []
    for a in audit:
        with Image.open(ROOT / a["out"].lstrip("/")) as im:
            im = im.convert("RGB")
            bars = detect_bars(im)
            arr = np.asarray(im).astype(np.float32)
        lum = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
        if any(bars):
            residual.append((a["out"], bars))
            continue
        edges = {"top": lum[0], "bottom": lum[-1], "left": lum[:, 0], "right": lum[:, -1]}
        hot = {k: round(float(v.max()), 1) for k, v in edges.items() if v.max() <= BAR_TOL}
        if hot:
            dark.append((a["out"], hot))

    print(f"\nEdge sample of all {len(audit)} shipped derivatives: "
          f"{len(residual)} with a residual padded edge")
    for out, bars in residual:
        print(f"  ! {out} still padded: top/bottom/left/right {bars}", file=sys.stderr)
    print(f"  ({len(dark)} have an outermost line that is dark but has no step "
          f"behind it — that is the shot, not padding)")
    for out, hot in dark:
        print(f"    · {out} {hot}")
    return residual


if __name__ == "__main__":
    build(verify="--verify" in sys.argv)
