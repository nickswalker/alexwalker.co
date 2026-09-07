#!/usr/bin/env python3
"""Level a tilted horizon in a still, then re-crop to the frame's own aspect.

The sibling of scripts/deskew_verticals.py. That one fixes a KEYSTONE — the
camera pointed up or down, so verticals converge — with a projective warp.
This one fixes a ROLL: the camera was level in pitch but rotated about the lens
axis, so the horizon runs downhill. That is a plain rotation, and rotating is
the whole correction. The two share nothing but the derivative-writing helpers,
which are imported from deskew_verticals so the JPEG parameters can't drift.

Written for img/tll/frame6.jpg — the Texas Legacy in Lights field frame, where
the treeline falls about 1.4 degrees to the right. Nothing here is specific to
that still, so it takes a path.

MEASURING THE TILT. A Hough fit is the obvious move and it is the wrong one on
this picture: the only long straight lines in frame are foreground grass, which
leans for reasons of perspective and wind, and voting on them gives an answer
about the grass. So measure the thing that actually defines a horizon instead —
a landscape is horizontally STRATIFIED (sky, then treeline, then field), and
those bands are only crisp when the frame is level. Rotate through a range of
candidate angles and, at each one, collapse the frame to a column of row means
and sum the squared differences between neighbouring rows. Tilt smears the
bands across rows and flattens that profile; level sharpens it. The peak of
that curve is the tilt, refined to a fraction of a step by fitting a parabola
through the peak and its two neighbours.

RE-CROPPING. Rotation leaves wedges of nothing in the corners, so the output is
the largest rectangle of the SOURCE'S OWN ASPECT that fits inside the rotated
frame, scaled back up to the source's pixel dimensions — which is exactly a
centred push-in of a few percent. Rotation, crop and scale are composed into
one affine matrix and applied in a single Lanczos pass, so the picture is
resampled once rather than three times.

IDEMPOTENT BY MEASUREMENT, not by a marker file: the measurement runs first and
the rotation is skipped when the frame already measures level, so re-running
this on its own output is a no-op rather than a second correction that would
push in another few percent.

Usage:
    python3 scripts/level_horizon.py img/tll/frame6.jpg \
        --shuffle-out img/shuffle/tll/6.jpg

--shuffle-out regenerates the homepage tile derivative in the same pass, for
the reason given in deskew_verticals.py: scripts/build_thumb_shuffle.py owns
that file and would rebuild it from the corrected source anyway, and writing it
here keeps the two copies of the picture from disagreeing in the meantime. TLL
frames are wider than the tile cell, so the build gives them no vertical crop —
their derivative is a plain resize to width, which is what save_jpeg does.

--angle OVERRIDES THE MEASUREMENT, for frames the banding method reads wrong.
Banding assumes the frame's strongest horizontal structure IS the horizon. In
an interior that assumption can fail outright: on img/hc/frame4.jpg — the Hub
City card-table two-shot — the strongest horizontal structure is the table edge
and the wall bands behind it, which run off to a vanishing point well off-axis,
and banding reads -2.46deg where the window jambs say the roll is +1.07deg. It
is not a near miss; it is the wrong sign, and it clears the MIN_SHARPENING
floor at 19%, so the floor does not catch it. When the operator has measured
the roll from something better, pass it here. The verification then switches
from banding to the vertical lean of the frame's long architectural segments —
the measurement deskew_verticals.py uses — so the check still bites.

Usage:
    python3 scripts/level_horizon.py img/hc/frame4.jpg --angle 1.069 \
        --shuffle-out img/shuffle/hc/4.jpg
"""

import argparse
import sys

import cv2
import numpy as np

from deskew_verticals import (GALLERY_QUALITY, SHUFFLE_QUALITY, SHUFFLE_WIDTH,
                              save_jpeg, vertical_segments)

# Search range for the roll. A frame further out than this is tilted on
# purpose — a dutch angle is a decision, not a mistake, and this should not
# quietly undo one.
SEARCH_DEGREES = 4.0
COARSE_STEP = 0.1
FINE_STEP = 0.02
# Ignore a border of this fraction on each side while measuring: rotation fills
# the corners by replication, and those smeared rows are not evidence.
MEASURE_INSET = 0.12
# Below this the frame is level and the rotation is skipped. A correction
# leaves well under 0.1 degrees behind, so re-running is a no-op.
LEVEL_ENOUGH = 0.3            # degrees
# The banding has to sharpen by at least this much at the peak, relative to
# leaving the frame alone: a frame with nothing horizontal in it has a nearly
# flat curve, and the argmax of a flat curve is noise. This is a floor against
# acting on noise, NOT a horizon detector — a frame whose strongest horizontal
# structure is not its horizon will clear it. Choosing the frame is the
# operator's job; the frame6 field clears this by 45%.
MIN_SHARPENING = 0.05         # +5%


def rotate(bgr, degrees, scale=1.0, interpolation=cv2.INTER_LINEAR):
    """Rotate anticlockwise about the centre, keeping the frame size."""
    h, w = bgr.shape[:2]
    matrix = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), degrees, scale)
    return cv2.warpAffine(bgr, matrix, (w, h), flags=interpolation,
                          borderMode=cv2.BORDER_REPLICATE)


