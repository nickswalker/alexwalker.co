#!/usr/bin/env python3
"""
Generate a replacement movie poster from a 4K master + an existing poster
as the visual reference.

Pipeline:
  1. Load existing poster, crop off the title bar (bottom 25%) so we match
     against the photograph only.
  2. Scan the master at ~2 fps, computing per-frame color histograms in
     downscaled grayscale + LAB space. Score each candidate against the
     poster reference; keep the top-N closest matches.
  3. For each top candidate, run face detection (Haar frontal). Score the
     candidate's face count + face geometry against the poster reference.
     This catches cases where the histogram match isn't quite the right
     moment (e.g. similar lighting but no face).
  4. Pick the winning frame, re-extract at full 4K resolution via ffmpeg
     (so we get an actual frame, not a downscaled-then-upscaled one).
  5. Crop to 2:3 portrait centered on the detected face(s), with eyeline
     near the top-third. Output is 1200×1800 JPEG.

Usage:
  poster_from_master.py <master.mov> <reference_poster.jpg> <output.jpg>
"""

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np


YUNET_PATH = (Path(__file__).parent / "models" / "face_detection_yunet_2023mar.onnx")


# ------------------------------------------------------------------ utilities

def ffprobe_duration(video: Path) -> float:
    out = subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(video),
    ]).decode().strip()
    return float(out)


def ffprobe_dims(video: Path):
    out = subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "csv=p=0", str(video),
    ]).decode().strip()
    w, h = out.split(",")
    return int(w), int(h)


def phash(img_bgr, hash_size=16):
    """Perceptual hash via DCT — captures structural composition
    (edges, lights/darks, layout) robustly, much better than a global
    color histogram for "which moment in the film" matching where the
    title sequence might share a colour palette with a scene."""
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(gray, (hash_size * 4, hash_size * 4),
                       interpolation=cv2.INTER_AREA).astype(np.float32)
    dct = cv2.dct(small)
    low = dct[:hash_size, :hash_size]
    med = np.median(low[1:].flatten())  # skip DC
    return (low > med).flatten()


