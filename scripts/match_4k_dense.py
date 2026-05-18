#!/usr/bin/env python3
"""Replace existing img/<key>/frame*.jpg with 4K twins via dense sampling.

For each video:
  1. Periodically sample frames from /tmp/movie_stills/<key>/source.mp4
     into /tmp/dense/<key>/ at low-res (320 wide) — fast pHash candidates.
  2. For each existing frame, pHash and find closest match in the dense pool.
  3. Determine matched timestamp from filename, then ffmpeg-seek into the
     full-res source.mp4 at that timestamp and pull a high-quality JPEG.
  4. Resize to original frame's exact WxH (center-crop cover), overwrite.

Dense sampling sidesteps scene-detection failures: every commercial gets
thousands of candidates regardless of editing style.

Usage:  match_4k_dense.py key1 [key2 ...] [--fps 2]
"""

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

import imagehash
from PIL import Image

REPO = Path("/Users/alexwalker/Coding Projects/Portfolio Website Redesign")
STILLS_ROOT = Path("/tmp/movie_stills")
DENSE_ROOT = Path("/tmp/dense")


def phash(p: Path):
    return imagehash.phash(Image.open(p), hash_size=16)


def dense_sample(video: Path, dest: Path, fps: float):
    """ffmpeg-extract at fps Hz, scaled to width=320 for fast hashing.
    Filename encodes the timestamp: dense_HHMMSS_mmm.jpg via frame index."""
    dest.mkdir(parents=True, exist_ok=True)
    # Clear stale samples
    for old in dest.glob("dense_*.jpg"):
        old.unlink()
    # Use ffmpeg to stamp the timestamp into the filename via frame_pts
    # Simpler: name by frame number, compute time = frame_num / fps
    pattern = str(dest / "dense_%06d.jpg")
    subprocess.run([
        "ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error",
        "-i", str(video),
        "-vf", f"fps={fps},scale=320:-1",
        "-q:v", "3",
        pattern,
    ], check=True)


def frame_to_seconds(name: str, fps: float) -> float:
    m = re.match(r"dense_(\d+)\.jpg$", name)
    if not m:
        return -1
    return (int(m.group(1)) - 1) / fps


def replace_for(key: str, fps: float):
    img_dir = REPO / "img" / key
    frames = sorted(img_dir.glob("frame*.jpg"))
    source = STILLS_ROOT / key / "source.mp4"
    dense_dir = DENSE_ROOT / key
    if not frames:
        print(f"[{key}] no existing frames on site", file=sys.stderr)
        return
    if not source.exists():
        print(f"[{key}] no source.mp4", file=sys.stderr)
        return

    print(f"[{key}] dense-sampling {source.name} at {fps} fps...", file=sys.stderr)
    dense_sample(source, dense_dir, fps)
    samples = sorted(dense_dir.glob("dense_*.jpg"))
    print(f"[{key}] hashing {len(samples)} candidates...", file=sys.stderr)
    sample_hashes = [(s, phash(s)) for s in samples]

    for frame in frames:
        out = subprocess.check_output(["identify", "-format", "%w %h", str(frame)]).decode().split()
        ow, oh = int(out[0]), int(out[1])

        fh = phash(frame)
        ranked = sorted(sample_hashes, key=lambda x: fh - x[1])
        best_path, best_dist = ranked[0][0], (fh - ranked[0][1])
        runner_dist = (fh - ranked[1][1]) if len(ranked) > 1 else None
        t = frame_to_seconds(best_path.name, fps)
        flag = "  ⚠ SUSPECT" if best_dist > 30 else ""
        print(f"[{key}] {frame.name} ({ow}x{oh}) <- t={t:7.2f}s  d={best_dist}  next={runner_dist}{flag}", file=sys.stderr)

        # ffmpeg-seek into full-res source at matched timestamp, pull HQ JPEG,
        # then resize to original frame's exact dims (center-crop cover).
        tmp_raw = frame.with_suffix(".raw.jpg")
        tmp_out = frame.with_suffix(".tmp.jpg")
        subprocess.run([
            "ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error",
            "-ss", f"{t:.3f}", "-i", str(source),
            "-frames:v", "1", "-q:v", "2", "-y",
            str(tmp_raw),
        ], check=True)
        subprocess.run([
            "magick", str(tmp_raw),
            "-resize", f"{ow}x{oh}^",
            "-gravity", "center",
            "-extent", f"{ow}x{oh}",
            "-quality", "88",
            str(tmp_out),
        ], check=True)
        tmp_raw.unlink()
        shutil.move(str(tmp_out), str(frame))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("keys", nargs="+")
    ap.add_argument("--fps", type=float, default=2.0)
    args = ap.parse_args()
    for key in args.keys:
        replace_for(key, args.fps)


if __name__ == "__main__":
    main()
