#!/usr/bin/env python3
"""Pick N non-text-graphic stills from a key's dense sample pool.

For each key, walks /tmp/dense/<key>/dense_*.jpg (already at 320 wide).
Filters out frames in the first 5% and last 15% of the timeline so the
intro/end title cards don't qualify. Runs Tesseract OCR over each
candidate to score `text_load` (sum of word confidences × length).
Scores remaining frames as sharp × contrast × (1 / (1 + text_load))
so sharp, high-contrast, low-text frames win. Buckets the surviving
timeline into N slices and picks the top scorer in each bucket.

Outputs the matched HQ frames into img/<key>/frame{slot}.jpg where
`slot` is provided per-key (so you can replace only frame4 of one key
and all four of another).

Usage:
  pick_no_text.py <key> <slot[,slot,...]> [--fps 10]
  e.g. pick_no_text.py comm_wls 1,2,3,4
       pick_no_text.py comm_stritt 4
"""

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
import pytesseract
from PIL import Image

REPO = Path("/Users/alexwalker/Coding Projects/Portfolio Website Redesign")
STILLS = Path("/tmp/movie_stills")
DENSE = Path("/tmp/dense")


def frame_to_seconds(name: str, fps: float) -> float:
    m = re.match(r"dense_(\d+)\.jpg$", name)
    return -1 if not m else (int(m.group(1)) - 1) / fps


def _ocr_score(img_gray) -> float:
    """Inner: run tesseract on a grayscale ndarray, return word-confidence
    × length sum (filtered to conf>40, len>=2)."""
    try:
        data = pytesseract.image_to_data(img_gray, output_type=pytesseract.Output.DICT, config='--psm 6')
    except Exception:
        return 0.0
    total = 0.0
    for conf, text in zip(data['conf'], data['text']):
        try:
            c = float(conf)
        except ValueError:
            continue
        if c <= 40:
            continue
        t = (text or '').strip()
        if len(t) < 2:
            continue
        total += (c / 100.0) * len(t)
    return total


def text_load(path: Path, source: Path, t: float) -> float:
    """OCR-based text-density measure. The 320-wide dense thumbnail is too
    small for tesseract on white-on-busy-background overlays, so we also
    pull a 1280-wide frame from source.mp4 at the exact timestamp and run
    OCR against both. Title cards score in the hundreds; clean shots
    score under ~5."""
    img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        return 0.0
    low_res_score = _ocr_score(img)

    # Pull a higher-res grayscale frame for the heavy lift
    try:
        proc = subprocess.run([
            "ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error",
            "-ss", f"{t:.3f}", "-i", str(source),
            "-frames:v", "1", "-vf", "scale=1280:-1,format=gray",
            "-f", "image2pipe", "-vcodec", "mjpeg", "-",
        ], capture_output=True, check=True, timeout=10)
        buf = np.frombuffer(proc.stdout, dtype=np.uint8)
        hi = cv2.imdecode(buf, cv2.IMREAD_GRAYSCALE)
        hi_res_score = _ocr_score(hi) if hi is not None else 0.0
    except Exception:
        hi_res_score = 0.0

    return max(low_res_score, hi_res_score)


def score(path: Path) -> float:
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
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
    contrast = std / 128.0
    return float(sharp * exposure * (0.4 + contrast))


def pick_for(key: str, slots: list[int], fps: float):
    dense_dir = DENSE / key
    samples = sorted(dense_dir.glob("dense_*.jpg"))
    if not samples:
        print(f"[{key}] no dense samples — run match_4k_dense.py first to populate /tmp/dense/{key}/", file=sys.stderr)
        return

    duration = (len(samples) - 1) / fps
    # Filter out intro (first 5%) and outro (last 15%) — where text cards live.
    lo_t = max(1.0, duration * 0.05)
    hi_t = duration * 0.85
    print(f"[{key}] duration ≈ {duration:.1f}s, considering {lo_t:.1f}s–{hi_t:.1f}s window", file=sys.stderr)

    # OCR is slow (~1s per 1280-wide pass), so sub-sample to ~2/sec.
    stride = max(1, int(round(fps / 2.0)))
    candidates = []
    for i, s in enumerate(samples):
        if i % stride != 0:
            continue
        t = frame_to_seconds(s.name, fps)
        if t < lo_t or t > hi_t:
            continue
        candidates.append((s, t))

    print(f"[{key}] {len(candidates)} candidates in window. Scoring + OCR...", file=sys.stderr)
    source = STILLS / key / "source.mp4"
    scored = []
    for s, t in candidates:
        sc = score(s)
        if sc < 0:
            continue
        tl = text_load(s, source, t)
        # Heavy penalty for any detected text.
        final = sc / (1.0 + tl * 2.0)
        scored.append((s, t, sc, tl, final))

    if not scored:
        print(f"[{key}] no usable candidates", file=sys.stderr)
        return

    # Sort by timestamp for bucketing
    scored.sort(key=lambda x: x[1])
    # Bucket timeline into N equal slices, pick top finalscore in each.
    n = len(scored)
    count = len(slots)
    picks = []
    for i in range(count):
        lo = (n * i) // count
        hi = (n * (i + 1)) // count
        bucket = scored[lo:hi] or scored[lo:lo + 1]
        best = max(bucket, key=lambda x: x[4])
        picks.append(best)

    # Extract HQ frame from source.mp4 at matched timestamp + resize to fit
    # existing target frame's dims (center-crop cover).
    out_dir = REPO / "img" / key
    for slot, p in zip(slots, picks):
        s_path, t, sc, tl, final = p
        target = out_dir / f"frame{slot}.jpg"
        # Read existing target dims to preserve them
        info = subprocess.check_output(["identify", "-format", "%w %h", str(target)]).decode().split()
        ow, oh = int(info[0]), int(info[1])
        print(f"[{key}] frame{slot} ({ow}x{oh}) <- t={t:.2f}s  sharp={sc:.1f}  text_load={tl:.1f}  final={final:.1f}", file=sys.stderr)
        tmp_raw = target.with_suffix(".raw.jpg")
        tmp_out = target.with_suffix(".tmp.jpg")
        subprocess.run([
            "ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error",
            "-ss", f"{t:.3f}", "-i", str(source),
            "-frames:v", "1", "-q:v", "2", "-y", str(tmp_raw),
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
        shutil.move(str(tmp_out), str(target))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("key")
    ap.add_argument("slots", help="comma-separated slot indices, e.g. 4 or 1,2,3,4")
    ap.add_argument("--fps", type=float, default=10.0)
    args = ap.parse_args()
    slots = [int(s) for s in args.slots.split(",")]
    pick_for(args.key, slots, args.fps)


if __name__ == "__main__":
    main()