def histogram_features(img_bgr, size=(192, 108)):
    """Compact per-frame signature: pHash (structural) + small grayscale
    histogram + downsampled LAB color grid (color layout)."""
    small = cv2.resize(img_bgr, size, interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    h_gray = cv2.calcHist([gray], [0], None, [32], [0, 256])
    cv2.normalize(h_gray, h_gray)
    lab = cv2.cvtColor(small, cv2.COLOR_BGR2LAB)
    lab_grid = cv2.resize(lab, (24, 13), interpolation=cv2.INTER_AREA)
    ph = phash(small)
    return ph, h_gray.flatten(), lab_grid.astype(np.float32).flatten()


def distance(ref_features, cand_features):
    ph_ref, h_ref, lab_ref = ref_features
    ph_c, h_c, lab_c = cand_features
    # Hamming distance on the perceptual hash, normalised to [0,1]
    ph_dist = float(np.count_nonzero(ph_ref != ph_c)) / len(ph_ref)
    h_dist = 1.0 - cv2.compareHist(h_ref.astype(np.float32),
                                   h_c.astype(np.float32),
                                   cv2.HISTCMP_CORREL)
    lab_dist = float(np.linalg.norm(lab_ref - lab_c)) / np.linalg.norm(lab_ref + 1e-6)
    # pHash carries most of the structural signal; LAB grid gives a
    # cheap "color layout" assist; the global histogram is a tiebreaker
    return 0.60 * ph_dist + 0.30 * lab_dist + 0.10 * h_dist


_yunet = None
_yunet_threshold = 0.75
def _get_detector(w, h):
    global _yunet
    if _yunet is None:
        _yunet = cv2.FaceDetectorYN.create(
            str(YUNET_PATH), "", (w, h),
            score_threshold=_yunet_threshold,
            nms_threshold=0.3,
            top_k=20,
        )
    else:
        _yunet.setInputSize((w, h))
    return _yunet


def set_face_threshold(t):
    global _yunet, _yunet_threshold
    _yunet_threshold = t
    _yunet = None  # force re-create


def detect_faces(img_bgr, min_face_frac=0.04):
    """YuNet DNN face detector. Filters out any face smaller than
    `min_face_frac` of the image's shorter side — kills false positives
    in busy backgrounds (leaves, hands, fabric patterns) that bedeviled
    the Haar cascade."""
    h, w = img_bgr.shape[:2]
    det = _get_detector(w, h)
    _, faces = det.detect(img_bgr)
    if faces is None:
        return []
    short_side = min(w, h)
    min_face = int(short_side * min_face_frac)
    out = []
    for f in faces:
        x, y, fw, fh = int(f[0]), int(f[1]), int(f[2]), int(f[3])
        if fw < min_face or fh < min_face:
            continue
        # Clip to image bounds (YuNet sometimes returns negative anchors)
        x = max(0, x); y = max(0, y)
        fw = min(w - x, fw); fh = min(h - y, fh)
        if fw <= 0 or fh <= 0:
            continue
        out.append((x, y, fw, fh, float(f[14])))  # last value is confidence
    return out  # list of (x, y, w, h, conf)


# ------------------------------------------------------------------ pipeline

def extract_frame(video: Path, t_sec: float, out_path: Path):
    """Pull one frame at the highest possible quality. -ss BEFORE -i for
    fast input seek; quality scaled at JPEG encode."""
    subprocess.check_call([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-ss", f"{t_sec:.3f}", "-i", str(video),
        "-frames:v", "1", "-q:v", "1", str(out_path),
    ])


def scan_film(video: Path, ref_features, sample_hz=2.0, max_seconds=None,
              skip_leading=60.0, skip_trailing=45.0):
    """Walk through the video extracting low-res candidate frames.
    Returns sorted list of (distance, t_sec).

    skip_leading/skip_trailing avoid the title sequence and credits roll,
    which often share a color palette with the main film and pollute
    histogram-based matching with false positives."""
    duration = ffprobe_duration(video)
    if max_seconds:
        duration = min(duration, max_seconds)
    step = 1.0 / sample_hz
    candidates = []
    scan_start = skip_leading
    scan_end = max(skip_leading + step, duration - skip_trailing)
    print(f"[scan] {video.name}: {duration:.1f}s total, scanning {scan_start:.0f}-{scan_end:.0f}s at {sample_hz} Hz", flush=True)

    # Use ffmpeg's image2pipe to pump downscaled frames as raw RGB
    # We could subprocess one ffmpeg per timestamp but that's slow on big
    # files. Instead, decode the whole file once at low res in a stream.
    width_lr, height_lr = 384, 216
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-ss", f"{scan_start:.3f}",
        "-to", f"{scan_end:.3f}",
        "-i", str(video),
        "-vf", f"fps={sample_hz},scale={width_lr}:{height_lr}",
        "-pix_fmt", "rgb24", "-f", "image2pipe", "-vcodec", "rawvideo", "-",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            bufsize=10**8)
    frame_size = width_lr * height_lr * 3
    idx = 0
    while True:
        buf = proc.stdout.read(frame_size)
        if len(buf) < frame_size:
            break
        frame = np.frombuffer(buf, dtype=np.uint8).reshape(height_lr, width_lr, 3)
        bgr = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
        cand_feat = histogram_features(bgr)
        d = distance(ref_features, cand_feat)
        t = scan_start + (idx / sample_hz)
        candidates.append((d, t))
        idx += 1
        if max_seconds and t > max_seconds:
            break
    proc.wait()
    candidates.sort(key=lambda x: x[0])
    return candidates


def trim_letterbox(img, threshold=14, min_run=8):
    """Detect and crop letterbox/pillarbox black bars from a frame.
    Returns (cropped_img, (x0, y0, x1, y1)) bounds in the original.

    threshold: rows/cols whose mean brightness is below this are
               considered black bar (0..255).
    min_run:   ignore bars shorter than this — guards against false
               positives from very dark frames where the actual image
               has near-black rows."""
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    row_mean = gray.mean(axis=1)
    col_mean = gray.mean(axis=0)

    def first_bright(arr):
        for i, v in enumerate(arr):
            if v > threshold:
                return i
        return 0

    top = first_bright(row_mean)
    bot = len(row_mean) - first_bright(row_mean[::-1])
    left = first_bright(col_mean)
    right = len(col_mean) - first_bright(col_mean[::-1])

    # Only accept the trim if the detected bar is meaningful AND symmetric-ish
    # (real letterbox is symmetric; if we only see one bar it's probably a
    # dark scene element, not a bar).
    if top + (h - bot) < min_run:
        top, bot = 0, h
    if left + (w - right) < min_run:
        left, right = 0, w

    if (top, left, bot, right) == (0, 0, h, w):
        return img, (0, 0, w, h)
    return img[top:bot, left:right], (left, top, right, bot)


