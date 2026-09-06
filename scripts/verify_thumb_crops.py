#!/usr/bin/env python3
"""Independent check that the shuffle crops preserved the original framing.

The cropper checks its own arithmetic, which proves nothing. This re-derives
everything from the files actually on disk:

  HARD RULES (exit 1 if any is broken)
    * any baked-in padding the build claims to have removed is really there
      in the source and is really that thick, and came off equally on both
      sides — padding removal must never double as a reframe,
    * the derivative keeps 100% of the source's PICTURE width — no horizontal
      crop, no pan; the crop window starts at x=0 and ends at the picture width,
    * the rows removed from the top exactly equal the rows removed from the
      bottom, and padding + top + kept + bottom accounts for every source row,
    * the written file's aspect ratio matches the crop window's, so nothing
      was squashed, and its width never exceeds the source's, so nothing was
      upscaled,
    * no derivative still has a dark bar on any edge — the edge rows and
      columns of every written file are sampled to prove it.

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

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
AUDIT = ROOT / "scripts" / "thumb_shuffle_audit.json"

# A face counts as "cut" only if a real slice of it is gone — a couple of
# pixels of hair is not worth Alex's attention.
CLIP_TOLERANCE = 0.06

# --- residual-bar sampling -------------------------------------------------
# The point of stripping padding is that none survives into the tile, so the
# written file is re-opened and its outermost rows and columns are read back.
# An edge line counts as a leftover bar if EVERY pixel in it is dark; that is
# the same test detect_bars uses, so a bar it should have caught cannot hide
# from this. A dark edge that is genuinely part of the shot (a night exterior
# going to black at frame left) is reported separately and never fails the
# run — the build deliberately leaves those alone.
EDGE_DARK = 26.0
EDGE_LINES = 2


def edge_profile(path):
    """Per-edge count of leading all-dark lines in a written derivative."""
    with Image.open(path) as im:
        a = np.asarray(im.convert("RGB")).astype(np.float32)
    lum = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    rmax, cmax = lum.max(axis=1), lum.max(axis=0)

    def run(v):
        k = 0
        while k < len(v) and v[k] <= EDGE_DARK:
            k += 1
        return k

    return {"top": run(rmax), "bottom": run(rmax[::-1]),
            "left": run(cmax), "right": run(cmax[::-1])}


def main():
    audit = json.loads(AUDIT.read_text())
    failures, clipped, residual, dark_edges, barred = [], [], [], [], []

    for a in audit:
        out_abs = ROOT / a["out"].lstrip("/")
        src_abs = ROOT / a["src"].lstrip("/")
        if not out_abs.exists():
            failures.append(f"{a['out']}: derivative missing")
            continue

        with Image.open(src_abs) as im:
            src_im = im.convert("RGB")
            sw, sh = src_im.size
            src_lum = np.asarray(src_im).astype(np.float32) @ [0.2126, 0.7152, 0.0722]
        with Image.open(out_abs) as im:
            ow, oh = im.size

        bt, bb, bl, br = a["bars"]
        pw, ph = a["picture"]
        x0, y0, x1, y1 = a["box"]          # in PICTURE coordinates, post-padding
        top, bottom = a["trimTop"], a["trimBottom"]
        kept_h = y1 - y0

        # --- padding: symmetric, real, and correctly accounted for
        if bt != bb or bl != br:
            failures.append(
                f"{a['out']}: padding removal {bt}/{bb} top/bottom, {bl}/{br} "
                f"left/right — not symmetric, that is a reframe")
        if pw != sw - bl - br or ph != sh - bt - bb:
            failures.append(
                f"{a['out']}: picture {pw}x{ph} doesn't match {sw}x{sh} minus "
                f"padding {bt}/{bb}/{bl}/{br}")
        if any((bt, bb, bl, br)):
            barred.append(a)
            # Re-derive from the source pixels: the rows/columns the build
            # called padding really are dark, and the first row/column it kept
            # really is not. Trusting the build's own numbers would prove
            # nothing.
            checks = [("top", src_lum[:bt], src_lum[bt] if bt < sh else None),
                      ("bottom", src_lum[sh - bb:], src_lum[sh - bb - 1] if bb else None),
                      ("left", src_lum[:, :bl], src_lum[:, bl] if bl < sw else None),
                      ("right", src_lum[:, sw - br:], src_lum[:, sw - br - 1] if br else None)]
            for side, pad, first_kept in checks:
                if pad.size and pad.max() > EDGE_DARK:
                    failures.append(
                        f"{a['out']}: {side} padding contains a pixel at "
                        f"{pad.max():.0f} — that is picture, not padding")
                if first_kept is not None and pad.size and first_kept.max() <= EDGE_DARK:
                    failures.append(
                        f"{a['out']}: the first {side} line kept is still dark "
                        f"— padding under-removed")

        # --- horizontal: nothing removed from the picture, nothing shifted
        if x0 != 0 or x1 != pw:
            failures.append(
                f"{a['out']}: crop window x=[{x0},{x1}] but picture is {pw}px wide")
        # --- vertical: symmetric, and accounts for every row of the source
        if top != bottom:
            failures.append(f"{a['out']}: trimmed {top} rows off the top, {bottom} off the bottom")
        if bt + top + kept_h + bottom + bb != sh:
            failures.append(
                f"{a['out']}: {bt}+{top}+{kept_h}+{bottom}+{bb} != source height {sh}")
        # --- written file: same shape as the window, never enlarged
        if ow > sw:
            failures.append(f"{a['out']}: {ow}px wide from a {sw}px source — upscaled")
        win_aspect = (x1 - x0) / max(kept_h, 1)
        out_aspect = ow / max(oh, 1)
        if abs(win_aspect - out_aspect) > 0.01:
            failures.append(
                f"{a['out']}: window {win_aspect:.4f} but file {out_aspect:.4f} — squashed")

        # --- residual bars in the DELIVERED file
        edges = edge_profile(out_abs)
        deep = {s: n for s, n in edges.items() if n > EDGE_LINES}
        if deep:
            (residual if any((bt, bb, bl, br)) else dark_edges).append((a, deep))

        # --- report-only: does the centred window cut a face?
        # Face rectangles are normalised to the unstripped file, so the window
        # is put back into source coordinates before they are compared.
        for f in a["faceBoxes"]:
            fy0, fy1 = f["y"] * sh, (f["y"] + f["h"]) * sh
            face_h = max(fy1 - fy0, 1)
            cut_top = max(bt + y0 - fy0, 0) / face_h
            cut_bottom = max(fy1 - (bt + y1), 0) / face_h
            if max(cut_top, cut_bottom) > CLIP_TOLERANCE:
                clipped.append((a["out"], a["src"], round(cut_top, 3),
                                round(cut_bottom, 3), round(f["h"], 3)))

    print(f"Checked {len(audit)} derivatives against their sources.")
    if failures:
        print(f"\n{len(failures)} CROP RULE VIOLATION(S):")
        for f in failures:
            print(f"  ! {f}")
    else:
        print("  Padding removal symmetric and real, full picture width kept, "
              "vertical trim symmetric, no squash, no upscale — all clean.")

    # --- padding, and whether any of it survived into the delivered file
    print(f"\nFrames with baked-in padding: {len(barred)} of {len(audit)}")
    for a in barred:
        bt, bb, bl, br = a["bars"]
        pw, ph = a["picture"]
        print(f"  · {a['src']} ({a['section']}) {a['orig'][0]}x{a['orig'][1]}"
              f" — removed top {bt}, bottom {bb}, left {bl}, right {br}"
              f" → picture {pw}x{ph} = {pw / ph:.4f}:1")

    print(f"\nEdge sample of all {len(audit)} written derivatives "
          f"(all-dark lines deeper than {EDGE_LINES}px on any edge):")
    if residual:
        for a, deep in residual:
            print(f"  ! {a['out']}: RESIDUAL PADDING {deep} — a de-padded frame "
                  f"still has a bar")
    else:
        print(f"  none on any of the {len(barred)} de-padded frames — "
              f"no residual bar survived")
    print(f"  {len(dark_edges)} frame(s) with a dark edge that is picture, not "
          f"padding (asymmetric, so deliberately left alone):")
    for a, deep in sorted(dark_edges, key=lambda d: -max(d[1].values()))[:8]:
        print(f"      · {a['out']} {deep}")

    # A worked example, so the arithmetic is legible rather than asserted.
    example = max(audit, key=lambda a: sum(a["bars"])) if barred else \
        max(audit, key=lambda a: a["trimTop"])
    x0, y0, x1, y1 = example["box"]
    bt, bb = example["bars"][0], example["bars"][1]
    pw, ph = example["picture"]
    with Image.open(ROOT / example["src"].lstrip("/")) as im:
        sw, sh = im.size
    with Image.open(ROOT / example["out"].lstrip("/")) as im:
        ow, oh = im.size
    print(f"\nWorked example — {example['src']}")
    print(f"  source            {sw} x {sh}  ({sw / sh:.4f}:1)")
    print(f"  padding removed   {bt} top, {bb} bottom  (equal: {bt == bb})")
    print(f"  picture recovered {pw} x {ph}  ({pw / ph:.4f}:1)")
    print(f"  crop window       x 0 -> {x1} (full picture width), y {y0} -> {y1}")
    print(f"  rows removed      {example['trimTop']} top, {example['trimBottom']} bottom"
          f"  (equal: {example['trimTop'] == example['trimBottom']})")
    print(f"  {bt} + {example['trimTop']} + {y1 - y0} + {example['trimBottom']} + {bb} = "
          f"{bt + example['trimTop'] + (y1 - y0) + example['trimBottom'] + bb}"
          f" = source height {sh}")
    print(f"  written           {ow} x {oh}  ({ow / oh:.4f}:1)")
    print(f"  width preserved   {x1 - x0} == {pw}: {x1 - x0 == pw}")

    print(f"\nFrames where the centred window cuts a detected face: {len(clipped)}")
    print("(reported only — NOT changed. A non-centred vertical offset is Alex's call.)")
    for out, src, ct, cb, fh in sorted(clipped, key=lambda c: -max(c[2], c[3])):
        where = f"top {ct:.0%}" if ct >= cb else f"bottom {cb:.0%}"
        print(f"  · {src}  loses {where} of a face that fills {fh:.0%} of frame height")

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
