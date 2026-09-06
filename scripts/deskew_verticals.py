#!/usr/bin/env python3
"""Make the verticals in a still plumb by removing the camera's tilt keystone.

Written for img/comm_goody/frame3.jpg — the Goody Goody storefront, shot from
below with the camera tilted up, so the five canopy poles fan outwards towards
the bottom of the frame and read as leaning. Nothing about it is specific to
that still, so it takes a path.

WHAT IT DOES, in one sentence: find where the frame's near-vertical lines
would meet if extended (the zenith vanishing point), then apply the projective
transform that sends that point to infinity, which is exactly the transform
that makes those lines parallel.

    1. Canny + probabilistic Hough, keeping only long segments within
       VERTICAL_TOLERANCE degrees of vertical — architecture, not people.
    2. Least-squares vanishing point over those segments in homogeneous
       coordinates (each segment's line must pass through it), weighted by
       segment length, re-fitted a few times with the worst quarter dropped
       each pass so one mis-detected edge can't drag the answer.
    3. Warp the trapezoid bounded by the two vanishing-point rails through the
       BOTTOM corners onto the full frame. Anchoring at the bottom row means
       that row keeps its scale and the trapezoid stays inside the picture, so
       the output is full-bleed — no black wedges, no re-crop needed, and the
       only thing given up is a sliver of the top-left and top-right corners
       (sky, on this frame).

IDEMPOTENT BY MEASUREMENT, not by a marker file: step 1 runs first and the
warp is skipped entirely when the frame already measures plumb, so re-running
this on its own output is a no-op rather than a second correction.

Usage:
    python3 scripts/deskew_verticals.py img/comm_goody/frame3.jpg \
        --shuffle-out img/shuffle/comm_goody/3.jpg

--shuffle-out regenerates the homepage tile derivative in the same pass.
scripts/build_thumb_shuffle.py owns that file and would rebuild it from the
corrected source anyway; writing it here just keeps the two copies of the
picture from disagreeing until the next full build. The parameters below
mirror that script's (width 1152, quality 82, optimize, progressive) so this
produces what the build produces.
"""

import argparse
import sys

import cv2
import numpy as np
from PIL import Image

# Only segments this close to vertical are architecture worth trusting. Wider
# and the woman's shoulder line and bag strap start voting on the answer.
VERTICAL_TOLERANCE = 12.0     # degrees
MIN_SEGMENT_HEIGHT = 110      # px — long enough to have a reliable slope
# Below this length-weighted mean lean the frame is already plumb and the warp
# is skipped. Comfortably under the 1.6 degrees the Goody Goody frame measured
# and comfortably over the residue a correction leaves behind (~0.3).
PLUMB_ENOUGH = 0.6            # degrees

# Homepage tile derivative — must match scripts/build_thumb_shuffle.py.
SHUFFLE_WIDTH = 1152
SHUFFLE_QUALITY = 82
# Gallery still. 90 lands within ~10% of the file size these frames already
# ship at while keeping the recompression off a JPEG source invisible.
GALLERY_QUALITY = 90


def vertical_segments(bgr):
    """Long, near-vertical line segments as (x1, y1, x2, y2, angle, height)."""
    gray = cv2.GaussianBlur(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY), (3, 3), 0)
    lines = cv2.HoughLinesP(cv2.Canny(gray, 25, 90), 1, np.pi / 1440,
                            threshold=50, minLineLength=MIN_SEGMENT_HEIGHT,
                            maxLineGap=20)
    out = []
    for x1, y1, x2, y2 in (lines[:, 0] if lines is not None else []):
        if y1 > y2:
            x1, y1, x2, y2 = x2, y2, x1, y1
        height = float(y2 - y1)
        if height < MIN_SEGMENT_HEIGHT:
            continue
        angle = float(np.degrees(np.arctan2(float(x2 - x1), height)))
        if abs(angle) < VERTICAL_TOLERANCE:
            out.append((float(x1), float(y1), float(x2), float(y2), angle, height))
    return out


def lean(segments):
    """Length-weighted mean |angle from vertical|, in degrees."""
    if not segments:
        return 0.0
    return float(np.average([abs(s[4]) for s in segments],
                            weights=[s[5] for s in segments]))


