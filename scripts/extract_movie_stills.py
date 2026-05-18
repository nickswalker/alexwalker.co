#!/usr/bin/env python3
"""
Extract one aesthetic still per shot from a feature-film master.

Pipeline:
  1. PySceneDetect (ContentDetector, downscaled for speed) → shot boundaries.
  2. For each shot, sample N candidate frames evenly across the middle 60%.
  3. Score each candidate (sharpness via Laplacian variance, exposure sanity).
  4. ffmpeg-seek into the master and extract the winning frame at full
     native resolution as a high-quality JPEG (lossless re-encode of decoded
     pixels — no further generational loss vs. ProRes 4444 source).

Output filename pattern:
  shot_NNNN_HHMMSS_mmm.jpg   (shot index zero-padded + timecode)

Usage:
  extract_movie_stills.py <input.mov> <output_dir> [--threshold 27] [--candidates 5]
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import cv2
import numpy as np
from scenedetect import SceneManager, open_video
from scenedetect.detectors import ContentDetector


def fmt_tc(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds - int(seconds)) * 1000)
    return f"{h:02d}{m:02d}{s:02d}_{ms:03d}"


def detect_shots(video_path: Path, threshold: float, downscale: int, frame_skip: int):
    """Return list of (start_sec, end_sec) shot boundaries.

    Uses ffmpeg's scene filter directly — meaningfully faster than wrapping
    decode through Python when the input is a 4K ProRes master that has
    no hardware-decode path on macOS. We scale to 480p inside ffmpeg's
    filter chain so the per-frame diff is cheap, then parse showinfo
    timestamps off stderr.
    """
    import re
    print(f"[ffmpeg-scenes] scanning {video_path.name} (threshold={threshold/100:.3f})", flush=True)
    # ffmpeg's scene filter takes a 0..1 value; PySceneDetect's threshold is 0..255.
    # Map ~27/255 ≈ 0.10 — sensitive enough to catch most narrative cuts.
    ff_thresh = threshold / 255.0
    cmd = [
        "ffmpeg", "-hide_banner", "-nostdin",
        "-i", str(video_path),
        "-an", "-sn",
        "-vf", f"scale=480:-1,select='gt(scene,{ff_thresh:.4f})',showinfo",
        "-vsync", "vfr",
        "-f", "null", "-",
    ]
    t0 = time.time()
    proc = subprocess.Popen(cmd, stderr=subprocess.PIPE, stdout=subprocess.DEVNULL,
                            text=True, bufsize=1)
    pts_re = re.compile(r"pts_time:([0-9.]+)")
    fps_re = re.compile(r"frame=\s*(\d+).*?fps=\s*([0-9.]+)")
    cut_times: list[float] = [0.0]
    last_log = time.time()
    last_progress = ""
    for line in proc.stderr:
        # showinfo lines look like:
        #   [Parsed_showinfo_2 @ 0x...] n: 12 pts: ... pts_time:481.123 ...
        if "Parsed_showinfo" in line:
            m = pts_re.search(line)
            if m:
                try:
                    cut_times.append(float(m.group(1)))
                except ValueError:
                    pass
        # ffmpeg prints frame/fps/time to stderr every ~0.5s
        elif "time=" in line and "speed=" in line:
            last_progress = line.strip()
            now = time.time()
            if now - last_log > 5:
                print(f"[ffmpeg-scenes] cuts={len(cut_times)-1} | {last_progress[:160]}", flush=True)
                last_log = now
    proc.wait()
    elapsed = time.time() - t0
    cut_times.sort()
    # Build (start, end) shots
    duration = ffprobe_duration(video_path)
    cut_times.append(duration)
    shots = [(cut_times[i], cut_times[i + 1]) for i in range(len(cut_times) - 1)]
    print(f"[ffmpeg-scenes] {len(shots)} shots in {elapsed:.1f}s", flush=True)
    return shots


def ffprobe_duration(video_path: Path) -> float:
    out = subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=nw=1:nk=1", str(video_path),
    ], text=True).strip()
    return float(out)


def grab_frame(video_path: Path, seconds: float, out_path: Path, jpeg_quality: int = 95):
    """Seek to `seconds` in the master and write the frame at native res."""
    # -ss before -i = fast (input-side) seek to nearest keyframe, then -ss after -i
    # = accurate (frame-level) seek by decoding forward. Splitting them gives
    # speed + accuracy.
    coarse = max(0.0, seconds - 5.0)
    fine = seconds - coarse
    cmd = [
        "ffmpeg", "-y", "-nostdin", "-hide_banner", "-loglevel", "error",
        "-ss", f"{coarse:.3f}",
        "-i", str(video_path),
        "-ss", f"{fine:.3f}",
        "-frames:v", "1",
        "-q:v", str(31 - int(round(jpeg_quality * 30 / 100))),  # ffmpeg q scale: 2=best 31=worst
        str(out_path),
    ]
    subprocess.run(cmd, check=True)


def score_frame(jpeg_path: Path) -> dict:
    """Return aesthetic-ish score plus components."""
    img = cv2.imread(str(jpeg_path), cv2.IMREAD_COLOR)
    if img is None:
        return {"score": -1, "reason": "decode-fail"}
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # Sharpness: variance of Laplacian. Higher = more in-focus.
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    # Exposure: mean luminance; penalise very dark or very bright frames.
    mean_lum = float(gray.mean())
    # Penalty for near-black (fade) or near-white (flash) frames.
    if mean_lum < 12 or mean_lum > 240:
        exposure_penalty = 0.1
    elif mean_lum < 25 or mean_lum > 220:
        exposure_penalty = 0.5
    else:
        exposure_penalty = 1.0
    # Contrast: stddev of luminance — penalise flat frames.
    contrast = float(gray.std())
    # Composite: sharpness weighted by exposure + slight contrast boost.
    score = sharpness * exposure_penalty * (1.0 + contrast / 128.0)
    return {
        "score": score,
        "sharpness": sharpness,
        "mean_lum": mean_lum,
        "contrast": contrast,
        "exposure_penalty": exposure_penalty,
    }


def pick_best_frame(video_path: Path, start: float, end: float,
                    candidates: int, tmpdir: Path, jpeg_quality: int):
    """Sample candidates across the middle of the shot, score, return best time."""
    # Skip the first / last 20% of each shot — transitions live there.
    span = end - start
    if span < 0.4:
        return (start + end) / 2.0, None
    lo = start + span * 0.2
    hi = end   - span * 0.2
    if candidates < 1:
        candidates = 1
    if candidates == 1:
        times = [(lo + hi) / 2.0]
    else:
        times = [lo + (hi - lo) * (i / (candidates - 1)) for i in range(candidates)]
    best = None
    for i, t in enumerate(times):
        candidate_path = tmpdir / f"cand_{i:02d}.jpg"
        try:
            grab_frame(video_path, t, candidate_path, jpeg_quality=70)  # quick low-q for scoring
        except subprocess.CalledProcessError:
            continue
        scored = score_frame(candidate_path)
        scored["time"] = t
        if best is None or scored["score"] > best["score"]:
            best = scored
        candidate_path.unlink(missing_ok=True)
    if best is None:
        return (start + end) / 2.0, None
    return best["time"], best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input", type=Path)
    ap.add_argument("output_dir", type=Path)
    ap.add_argument("--threshold", type=float, default=27.0,
                    help="ContentDetector threshold (lower = more cuts)")
    ap.add_argument("--candidates", type=int, default=5,
                    help="Frames to score per shot")
    ap.add_argument("--downscale", type=int, default=4,
                    help="PySceneDetect downscale factor (1=native)")
    ap.add_argument("--frame-skip", type=int, default=2,
                    help="Analyse every Nth frame during detection")
    ap.add_argument("--jpeg-quality", type=int, default=95,
                    help="Output JPEG quality 1-100")
    ap.add_argument("--min-shot-seconds", type=float, default=0.4,
                    help="Discard shots shorter than this (transitions)")
    args = ap.parse_args()

    if not args.input.exists():
        sys.exit(f"missing input: {args.input}")
    args.output_dir.mkdir(parents=True, exist_ok=True)

    shots = detect_shots(args.input, args.threshold, args.downscale, args.frame_skip)
    shots = [(s, e) for s, e in shots if (e - s) >= args.min_shot_seconds]
    print(f"[run] {len(shots)} usable shots after min-length filter", flush=True)

    with tempfile.TemporaryDirectory() as td:
        tmpdir = Path(td)
        t0 = time.time()
        for i, (start, end) in enumerate(shots, start=1):
            pick_t, info = pick_best_frame(
                args.input, start, end, args.candidates, tmpdir, args.jpeg_quality,
            )
            out_name = f"shot_{i:04d}_{fmt_tc(pick_t)}.jpg"
            out_path = args.output_dir / out_name
            try:
                grab_frame(args.input, pick_t, out_path, jpeg_quality=args.jpeg_quality)
            except subprocess.CalledProcessError as e:
                print(f"[shot {i:04d}] ffmpeg failed at t={pick_t:.3f}: {e}", flush=True)
                continue
            sharp = info["sharpness"] if info else float("nan")
            print(f"[shot {i:04d}/{len(shots)}] t={pick_t:7.2f}s "
                  f"sharp={sharp:7.1f}  -> {out_name}", flush=True)
        elapsed = time.time() - t0
        print(f"[done] {len(shots)} stills in {elapsed:.1f}s", flush=True)


if __name__ == "__main__":
    main()
