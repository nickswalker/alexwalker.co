#!/usr/bin/env python3
"""Build-time analysis + derivative generation for the homepage thumbnail shuffle.

For every project tile in the NARRATIVE and COMMERCIAL grids that has more than
one still in its lightbox, this:

  1. reads the tile's still list from the single source of truth
     (RICH_CONFIG in js/lightbox.js, plus _data/tll.yml for the TLL entry),
  2. runs each still through Apple's Vision framework (scripts/vision_probe.swift)
     for face rectangles + attention-based saliency,
  3. writes a saliency/face-aware crop at the tile's aspect ratio into
     img/shuffle/<key>/ — originals are never touched,
  4. measures the CROP (not the original) for palette, luminance, contrast and
     composition, and
  5. emits _data/thumb_shuffle.json (canonical) and data/thumb-shuffle.json
     (fetched by js/thumb-shuffle.js at runtime).

All the expensive work happens here. The browser only ever reads the JSON.

Usage:  python3 scripts/build_thumb_shuffle.py [--verify]
"""

import colorsys
import hashlib
import json
import re
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

# Tile geometry. Narrative cells are locked to 2.35:1 by
# `.narrative-cinema li > a` in css/style.css; the commercial grid keeps the
# 16:9 the existing thumbnails already use.
GEOMETRY = {
    "narrative": {"aspect": 2.35, "width": 1152},
    "commercial": {"aspect": 16 / 9, "width": 1152},
}
JPEG_QUALITY = 82

