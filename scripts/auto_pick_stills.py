#!/usr/bin/env python3
"""Auto-pick the best N stills from each /tmp/movie_stills/<key>/ folder.

For each folder:
  1. Score every shot_*.jpg by sharpness (Laplacian variance), exposure
     sanity (mid-range mean luminance), and contrast (stddev).
  2. Divide the timeline into N equal buckets and pick the top-scoring
     frame in each bucket — guarantees coverage across the whole video.
  3. Auto-trim near-black borders (letterbox/pillarbox), resize to 1600
     wide preserving aspect, write to img/<key>/frame[1-N].jpg.
  4. Print a RICH_CONFIG snippet for each key so it can be pasted into
     js/lightbox.js. Detects the output aspect and emits frameAspect.

Usage:
  auto_pick_stills.py key1 [key2 ...] [--count 4]
"""

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

REPO = Path("/Users/alexwalker/Coding Projects/Portfolio Website Redesign")
STILLS_ROOT = Path("/tmp/movie_stills")


def score(jpeg_path: Path):
    img = cv2.imread(str(jpeg_path), cv2.IMREAD_COLOR)
    if img is None:
        return -1
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    sharp = cv2.Laplacian(gray, cv2.CV_64F).var()
    mean = gray.mean()
    std = gray.std()
    if mean < 18 or mean > 235:
        exposure = 0.05
    elif mean < 35 or mean > 215:
        exposure = 0.4
    else:
        exposure = 1.0
    # Penalise frames that are nearly all one tone (likely fade / dissolve)
    contrast = std / 128.0
    return float(sharp * exposure * (0.4 + contrast))


def pick_for(key: str, count: int):
    src_dir = STILLS_ROOT / key
    shots = sorted(src_dir.glob("shot_*.jpg"))
    if not shots:
        print(f"[{key}] no shots found", file=sys.stderr)
        return None
    # Score all
    scored = [(s, score(s)) for s in shots]
    scored = [(s, v) for s, v in scored if v >= 0]
    if not scored:
        return None
    # Bucket the timeline into `count` slices; pick the top scorer in each.
    picks = []
    n = len(scored)
    if n <= count:
        picks = [s for s, _ in scored]
    else:
        for i in range(count):
            lo = (n * i) // count
            hi = (n * (i + 1)) // count
            bucket = scored[lo:hi] or scored[lo:lo + 1]
            best = max(bucket, key=lambda t: t[1])
            picks.append(best[0])
    return picks


def trim_and_resize(src: Path, dst: Path, target_width: int = 1600):
    """Trim near-black borders, resize to target_width preserving aspect.
    Returns (out_width, out_height)."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([
        "magick", str(src),
        "-bordercolor", "black", "-border", "1",
        "-fuzz", "5%", "-trim", "+repage",
        "-resize", f"{target_width}x",
        "-quality", "88",
        str(dst),
    ], check=True)
    out = subprocess.check_output(["identify", "-format", "%w %h", str(dst)]).decode().split()
    return int(out[0]), int(out[1])


def gcd_aspect(w: int, h: int):
    g = math.gcd(w, h)
    return f"{w // g} / {h // g}"


def common_aspect(dims):
    """If all frames are within 2% of one aspect, return that aspect string
    (use first frame's exact w/h). Otherwise return None — caller should
    set per-frame aspect."""
    if not dims:
        return None
    aspects = [w / h for w, h in dims]
    avg = sum(aspects) / len(aspects)
    if all(abs(a - avg) / avg < 0.02 for a in aspects):
        w, h = dims[0]
        return f"{w} / {h}"
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("keys", nargs="+")
    ap.add_argument("--count", type=int, default=4)
    args = ap.parse_args()

    config_blocks = {}
    for key in args.keys:
        picks = pick_for(key, args.count)
        if not picks:
            print(f"[{key}] SKIP", file=sys.stderr)
            continue
        out_dir = REPO / "img" / key
        # Clear any existing frames first
        for old in out_dir.glob("frame*.jpg"):
            old.unlink()
        dims = []
        for i, src in enumerate(picks, start=1):
            dst = out_dir / f"frame{i}.jpg"
            w, h = trim_and_resize(src, dst)
            dims.append((w, h))
            print(f"[{key}] frame{i} <- {src.name}  {w}x{h}", file=sys.stderr)
        ca = common_aspect(dims)
        frames_repr = [f"            '/img/{key}/frame{i}.jpg'," for i in range(1, len(picks) + 1)]
        if ca:
            block = (
                f"    {key}: {{\n"
                f"        // ...keep title + poster from existing entry...\n"
                f"        frameAspect: '{ca}',\n"
                f"        frames: [\n" + "\n".join(frames_repr) + "\n"
                f"        ],\n"
                f"    }},"
            )
        else:
            # mixed-aspect: emit per-frame
            entries = []
            for i, (w, h) in enumerate(dims, start=1):
                entries.append(f"            {{ src: '/img/{key}/frame{i}.jpg', aspect: '{w} / {h}' }},")
            block = (
                f"    {key}: {{\n"
                f"        // ...keep title + poster from existing entry...\n"
                f"        frames: [\n" + "\n".join(entries) + "\n"
                f"        ],\n"
                f"    }},"
            )
        config_blocks[key] = block

    # Emit a structured JSON the orchestrator can parse to edit lightbox.js
    out = {}
    for key, block in config_blocks.items():
        # Re-derive the frames + frameAspect cleanly for programmatic update
        pass
    # Print the human-readable blocks
    print("\n========== RICH_CONFIG updates ==========\n")
    for key in args.keys:
        if key in config_blocks:
            print(config_blocks[key])
            print()


if __name__ == "__main__":
    main()