def _fit_vp(segments):
    """Least-squares point that all the segments' lines pass through.

    A line through two homogeneous points is their cross product, and a point
    lies on it when their dot product is zero — so the vanishing point is the
    null space of the stacked (length-weighted, normalised) line matrix.
    """
    rows = []
    for x1, y1, x2, y2, _angle, height in segments:
        line = np.cross([x1, y1, 1.0], [x2, y2, 1.0])
        rows.append(line / np.linalg.norm(line[:2]) * height)
    _u, _s, vt = np.linalg.svd(np.array(rows))
    return vt[-1]


def vanishing_point(segments, passes=6, keep_fraction=75):
    """Robust zenith. Re-fit, dropping the worst-fitting quarter each pass."""
    current = list(segments)
    point = _fit_vp(current)
    for _ in range(passes):
        vp = np.array([point[0] / point[2], point[1] / point[2], 1.0])
        residuals = np.array([
            abs(np.cross([x1, y1, 1.0], [x2, y2, 1.0])
                / np.linalg.norm(np.cross([x1, y1, 1.0], [x2, y2, 1.0])[:2]) @ vp)
            for x1, y1, x2, y2, _a, _h in current
        ])
        keep = residuals < max(float(np.percentile(residuals, keep_fraction)), 6.0)
        if keep.sum() < 8:
            break
        current = [s for s, k in zip(current, keep) if k]
        point = _fit_vp(current)
    return point[:2] / point[2], current


def straighten(bgr, vp):
    """Send `vp` to infinity, anchoring the bottom row so the frame stays full."""
    h, w = bgr.shape[:2]
    vx, vy = float(vp[0]), float(vp[1])
    y_ref = float(h)

    def rail(x_at_ref, y):
        """Where the vanishing-point line through (x_at_ref, y_ref) sits at y."""
        return vx + (x_at_ref - vx) * (y - vy) / (y_ref - vy)

    src = np.float32([[rail(0, 0), 0], [rail(w, 0), 0], [w, h], [0, h]])
    dst = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    matrix = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(bgr, matrix, (w, h), flags=cv2.INTER_LANCZOS4,
                               borderMode=cv2.BORDER_REPLICATE), src


def save_jpeg(bgr, path, quality, width=None, progressive=False):
    im = Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
    if width and im.width > width:
        im = im.resize((width, max(1, round(im.height * width / im.width))),
                       Image.LANCZOS)
    im.save(path, "JPEG", quality=quality, optimize=True,
            progressive=progressive, subsampling=2)
    return im.size


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("image", help="still to correct, rewritten in place")
    ap.add_argument("--shuffle-out", help="also write the homepage tile crop here")
    ap.add_argument("--dry-run", action="store_true", help="measure only")
    args = ap.parse_args()

    bgr = cv2.imread(args.image)
    if bgr is None:
        sys.exit(f"cannot read {args.image}")

    segments = vertical_segments(bgr)
    if len(segments) < 8:
        sys.exit(f"only {len(segments)} usable vertical segments — "
                 "not enough to trust a correction, leave this one alone")

    before = lean(segments)
    print(f"{args.image}: {len(segments)} vertical segments, "
          f"mean lean {before:.3f}°")
    if before < PLUMB_ENOUGH:
        print(f"  already within {PLUMB_ENOUGH}° of plumb — nothing to do")
        return

    vp, inliers = vanishing_point(segments)
    print(f"  vanishing point ({vp[0]:.1f}, {vp[1]:.1f}) from {len(inliers)} inliers")

    fixed, src = straighten(bgr, vp)
    after = lean(vertical_segments(fixed))
    print(f"  mean lean {before:.3f}° -> {after:.3f}°")
    print(f"  source quad top edge x = {src[0][0]:.1f} .. {src[1][0]:.1f} "
          f"(bottom row unchanged)")

    # Refuse to ship a regression. The measurement is the same one used to
    # decide there was a problem, so this is a real check, not a formality.
    if after >= before:
        sys.exit("  correction did not improve the verticals — nothing written")

    if args.dry_run:
        print("  dry run — nothing written")
        return

    size = save_jpeg(fixed, args.image, GALLERY_QUALITY)
    print(f"  wrote {args.image} {size[0]}x{size[1]}")
    if args.shuffle_out:
        size = save_jpeg(fixed, args.shuffle_out, SHUFFLE_QUALITY,
                         width=SHUFFLE_WIDTH, progressive=True)
        print(f"  wrote {args.shuffle_out} {size[0]}x{size[1]}")


if __name__ == "__main__":
    main()
