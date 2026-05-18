#!/usr/bin/env python3
"""Replace existing img/<key>/frame*.jpg with their 4K twins.

For each frame on disk, perceptually-hash it, find the closest match in the
freshly-extracted /tmp/movie_stills/<key>/shot_*.jpg pool, then trim
letterbox + resize the matched 4K shot to overwrite the frame in place.

Preserves shot identity — only upgrades resolution.

Usage:  match_4k_replace.py key1 [key2 ...] [--width 1600]
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

import imagehash
from PIL import Image

REPO = Path("/Users/alexwalker/Coding Projects/Portfolio Website Redesign")
STILLS_ROOT = Path("/tmp/movie_stills")


def phash(p: Path):
    return imagehash.phash(Image.open(p), hash_size=16)


def replace_for(key: str):
    """For each existing frame, find its 4K twin via pHash, then center-crop
    cover-resize to the frame's exact existing dimensions. Preserves both
    shot identity (pHash match) and display geometry (same WxH)."""
    img_dir = REPO / "img" / key
    frames = sorted(img_dir.glob("frame*.jpg"))
    shots = sorted((STILLS_ROOT / key).glob("shot_*.jpg"))
    if not frames:
        print(f"[{key}] no existing frames on site", file=sys.stderr)
        return
    if not shots:
        print(f"[{key}] no 4K shots extracted yet", file=sys.stderr)
        return

    print(f"[{key}] hashing {len(shots)} shots...", file=sys.stderr)
    shot_hashes = [(s, phash(s)) for s in shots]

    for frame in frames:
        # Read existing dims first — we preserve these exactly
        out = subprocess.check_output(["identify", "-format", "%w %h", str(frame)]).decode().split()
        ow, oh = int(out[0]), int(out[1])

        fh = phash(frame)
        ranked = sorted(shot_hashes, key=lambda x: fh - x[1])
        best, dist = ranked[0][0], (fh - ranked[0][1])
        runner_dist = (fh - ranked[1][1]) if len(ranked) > 1 else None
        flag = ""
        if dist > 30:
            flag = "  ⚠ SUSPECT (high dist)"
        print(f"[{key}] {frame.name} ({ow}x{oh}) <- {best.name}  d={dist}  next={runner_dist}{flag}", file=sys.stderr)

        tmp = frame.with_suffix(".tmp.jpg")
        subprocess.run([
            "magick", str(best),
            "-resize", f"{ow}x{oh}^",
            "-gravity", "center",
            "-extent", f"{ow}x{oh}",
            "-quality", "88",
            str(tmp),
        ], check=True)
        shutil.move(str(tmp), str(frame))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("keys", nargs="+")
    args = ap.parse_args()
    for key in args.keys:
        replace_for(key)


if __name__ == "__main__":
    main()