# A face must keep at least this much of its own height as clear space above
# it (hair/headroom) and below (chin/neck) inside the crop. 0.35 of face
# height is a generous portrait margin — a crop that clips this is rejected
# and the window is nudged until it fits.
FACE_PAD = 0.35


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
    return raw


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
    """
    html = (ROOT / "index.html").read_text()
    order, thumbs = [], {}
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
                orig = (prior.get(key) or {}).get("originalThumb")
                # Never accept a previously-rewritten path as the "original".
                if orig and orig.lstrip("/").startswith("img/shuffle/"):
                    orig = None
                if orig:
                    thumbs[key] = orig
                else:
                    del thumbs[key]
    return order, thumbs


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


def choose_crop(w, h, aspect, vis):
    """Pick the crop window, keeping every detected face whole.

    Order of preference: keep all faces (with headroom) -> centre on the
    saliency box -> centre on the frame. Returns (box, basis, faces_kept).
    """
    tw, th = (int(round(h * aspect)), h) if w / h > aspect else (w, int(round(w / aspect)))
    tw, th = min(tw, w), min(th, h)

    sal = vis.get("saliency")

    def px(b):
        # Vision happily reports a face box that runs off the edge of the
        # frame when the head is already clipped in the source still. Clamp
        # to the image: we can only promise the crop doesn't cut MORE than
        # the original did, and an unclamped box makes the fit test
        # unsatisfiable for exactly the frames that need it most.
        x0 = max(b["x"] * w, 0.0)
        y0 = max(b["y"] * h, 0.0)
        x1 = min((b["x"] + b["w"]) * w, float(w))
        y1 = min((b["y"] + b["h"]) * h, float(h))
        return (x0, y0, max(x1 - x0, 0.0), max(y1 - y0, 0.0))

    faces = [f for f in (vis.get("faces") or []) if px(f)[2] > 1 and px(f)[3] > 1]

    # Region we must not clip: all faces plus headroom, clamped to the frame.
    # If the padded union is too big to fit the crop window, fall back to the
    # bare face union — headroom is a nicety, an uncut face is not.
    must = None
    if faces:
        def union(pad):
            xs0, ys0, xs1, ys1 = [], [], [], []
            for f in faces:
                fx, fy, fw, fh = px(f)
                xs0.append(max(fx - fw * pad, 0.0))
                ys0.append(max(fy - fh * pad, 0.0))
                xs1.append(min(fx + fw * (1 + pad), float(w)))
                ys1.append(min(fy + fh * (1 + pad), float(h)))
            return (min(xs0), min(ys0), max(xs1), max(ys1))

        must = union(FACE_PAD)
        if must[2] - must[0] > tw or must[3] - must[1] > th:
            must = union(0.0)

    # Region we'd LIKE to keep: faces if any, else attention saliency.
    if must:
        want, basis = must, "face"
    elif sal:
        sx, sy, sw, sh = px(sal)
        want, basis = (sx, sy, sx + sw, sy + sh), "saliency"
    else:
        want, basis = (0, 0, w, h), "center"

    cx = (want[0] + want[2]) / 2
    cy = (want[1] + want[3]) / 2
    x0 = int(round(min(max(cx - tw / 2, 0), w - tw)))
    y0 = int(round(min(max(cy - th / 2, 0), h - th)))

    # If the must-keep region is narrower/shorter than the window but the
    # centred window still clips it (clamped at an edge), slide the window
    # until it contains the region. This is what actually prevents a crop
    # from taking the top off a head.
    if must:
        mx0, my0, mx1, my1 = must
        if mx1 - mx0 <= tw:
            x0 = int(round(min(max(x0, mx1 - tw), mx0)))
            x0 = min(max(x0, 0), w - tw)
        if my1 - my0 <= th:
            y0 = int(round(min(max(y0, my1 - th), my0)))
        else:
            # The face is taller than the window can hold — a big close-up in
            # a wide cell. Centring it takes a slice off the top of the head
            # AND the chin, which is the one result this whole exercise is
            # meant to avoid. Anchor to the top of the face instead: hair and
            # eyes survive, the crop loses chin/neck, which is how a person
            # would frame it.
            y0 = int(round(my0))
        y0 = min(max(y0, 0), h - th)

    box = (x0, y0, x0 + tw, y0 + th)
    kept = sum(1 for f in faces if _face_inside(px(f), box))
    return box, basis, kept, len(faces)


def _face_inside(face_px, box, pad=0.0):
    fx, fy, fw, fh = face_px
    return (fx - fw * pad >= box[0] - 0.5 and fy - fh * pad >= box[1] - 0.5
            and fx + fw * (1 + pad) <= box[2] + 0.5 and fy + fh * (1 + pad) <= box[3] + 0.5)


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
    order, thumbs = load_tile_order()

    all_paths, plan = [], []
    for section, keys in order:
        for key in keys:
            frames = list(config.get(key, {}).get("frames", []))
            if len(frames) < 2:
                continue
            title = config[key].get("title", "")

            # The tile's own thumbnail joins its rotation — unless it is
            # byte-identical to a still already in the list (TLL's thumbnail
            # is its 5th still), in which case it's already there.
            own = thumbs.get(key)
            own_abs = ROOT / own.lstrip("/") if own else None
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
                box, basis, kept, nfaces = choose_crop(w, h, geo["aspect"], vis)
                crop = im.crop(box)
                out_w = geo["width"]
                out_h = int(round(out_w / geo["aspect"]))
                crop = crop.resize((out_w, out_h), Image.LANCZOS)
                stats = measure(crop)

            name = "thumb" if fr.get("isThumb") else str(i + 1)
            rel = f"/img/shuffle/{key}/{name}.jpg"
            dest = ROOT / rel.lstrip("/")
            crop.save(dest, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
            total_bytes += dest.stat().st_size

            # The tile's own thumbnail keeps whatever alt the page already
            # gave it; lightbox stills use their own alt, falling back to the
            # same positional label js/lightbox.js frameAlt() produces.
            if fr.get("isThumb"):
                alt = fr.get("alt") or ""
                default_src[key] = rel
            else:
                alt = fr.get("alt") or f"{title} still {i + 1}"
            items.append({"src": rel, "alt": alt, "i": i, **stats})
            audit.append({
                "tile": key, "section": section, "src": fr["src"], "out": rel,
                "orig": [w, h], "box": list(box), "basis": basis,
                "faces": nfaces, "facesKept": kept,
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

    rewritten = rewrite_index_srcs(default_src)
    print(f"index.html tile srcs pointed at build-time crops: {rewritten}")

    n_faces = sum(a["faces"] for a in audit)
    lost = [a for a in audit if a["facesKept"] < a["faces"]]
    print(f"\n{len(audit)} derivatives, {total_bytes:,} bytes total "
          f"({total_bytes / len(audit):,.0f} avg)")
    print(f"Frames with faces: {sum(1 for a in audit if a['faces'])}; "
          f"faces detected: {n_faces}; faces clipped by a crop: "
          f"{sum(a['faces'] - a['facesKept'] for a in lost)}")
    for a in lost:
        print(f"  ! {a['out']}  kept {a['facesKept']}/{a['faces']}")
    return audit


if __name__ == "__main__":
    build(verify="--verify" in sys.argv)