def banding(gray, degrees):
    """How crisply the frame stratifies into horizontal bands at this angle."""
    h, w = gray.shape[:2]
    rotated = rotate(gray, degrees) if degrees else gray
    mx, my = int(w * MEASURE_INSET), int(h * MEASURE_INSET)
    rows = rotated[my:h - my, mx:w - mx].mean(axis=1)
    return float((np.diff(rows) ** 2).sum())


def tilt(bgr):
    """Roll of the horizon in degrees, and how much levelling sharpens it.

    Positive means the horizon falls to the right, i.e. the frame wants an
    anticlockwise rotation by that many degrees.
    """
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)

    def peak(angles):
        scores = [banding(gray, float(a)) for a in angles]
        return int(np.argmax(scores)), scores

    coarse = np.arange(-SEARCH_DEGREES, SEARCH_DEGREES + 1e-9, COARSE_STEP)
    i, _ = peak(coarse)
    if i in (0, len(coarse) - 1):
        return None, 0.0     # peak is outside the range — not a roll we fix

    fine = np.arange(coarse[i] - COARSE_STEP * 2,
                     coarse[i] + COARSE_STEP * 2 + 1e-9, FINE_STEP)
    j, scores = peak(fine)
    best = float(fine[j])
    if 0 < j < len(fine) - 1:
        lo, mid, hi = scores[j - 1], scores[j], scores[j + 1]
        curvature = lo - 2 * mid + hi
        if curvature < 0:    # a real peak, not a plateau
            best += 0.5 * (lo - hi) / curvature * FINE_STEP
    return best, scores[j] / banding(gray, 0.0) - 1.0


def vertical_lean(bgr):
    """Signed length-weighted lean of the long near-vertical segments, degrees.

    deskew_verticals.lean() takes the absolute value because a keystone fans
    verticals both ways and only the spread matters. A roll tips every vertical
    the SAME way, so here the sign is the whole point, and levelling has to
    drive this towards zero rather than merely shrink it. Returns None when the
    frame has no architecture long enough to vote.
    """
    segments = vertical_segments(bgr)
    if not segments:
        return None
    return float(np.average([s[4] for s in segments],
                            weights=[s[5] for s in segments]))


def fill_scale(w, h, degrees):
    """Zoom that makes a rotated w x h frame cover a w x h output with no gaps.

    Which is the same thing as the inverse of the largest same-aspect rectangle
    that fits inside the rotation — the corners of the output, rotated back
    into the source, have to stay inside it.
    """
    cos, sin = abs(np.cos(np.radians(degrees))), abs(np.sin(np.radians(degrees)))
    return float(max((w * cos + h * sin) / w, (w * sin + h * cos) / h))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("image", help="still to correct, rewritten in place")
    ap.add_argument("--shuffle-out", help="also write the homepage tile crop here")
    ap.add_argument("--dry-run", action="store_true", help="measure only")
    ap.add_argument("--angle", type=float, help="roll in degrees, measured by the "
                    "operator; skips the banding measurement (see module docstring)")
    args = ap.parse_args()

    bgr = cv2.imread(args.image)
    if bgr is None:
        sys.exit(f"cannot read {args.image}")
    h, w = bgr.shape[:2]

    # Which measurement verifies the result has to match which one chose the
    # angle, or the check is answering a different question than the edit.
    if args.angle is not None:
        measure, unit = vertical_lean, "vertical lean"
        before = args.angle
        observed = measure(bgr)
        if observed is None:
            sys.exit("  no long vertical segments — cannot verify an --angle "
                     "correction on this frame")
        print(f"{args.image}: rotating {before:+.3f}deg as given "
              f"({unit} {observed:+.3f}deg)")
    else:
        measure, unit = lambda b: tilt(b)[0], "tilt"
        before, sharpening = tilt(bgr)
        if before is None:
            sys.exit("  no horizon peak inside "
                     f"+/-{SEARCH_DEGREES}deg — leave this one alone")
        print(f"{args.image}: horizon tilt {before:+.3f}deg "
              f"(levelling sharpens the banding by {sharpening * 100:.1f}%)")
        # Level first, floor second: a frame this script has already corrected
        # measures level AND flat (there is no tilt left for levelling to
        # sharpen), so testing the floor first would report its own output as
        # horizonless.
        if abs(before) < LEVEL_ENOUGH:
            print(f"  already within {LEVEL_ENOUGH}deg of level — nothing to do")
            return
        if sharpening < MIN_SHARPENING:
            sys.exit(f"  under the {MIN_SHARPENING * 100:.0f}% floor — this frame has no "
                     "horizon to level, leave it alone")
        observed = before

    scale = fill_scale(w, h, before)
    fixed = rotate(bgr, before, scale, cv2.INTER_LANCZOS4)
    after = measure(fixed)
    print(f"  rotate {before:+.3f}deg, push in {(scale - 1) * 100:.2f}% to refill "
          f"the frame (keeps {w}x{h})")
    print(f"  {unit} {observed:+.3f}deg -> {after:+.3f}deg")

    # Refuse to ship a regression, by the same measurement that found the
    # problem — so this is a real check, not a formality.
    if after is None or abs(after) >= abs(observed):
        sys.exit(f"  correction did not reduce the {unit} — nothing written")

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
