#!/usr/bin/env python3
"""Independent check that the shuffle crops preserved the original framing.

The cropper checks its own arithmetic, which proves nothing. This re-derives
everything from the files actually on disk:

  HARD RULES (exit 1 if any is broken)
    * the derivative keeps 100% of the source width — no horizontal crop,
      no pan; the crop window starts at x=0 and ends at the source width,
    * the rows removed from the top exactly equal the rows removed from the
      bottom, and top + kept + bottom accounts for every source row,
    * the written file's aspect ratio matches the crop window's, so nothing
      was squashed, and its width never exceeds the source's, so nothing was
      upscaled.

  REPORT ONLY (never fails the run)
    * frames where the centred vertical window cuts into a detected face.
      Those are candidates for a hand-picked vertical offset, and they are
      listed for Alex to decide on — this script does not move them, and
      neither does the cropper. Centred is the rule; exceptions are his call.

Usage:  python3 scripts/verify_thumb_crops.py
"""

import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
AUDIT = ROOT / "scripts" / "thumb_shuffle_audit.json"

# A face counts as "cut" only if a real slice of it is gone — a couple of
# pixels of hair is not worth Alex's attention.
CLIP_TOLERANCE = 0.06


def main():
    audit = json.loads(AUDIT.read_text())
    failures, clipped = [], []

    for a in audit:
        out_abs = ROOT / a["out"].lstrip("/")
        src_abs = ROOT / a["src"].lstrip("/")
        if not out_abs.exists():
            failures.append(f"{a['out']}: derivative missing")
            continue

        with Image.open(src_abs) as im:
            sw, sh = im.size
        with Image.open(out_abs) as im:
            ow, oh = im.size

        x0, y0, x1, y1 = a["box"]
        top, bottom = a["trimTop"], a["trimBottom"]
        kept_h = y1 - y0

        # --- horizontal: nothing removed, nothing shifted
        if x0 != 0 or x1 != sw:
            failures.append(
                f"{a['out']}: crop window x=[{x0},{x1}] but source is {sw}px wide")
        # --- vertical: symmetric, and accounts for every row
        if top != bottom:
            failures.append(f"{a['out']}: trimmed {top} rows off the top, {bottom} off the bottom")
        if top + kept_h + bottom != sh:
            failures.append(
                f"{a['out']}: {top}+{kept_h}+{bottom} != source height {sh}")
        # --- written file: same shape as the window, never enlarged
        if ow > sw:
            failures.append(f"{a['out']}: {ow}px wide from a {sw}px source — upscaled")
        win_aspect = (x1 - x0) / max(kept_h, 1)
        out_aspect = ow / max(oh, 1)
        if abs(win_aspect - out_aspect) > 0.01:
            failures.append(
                f"{a['out']}: window {win_aspect:.4f} but file {out_aspect:.4f} — squashed")

        # --- report-only: does the centred window cut a face?
        for f in a["faceBoxes"]:
            fy0, fy1 = f["y"] * sh, (f["y"] + f["h"]) * sh
            face_h = max(fy1 - fy0, 1)
            cut_top = max(y0 - fy0, 0) / face_h
            cut_bottom = max(fy1 - y1, 0) / face_h
            if max(cut_top, cut_bottom) > CLIP_TOLERANCE:
                clipped.append((a["out"], a["src"], round(cut_top, 3),
                                round(cut_bottom, 3), round(f["h"], 3)))

    print(f"Checked {len(audit)} derivatives against their sources.")
    if failures:
        print(f"\n{len(failures)} CROP RULE VIOLATION(S):")
        for f in failures:
            print(f"  ! {f}")
    else:
        print("  Full source width kept, vertical trim symmetric, "
              "no squash, no upscale — all clean.")

    # A worked example, so the arithmetic is legible rather than asserted.
    example = max(audit, key=lambda a: a["trimTop"])
    x0, y0, x1, y1 = example["box"]
    with Image.open(ROOT / example["src"].lstrip("/")) as im:
        sw, sh = im.size
    with Image.open(ROOT / example["out"].lstrip("/")) as im:
        ow, oh = im.size
    print(f"\nWorked example — {example['src']}")
    print(f"  source            {sw} x {sh}  ({sw / sh:.4f}:1)")
    print(f"  crop window       x 0 -> {x1} (full width), y {y0} -> {y1}")
    print(f"  rows removed      {example['trimTop']} top, {example['trimBottom']} bottom"
          f"  (equal: {example['trimTop'] == example['trimBottom']})")
    print(f"  {example['trimTop']} + {y1 - y0} + {example['trimBottom']} = "
          f"{example['trimTop'] + (y1 - y0) + example['trimBottom']} = source height {sh}")
    print(f"  written           {ow} x {oh}  ({ow / oh:.4f}:1)")
    print(f"  width preserved   {x1 - x0} == {sw}: {x1 - x0 == sw}")

    print(f"\nFrames where the centred window cuts a detected face: {len(clipped)}")
    print("(reported only — NOT changed. A non-centred vertical offset is Alex's call.)")
    for out, src, ct, cb, fh in sorted(clipped, key=lambda c: -max(c[2], c[3])):
        where = f"top {ct:.0%}" if ct >= cb else f"bottom {cb:.0%}"
        print(f"  · {src}  loses {where} of a face that fills {fh:.0%} of frame height")

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