def best_crop_2x3(img, faces, target_h=1800, target_w=1200):
    """Compute a 2:3 portrait crop centred on detected faces, with eyeline
    near the top third. Falls back to center crop if no faces detected.
    `faces` is a list of (x, y, w, h, conf) tuples from YuNet.

    Detects + trims letterbox bars before cropping so the final poster
    fills the frame without baked-in black bars from cinematic-aspect
    masters (e.g. 2.39:1 letterboxed into a 16:9 container)."""
    # 1) Trim letterbox
    trimmed, (lx, ly, _rx, _ry) = trim_letterbox(img)
    if trimmed.shape != img.shape:
        # Faces were detected on the un-trimmed image — shift their
        # coordinates into the trimmed image's frame.
        faces = [(x - lx, y - ly, fw, fh, c) for (x, y, fw, fh, c) in faces
                 if x - lx >= 0 and y - ly >= 0
                 and x - lx + fw <= trimmed.shape[1]
                 and y - ly + fh <= trimmed.shape[0]]
    img = trimmed
    h, w = img.shape[:2]

    if len(faces) == 0:
        # Fallback: centre crop
        target_aspect = target_w / target_h  # 2/3
        if w / h > target_aspect:
            crop_w = int(h * target_aspect)
            x0 = (w - crop_w) // 2
            crop = img[:, x0:x0 + crop_w]
        else:
            crop_h = int(w / target_aspect)
            y0 = (h - crop_h) // 2
            crop = img[y0:y0 + crop_h, :]
        return cv2.resize(crop, (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)

    # Bounding box of all detected faces (each face is x,y,w,h[,conf])
    xs = [f[0] for f in faces]
    ys = [f[1] for f in faces]
    xe = [f[0] + f[2] for f in faces]
    ye = [f[1] + f[3] for f in faces]
    fx0, fy0, fx1, fy1 = min(xs), min(ys), max(xe), max(ye)
    fw, fh = fx1 - fx0, fy1 - fy0
    fcx = (fx0 + fx1) / 2.0
    # Eyeline is roughly the upper 1/3 of the face bbox
    eyeline_y = fy0 + 0.35 * fh

    target_aspect = target_w / target_h  # 2/3 ≈ 0.667
    # Pick crop dimensions: prefer to maximise size while keeping all
    # faces in frame and giving headroom above the eyeline
    src_aspect = w / h

    # Try the tallest crop that fits in the image; eyeline at top-third
    crop_h = h
    crop_w = int(crop_h * target_aspect)
    if crop_w > w:
        crop_w = w
        crop_h = int(crop_w / target_aspect)

    # Position: center horizontally on faces' centroid, eyeline at ~0.33 of
    # crop height from the top.
    x0 = int(fcx - crop_w / 2)
    y0 = int(eyeline_y - 0.33 * crop_h)

    # Clamp to image bounds; if faces don't fit, expand crop to include them
    x0 = max(0, min(w - crop_w, x0))
    y0 = max(0, min(h - crop_h, y0))

    # Safety: ensure all face bboxes are inside the crop
    if not (x0 <= fx0 and y0 <= fy0 and x0 + crop_w >= fx1 and y0 + crop_h >= fy1):
        # Crop too small to contain all faces — expand to faces' bbox + padding
        pad_x = max(20, int(fw * 0.15))
        pad_y = max(20, int(fh * 0.40))
        req_w = (fx1 - fx0) + 2 * pad_x
        req_h = (fy1 - fy0) + 2 * pad_y
        # Adjust to 2:3 aspect
        if req_w / req_h > target_aspect:
            req_h = int(req_w / target_aspect)
        else:
            req_w = int(req_h * target_aspect)
        crop_w = min(w, req_w)
        crop_h = min(h, req_h)
        # Re-aspect after clamping
        if crop_w / crop_h > target_aspect:
            crop_w = int(crop_h * target_aspect)
        else:
            crop_h = int(crop_w / target_aspect)
        x0 = int(fcx - crop_w / 2)
        y0 = int(eyeline_y - 0.33 * crop_h)
        x0 = max(0, min(w - crop_w, x0))
        y0 = max(0, min(h - crop_h, y0))

    crop = img[y0:y0 + crop_h, x0:x0 + crop_w]
    return cv2.resize(crop, (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("master", type=Path)
    ap.add_argument("reference", type=Path, help="existing poster jpg")
    ap.add_argument("output", type=Path)
    ap.add_argument("--sample-hz", type=float, default=2.0)
    ap.add_argument("--top-n", type=int, default=8)
    ap.add_argument("--debug-dir", type=Path, default=None)
    ap.add_argument("--contact-sheet", type=Path, default=None,
                    help="If set, write a contact sheet of the top-N candidates here.")
    ap.add_argument("--pick-time", type=float, default=None,
                    help="Skip matching and use this exact timestamp (seconds).")
    ap.add_argument("--face-threshold", type=float, default=0.75,
                    help="YuNet score threshold. Lower = catches more profile / "
                         "occluded / closed-eye faces (default 0.75).")
    ap.add_argument("--skip-leading", type=float, default=60.0)
    ap.add_argument("--skip-trailing", type=float, default=45.0)
    args = ap.parse_args()
    set_face_threshold(args.face_threshold)

    # Load reference poster, strip the title bar (bottom 28% typical)
    ref = cv2.imread(str(args.reference))
    if ref is None:
        sys.exit(f"can't read {args.reference}")
    h_ref = ref.shape[0]
    ref_photo = ref[: int(h_ref * 0.72), :]
    ref_features = histogram_features(ref_photo)
    # Detect faces in the reference so we know what we're matching for
    ref_faces = detect_faces(ref_photo)
    ref_face_count = len(ref_faces)
    ref_face_centers = []
    if ref_faces:
        rph, rpw = ref_photo.shape[:2]
        for (x, y, fw, fh, _c) in ref_faces:
            cx = (x + fw / 2) / rpw   # normalised [0,1]
            cy = (y + fh / 2) / rph
            ref_face_centers.append((cx, cy, fw / rpw))
    print(f"[ref] {args.reference.name}: {ref.shape[1]}x{ref.shape[0]} → photo area {ref_photo.shape[1]}x{ref_photo.shape[0]}; faces={ref_face_count}", flush=True)

    # If user supplied --pick-time, skip scan and just re-extract that one
    if args.pick_time is not None:
        work = Path(tempfile.mkdtemp(prefix="poster_"))
        fpath = work / f"pick_{args.pick_time:.1f}.jpg"
        extract_frame(args.master, args.pick_time, fpath)
        img = cv2.imread(str(fpath))
        faces = detect_faces(img)
        print(f"[pick] t={args.pick_time:.1f}s  faces={len(faces)}")
        out = best_crop_2x3(img, faces)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(args.output), out, [cv2.IMWRITE_JPEG_QUALITY, 92])
        print(f"[done] wrote {args.output} ({out.shape[1]}x{out.shape[0]})")
        return

    # Scan film
    candidates = scan_film(args.master, ref_features,
                           sample_hz=args.sample_hz,
                           skip_leading=args.skip_leading,
                           skip_trailing=args.skip_trailing)
    print(f"[scan] best raw distance: {candidates[0][0]:.4f} @ t={candidates[0][1]:.1f}s")

    # Re-score top-N by extracting a real frame and running face detection.
    # The candidate frame buffer was downsampled; we want full-res for faces.
    src_w, src_h = ffprobe_dims(args.master)
    print(f"[src ] resolution {src_w}x{src_h}")

    work = tempfile.mkdtemp(prefix="poster_")
    work = Path(work)
    scored = []
    for i, (dist, t) in enumerate(candidates[: args.top_n]):
        fpath = work / f"cand_{i:02d}_t{t:.1f}.jpg"
        extract_frame(args.master, t, fpath)
        img = cv2.imread(str(fpath))
        if img is None:
            continue
        faces = detect_faces(img)
        # Score adjustment: posters are face-forward shots, so the
        # candidate's face count + face POSITION should roughly match
        # the reference poster's. Frames with zero faces almost never
        # win for a portrait poster; frames with the right face count
        # at roughly the right screen position get a strong bonus.
        ih, iw = img.shape[:2]
        face_pos_penalty = 0.0
        if ref_face_centers and faces:
            cand_centers = [((x + fw / 2) / iw, (y + fh / 2) / ih)
                            for (x, y, fw, fh, _c) in faces]
            # For each ref face, find nearest candidate face by position
            for (rcx, rcy, _rw) in ref_face_centers:
                nearest = min(((rcx - cx) ** 2 + (rcy - cy) ** 2)
                              for (cx, cy) in cand_centers)
                face_pos_penalty += nearest  # squared euclidean in normalised coords
            face_pos_penalty /= max(1, len(ref_face_centers))
        elif ref_face_count > 0 and not faces:
            # Ref has faces, candidate has none — almost certainly the wrong moment
            face_pos_penalty = 0.30

        count_diff = abs(len(faces) - ref_face_count)
        count_penalty = 0.05 * min(count_diff, 4)

        face_bonus = 0.0 if len(faces) == 0 else -0.10
        composite = dist + face_pos_penalty + count_penalty + face_bonus
        scored.append((composite, dist, t, fpath, faces))
        print(f"[score] t={t:6.1f}s  hist={dist:.4f}  faces={len(faces)}  pos_p={face_pos_penalty:.3f}  cnt_p={count_penalty:.3f}  → {composite:.4f}")
        if args.debug_dir:
            args.debug_dir.mkdir(parents=True, exist_ok=True)
            # Annotate faces and copy
            dbg = img.copy()
            for (x, y, fw, fh, _c) in faces:
                cv2.rectangle(dbg, (x, y), (x + fw, y + fh), (0, 255, 0), 4)
            cv2.imwrite(str(args.debug_dir / f"{args.master.stem}_cand{i:02d}_t{t:.1f}.jpg"), dbg, [cv2.IMWRITE_JPEG_QUALITY, 88])

    scored.sort(key=lambda x: x[0])
    if not scored:
        sys.exit("no candidates scored")
    # Print rank → timestamp so the user can pick by rank from the contact
    # sheet and we can re-extract with --pick-time later.
    print("[ranks]")
    for rank, (composite, dist, t, fpath, faces) in enumerate(scored):
        print(f"  #{rank:<2}  t={t:6.1f}s  score={composite:.4f}  faces={len(faces)}")

    # Contact sheet — handy for picking the right moment by eye when the
    # auto-match doesn't quite get it.
    if args.contact_sheet:
        cs_thumbs = []
        for rank, (composite, dist, t, fpath, faces) in enumerate(scored):
            img = cv2.imread(str(fpath))
            if img is None: continue
            # Annotate
            thumb = cv2.resize(img, (480, 270), interpolation=cv2.INTER_AREA)
            for (x, y, fw, fh, _c) in faces:
                sx, sy = 480 / img.shape[1], 270 / img.shape[0]
                cv2.rectangle(thumb,
                              (int(x*sx), int(y*sy)),
                              (int((x+fw)*sx), int((y+fh)*sy)),
                              (0, 255, 0), 2)
            label = f"#{rank}  t={t:.1f}s  d={composite:.3f}  faces={len(faces)}"
            cv2.rectangle(thumb, (0, 0), (480, 28), (0, 0, 0), -1)
            cv2.putText(thumb, label, (8, 20), cv2.FONT_HERSHEY_SIMPLEX,
                        0.55, (255, 255, 255), 1, cv2.LINE_AA)
            cs_thumbs.append((rank, t, thumb))
        # 4-column grid
        cols = 4
        rows = (len(cs_thumbs) + cols - 1) // cols
        sheet = np.zeros((rows * 270, cols * 480, 3), dtype=np.uint8)
        for idx, (_r, _t, thumb) in enumerate(cs_thumbs):
            r, c = divmod(idx, cols)
            sheet[r*270:(r+1)*270, c*480:(c+1)*480] = thumb
        args.contact_sheet.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(args.contact_sheet), sheet, [cv2.IMWRITE_JPEG_QUALITY, 88])
        print(f"[contact] wrote {args.contact_sheet}")

    composite, dist, t, fpath, faces = scored[0]
    print(f"[winner] t={t:.1f}s  faces={len(faces)}  composite={composite:.4f}")

    img = cv2.imread(str(fpath))
    out = best_crop_2x3(img, faces)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(args.output), out, [cv2.IMWRITE_JPEG_QUALITY, 92])
    print(f"[done] wrote {args.output} ({out.shape[1]}x{out.shape[0]})")


if __name__ == "__main__":
    main()
