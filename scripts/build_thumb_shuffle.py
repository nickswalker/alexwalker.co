#!/usr/bin/env python3
"""Build-time analysis + derivative generation for the homepage thumbnail shuffle.

For every project tile in the NARRATIVE and COMMERCIAL grids that has more than
one still in its lightbox, this:

  1. reads the tile's still list from the single source of truth
     (RICH_CONFIG in js/lightbox.js, plus _data/tll.yml for the TLL entry),
     minus anything opted out in _data/shuffle_exclusions.yml,
  2. writes a FULL-WIDTH, CENTRED VERTICAL crop at the tile's aspect ratio into
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
    This script does not get a vote. Every derivative keeps 100% of the source
    width — no horizontal crop, no pan, no zoom, no upscale — and reaches the
    tile's aspect ratio by removing an EQUAL number of rows from the top and
    the bottom. Nothing about the picture content moves the window. Faces and
    saliency are read for SELECTION ORDERING ONLY (see facing_signal); if you
    are ever tempted to feed them back into the geometry, don't.

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


def centred_vertical_crop(w, h, aspect):
    """Full source width, equal rows off the top and the bottom. Nothing else.

    Takes only the source dimensions and the target ratio — no image content,
    no Vision data — because there is no input that could legitimately move
    this window. Returns (box, rows_removed_top, rows_removed_bottom).

    Two cases:

      * Source TALLER than the tile (a 16:9 or 4:3 still in a 2.35 cell):
        keep the full width, trim to `w / aspect` rows.
      * Source ALREADY AS WIDE OR WIDER than the tile (the 2.38:1 scope
        frames): there are no spare rows to remove, and reaching the tile
        ratio would mean cutting width. It doesn't. The frame is emitted
        whole and CSS `object-fit: cover` handles the last ~1.6% — centred
        and symmetric, so the composition still isn't repositioned.

    The removed-row count is forced EVEN so top and bottom are exactly equal.
    That costs at most one row of height (an aspect error under 0.004) and
    buys an arithmetic guarantee of symmetry rather than a rounding one.
    """
    th = min(h, int(round(w / aspect)))
    if (h - th) % 2:
        th -= 1
    th = max(th, 1)
    trim = (h - th) // 2
    return (0, trim, w, trim + th), trim, trim


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
    seen_excluded, dropped_tiles = set(), {}

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

            if len(frames) < 2:
                # Not enough left to shuffle. Only tiles a previous run had
                # pointed at a crop need anything done — put the authored
                # thumbnail back so the page can't reference a derivative
                # this run won't write.
                own = thumbs.get(key)
                if own and key in rewritten_keys:
                    dropped_tiles[key] = own
                continue

            # The tile's own thumbnail joins its rotation — unless it is
            # byte-identical to a still already in the list (TLL's thumbnail
            # is its 5th still), in which case it's already there.
            own = thumbs.get(key)
            own_abs = ROOT / own.lstrip("/") if own else None
            if own and own.lstrip("/") in excluded:
                seen_excluded.add(own.lstrip("/"))
                own_abs = None
            if own_abs and own_abs.exists() and "/img/shuffle/" not in own:
                digest = _digest(own_abs)
                dupe = any(
                    (ROOT / f["src"].lstrip("/")).exists()
                    and _digest(ROOT / f["src"].lstrip("/")) == digest
                    for f in frames
                )
                if not dupe:
                    frames.insert(0, {"src": own, "alt": None, "isThumb": True})

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
            plan.append((key, section, title, entries, own))

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
                w, h = im.size
                # Geometry only. `vis` is deliberately not in scope here.
                box, trim_top, trim_bottom = centred_vertical_crop(w, h, geo["aspect"])
                crop = scale_to_width(im.crop(box), geo["width"])
                out_w, out_h = crop.size
                stats = measure(crop)
            facing, tight = facing_signal(vis, box, w, h, yaw_sign)

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
                "orig": [w, h], "box": list(box), "out_size": [out_w, out_h],
                "trimTop": trim_top, "trimBottom": trim_bottom,
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

    payload = {
        "version": 1,
        "geometry": {k: {"aspect": round(v["aspect"], 4), "width": v["width"]}
                     for k, v in GEOMETRY.items()},
        "tiles": out_tiles,
    }
    DATA_JSON.parent.mkdir(parents=True, exist_ok=True)
    DATA_JSON.write_text(json.dumps(payload, separators=(",", ":")))
    SITE_DATA_JSON.write_text(json.dumps(payload, indent=1))
    (ROOT / "scripts" / "thumb_shuffle_audit.json").write_text(json.dumps(audit, indent=1))

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

    # --- crop arithmetic, verified rather than asserted --------------------
    bad_width = [a for a in audit if a["box"][2] - a["box"][0] != a["orig"][0]]
    bad_x = [a for a in audit if a["box"][0] != 0]
    asym = [a for a in audit if a["trimTop"] != a["trimBottom"]]
    upscaled = [a for a in audit if a["out_size"][0] > a["orig"][0]]
    print(f"\n{len(audit)} derivatives, {total_bytes:,} bytes total "
          f"({total_bytes / len(audit):,.0f} avg)")
    print(f"Full source width kept: {len(audit) - len(bad_width)}/{len(audit)}; "
          f"horizontal offset non-zero: {len(bad_x)}; "
          f"asymmetric vertical trim: {len(asym)}; upscaled: {len(upscaled)}")
    if bad_width or bad_x or asym or upscaled:
        sys.exit("CROP RULE VIOLATED — see above")

    uncropped = [a for a in audit if a["trimTop"] == 0]
    print(f"Frames needing no vertical trim at all (source already at or wider "
          f"than the tile): {len(uncropped)}")

    # --- facing / close-up ------------------------------------------------
    fc = {"left": 0, "right": 0, "neutral": 0}
    for a in audit:
        fc[a["facing"]] += 1
    tight = [a for a in audit if a["tight"] >= TIGHT_FACE]
    print(f"Facing: {fc['left']} screen-left, {fc['right']} screen-right, "
          f"{fc['neutral']} neutral; tight close-ups: {len(tight)}")
    return audit


if __name__ == "__main__":
    build(verify="--verify" in sys.argv)
