#!/usr/bin/env python3
"""
Targeted scan: find moments where the frame contains TWO large faces
positioned in intimate close-up (adjacent / overlapping bounding boxes).
Designed specifically for poster-matching when the reference shows a
two-person tight portrait and the histogram-based matcher in
poster_from_master.py doesn't surface the right moment.

Usage:
  find_two_face_moments.py <master.mov> <out_contact_sheet.jpg>
                          [--sample-hz 4] [--top-n 40]
"""
import argparse
import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np

YUNET_PATH = (Path(__file__).parent / "models" / "face_detection_yunet_2023mar.onnx")
_yunet = None
def get_det(w, h, threshold=0.55):
    global _yunet
    if _yunet is None:
        _yunet = cv2.FaceDetectorYN.create(
            str(YUNET_PATH), "", (w, h),
            score_threshold=threshold, nms_threshold=0.3, top_k=20)
    else:
        _yunet.setInputSize((w, h))
    return _yunet


def detect(img):
    h, w = img.shape[:2]
    det = get_det(w, h)
    _, faces = det.detect(img)
    if faces is None:
        return []
    out = []
    short = min(w, h)
    for f in faces:
        x, y, fw, fh = int(f[0]), int(f[1]), int(f[2]), int(f[3])
        if fw < short * 0.04 or fh < short * 0.04:
            continue
        x = max(0, x); y = max(0, y)
        fw = min(w - x, fw); fh = min(h - y, fh)
        if fw <= 0 or fh <= 0:
            continue
        out.append((x, y, fw, fh, float(f[14])))
    return out


def two_face_score(faces, w, h):
    """Returns (score, info) — score: lower = better."""
    if len(faces) < 2:
        return 1e9, None
    # Find the best pair of large adjacent faces
    sized = sorted(faces, key=lambda f: -(f[2] * f[3]))[:4]
    best = None
    best_s = 1e9
    for i in range(len(sized)):
        for j in range(i + 1, len(sized)):
            a, b = sized[i], sized[j]
            # Each face should be reasonably large (>= 6% of image width)
            face_size = (a[2] / w + b[2] / w) / 2
            if face_size < 0.05:
                continue
            # Centers
            acx, acy = a[0] + a[2] / 2, a[1] + a[3] / 2
            bcx, bcy = b[0] + b[2] / 2, b[1] + b[3] / 2
            # Faces should be roughly the same height in the frame (vertical
            # alignment) and adjacent horizontally
            avg_w = (a[2] + b[2]) / 2
            vert_align = abs(acy - bcy) / max(a[3], b[3])
            horiz_gap = abs(acx - bcx) / avg_w
            if vert_align > 0.6:
                continue  # not at the same level
            if horiz_gap > 2.5 or horiz_gap < 0.7:
                continue  # too far apart or fully overlapping
            # Larger faces + tighter pair = lower score
            s = vert_align + 0.3 * abs(1.3 - horiz_gap) + max(0, 0.10 - face_size) * 5
            if s < best_s:
                best_s = s
                best = (a, b, face_size, vert_align, horiz_gap)
    if best is None:
        return 1e9, None
    return best_s, best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("master", type=Path)
    ap.add_argument("contact_sheet", type=Path)
    ap.add_argument("--sample-hz", type=float, default=4.0)
    ap.add_argument("--top-n", type=int, default=40)
    ap.add_argument("--skip-leading", type=float, default=15.0)
    ap.add_argument("--skip-trailing", type=float, default=15.0)
    args = ap.parse_args()

    # Probe duration
    dur = float(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(args.master),
    ]).decode().strip())
    scan_start = args.skip_leading
    scan_end = dur - args.skip_trailing
    print(f"[scan] {args.master.name}: {dur:.1f}s, scanning {scan_start:.0f}-{scan_end:.0f}s @ {args.sample_hz} Hz", flush=True)

    # Pipe medium-res frames through ffmpeg
    w_lr, h_lr = 854, 480  # 480p — big enough for reliable face detection
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-ss", f"{scan_start:.3f}", "-to", f"{scan_end:.3f}",
        "-i", str(args.master),
        "-vf", f"fps={args.sample_hz},scale={w_lr}:{h_lr}",
        "-pix_fmt", "rgb24", "-f", "image2pipe", "-vcodec", "rawvideo", "-",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=10**8)
    frame_size = w_lr * h_lr * 3

    results = []
    idx = 0
    while True:
        buf = proc.stdout.read(frame_size)
        if len(buf) < frame_size:
            break
        frame = np.frombuffer(buf, dtype=np.uint8).reshape(h_lr, w_lr, 3)
        bgr = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
        t = scan_start + idx / args.sample_hz
        idx += 1
        faces = detect(bgr)
        if len(faces) >= 2:
            score, info = two_face_score(faces, w_lr, h_lr)
            if info is not None:
                results.append((score, t, bgr.copy(), faces, info))
        if idx % 200 == 0:
            print(f"  ... {idx} frames processed, {len(results)} candidates so far", flush=True)
    proc.wait()
    print(f"[scan] done. {idx} frames, {len(results)} two-face candidates")

    results.sort(key=lambda x: x[0])
    top = results[: args.top_n]
    if not top:
        print("[!] no two-face moments found")
        return

    # Contact sheet
    cols = 4
    rows = (len(top) + cols - 1) // cols
    thumb_w, thumb_h = 480, 270
    sheet = np.zeros((rows * thumb_h, cols * thumb_w, 3), dtype=np.uint8)
    for i, (score, t, bgr, faces, info) in enumerate(top):
        thumb = cv2.resize(bgr, (thumb_w, thumb_h), interpolation=cv2.INTER_AREA)
        sx, sy = thumb_w / w_lr, thumb_h / h_lr
        # Highlight the chosen pair
        a, b, fs, va, hg = info
        for face, color in [(a, (0, 255, 255)), (b, (0, 255, 255))]:
            x, y, fw, fh, _c = face
            cv2.rectangle(thumb, (int(x * sx), int(y * sy)),
                          (int((x + fw) * sx), int((y + fh) * sy)),
                          color, 2)
        # Also other faces in dim color
        for face in faces:
            if face is a or face is b: continue
            x, y, fw, fh, _c = face
            cv2.rectangle(thumb, (int(x * sx), int(y * sy)),
                          (int((x + fw) * sx), int((y + fh) * sy)),
                          (80, 80, 80), 1)
        label = f"#{i}  t={t:.1f}s  s={score:.3f}  faces={len(faces)}"
        cv2.rectangle(thumb, (0, 0), (thumb_w, 28), (0, 0, 0), -1)
        cv2.putText(thumb, label, (8, 20), cv2.FONT_HERSHEY_SIMPLEX,
                    0.55, (255, 255, 255), 1, cv2.LINE_AA)
        r, c = divmod(i, cols)
        sheet[r * thumb_h:(r + 1) * thumb_h, c * thumb_w:(c + 1) * thumb_w] = thumb

    args.contact_sheet.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(args.contact_sheet), sheet, [cv2.IMWRITE_JPEG_QUALITY, 88])
    print(f"[contact] wrote {args.contact_sheet}")
    print("[ranks]")
    for i, (score, t, _bgr, faces, _info) in enumerate(top):
        print(f"  #{i:<2}  t={t:6.1f}s  s={score:.3f}  faces={len(faces)}")


if __name__ == "__main__":
    main()
