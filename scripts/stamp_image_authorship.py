#!/usr/bin/env python3
"""Embed authorship, credit and rights metadata in Alex's own photography.

Embedded IPTC/XMP is the only authorship that survives a scrape, a repost or a
reverse-image search — once a JPEG leaves this repo the surrounding HTML,
the alt text and the JSON-LD are all gone, and the bytes are on their own.
Google reads these fields for image credit and licensing. Before this script
ran, ZERO images on alexwalker.co carried a creator, credit line, copyright
notice or caption; the only IPTC string in a five-file sample was the literal
word "POSTERS", a leftover Pixelmator export-folder label.

WHAT IT WRITES  (see FIELDS below for the exact strings)

    XMP   dc:creator, photoshop:AuthorsPosition, photoshop:Credit,
          dc:rights, xmpRights:Marked, xmpRights:WebStatement,
          xmpRights:UsageTerms, Iptc4xmpCore:CreatorContactInfo/CiUrlWork
    IPTC  2:80 By-line, 2:85 By-line Title, 2:110 Credit,
          2:116 Copyright Notice  (+ 1:90 CodedCharacterSet = UTF-8)

    XMP carries all six requested fields. Legacy IPTC IIM has no dataset for a
    creator work URL or for usage terms, so it carries the four it can and the
    URL/terms live in XMP only — that is the standard split, not an omission.

*** SCOPE IS THE POINT OF THIS FILE. ***

Stamping "Creator: Alex Walker" onto another cinematographer's frame would be a
false authorship claim, so the scope is an EXPLICIT ALLOWLIST of directories
(ALLOW_DIRS) crossed with an explicit DENY list (DENY_DIRS / DENY_FILES). There
is no "everything under img/" mode and there should never be one. A directory
that is in neither list is NOT stamped — the default is always no.

Known carve-outs, and why (do not "clean these up"):

    img/colorist/*          Alex COLORED these; they were shot by Koshi
                            Kiyokawa, Brian C. Dee, Tori Rice, Samuel Pyke,
                            Chad Leathers, Matt Bell and Tyler Mann.
    img/mythbts/*           shot by Tyler Mann
    img/shuffle/mythbts/*   crops of Tyler Mann's frames — easy to miss,
                            because it sits inside an otherwise in-scope tree
    img/comm_bostin/…       lobby-led-wall.jpg is a photograph OF the finished
                            LED install: architecture, not cinematography
    img/posters/*           key art designed by others
    img/comm_stritt/*       orphaned directory, referenced nowhere, provenance
                            unverified
    logos / UI / icons      third-party trademarks and synthetic renders,
                            not photographs

DEFERRED, pending Alex's decision — img/instagram, img/stills, img/slider,
img/commercial, img/narrative, img/documentary, img/music_video. Adding any of
them is one line in ALLOW_DIRS once he rules.

IDEMPOTENT BY CONSTRUCTION. The XMP packet and the IPTC block are built
deterministically from FIELDS and REPLACE any existing ones rather than being
appended, so the second run produces a byte-identical file. `--check` asserts
exactly that.

PIXELS ARE NEVER TOUCHED. This does JPEG segment surgery in pure stdlib: it
parses the APPn markers ahead of the Start-of-Scan, swaps two of them, and
copies everything from SOS onward verbatim. The compressed scan is never
decoded and never re-encoded, so there is no generation loss no matter how
many times it runs. Every other segment — the Exif APP1, the JFIF APP0, the
ICC APP2 chain — is preserved in its original order. (exiftool is not
installed on this Mac and the pyexiv2 wheel needs a Homebrew dylib, so a
library was not an option; the upside is that this has no dependencies at all.)

Usage:
    python3 scripts/stamp_image_authorship.py            # stamp everything in scope
    python3 scripts/stamp_image_authorship.py --dry-run  # list what would change
    python3 scripts/stamp_image_authorship.py --check    # verify + prove idempotence
    python3 scripts/stamp_image_authorship.py --report N # read N stamped files back
"""

import argparse
import io
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / "img"

# --------------------------------------------------------------------- fields

CREATOR = "Alex Walker"
JOB_TITLE = "Director of Photography"
CREDIT = "Alex Walker"
COPYRIGHT = "© Alex Walker. All rights reserved."
WORK_URL = "https://alexwalker.co"
USAGE_TERMS = "All rights reserved. Contact https://alexwalker.co for licensing."

# ---------------------------------------------------------------------- scope

# Projects Alex shot. Every path is relative to img/. Adding one of the
# DEFERRED directories named in the docstring is a single line here.
ALLOW_DIRS = [
    "hoa", "tch", "acinh", "tll", "myth", "attad", "alit", "jr", "goh", "hc",
    "amorsui",
    "comm_applovin", "comm_cwb", "comm_everydaydose", "comm_goody",
    "comm_josey", "comm_targetcool", "comm_wls", "comm_ford",
    "comm_viceguide", "comm_earthspeed",
    # Build-time crops of the frames above, written by
    # scripts/build_thumb_shuffle.py — which calls into this module so a
    # rebuild re-stamps them instead of silently dropping the authorship.
    "shuffle",
]

# Checked against every path prefix, so this also covers the mythbts crops
# nested inside the otherwise in-scope img/shuffle/ tree.
DENY_DIRS = [
    "colorist",
    "mythbts",
    "shuffle/mythbts",
    "posters",
    "comm_stritt",
    "clients",
    "cinemaxxing-logos",
    "streaming",
    "instagram", "stills", "slider", "commercial", "narrative",
    "documentary", "music_video",
]

DENY_FILES = [
    # A photograph of the finished LED install — architecture, not
    # cinematography. Already flagged in _data/shuffle_exclusions.yml.
    "comm_bostin/lobby-led-wall.jpg",
]

SUFFIXES = {".jpg", ".jpeg"}


def should_stamp(path):
    """True if `path` is one of Alex's own photographs.

    Takes any path (absolute or repo-relative) and answers from the allow/deny
    lists alone — deny always wins. Exported so scripts/build_thumb_shuffle.py
    asks exactly the same question this script does, rather than keeping a
    second copy of the carve-outs that could drift out of agreement.
    """
    p = Path(path)
    if not p.is_absolute():
        p = (ROOT / p).resolve()
    else:
        p = p.resolve()
    try:
        rel = p.relative_to(IMG)
    except ValueError:
        return False
    if p.suffix.lower() not in SUFFIXES:
        return False
    parts = rel.parts
    posix = rel.as_posix()
    # Deny first, and by path PREFIX, so "shuffle/mythbts" excludes the whole
    # subtree even though "shuffle" is allowed.
    if posix in DENY_FILES:
        return False
    for d in DENY_DIRS:
        dp = tuple(d.split("/"))
        if parts[: len(dp)] == dp:
            return False
    for a in ALLOW_DIRS:
        ap = tuple(a.split("/"))
        if parts[: len(ap)] == ap:
            return True
    return False


def in_scope_files():
    """Every file this script is allowed to touch, sorted."""
    return sorted(f for f in IMG.rglob("*") if f.is_file() and should_stamp(f))


# ------------------------------------------------------------ XMP construction

XMP_NS = b"http://ns.adobe.com/xap/1.0/\x00"


def _xml_escape(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;")
             .replace(">", "&gt;").replace('"', "&quot;"))


def build_xmp():
    """The XMP packet, built deterministically so re-running is a no-op.

    Written as a full standalone packet (not a patch of whatever was there)
    because that is what makes idempotence provable: same FIELDS in, same
    bytes out, every time.
    """
    e = _xml_escape
    return (
        '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n'
        '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="alexwalker.co '
        'scripts/stamp_image_authorship.py">\n'
        ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n'
        '  <rdf:Description rdf:about=""\n'
        '    xmlns:dc="http://purl.org/dc/elements/1.1/"\n'
        '    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"\n'
        '    xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"\n'
        '    xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/"\n'
        f'    photoshop:AuthorsPosition="{e(JOB_TITLE)}"\n'
        f'    photoshop:Credit="{e(CREDIT)}"\n'
        '    xmpRights:Marked="True"\n'
        f'    xmpRights:WebStatement="{e(WORK_URL)}">\n'
        '   <dc:creator>\n'
        f'    <rdf:Seq><rdf:li>{e(CREATOR)}</rdf:li></rdf:Seq>\n'
        '   </dc:creator>\n'
        '   <dc:rights>\n'
        '    <rdf:Alt><rdf:li xml:lang="x-default">'
        f'{e(COPYRIGHT)}</rdf:li></rdf:Alt>\n'
        '   </dc:rights>\n'
        '   <xmpRights:UsageTerms>\n'
        '    <rdf:Alt><rdf:li xml:lang="x-default">'
        f'{e(USAGE_TERMS)}</rdf:li></rdf:Alt>\n'
        '   </xmpRights:UsageTerms>\n'
        '   <Iptc4xmpCore:CreatorContactInfo rdf:parseType="Resource">\n'
        f'    <Iptc4xmpCore:CiUrlWork>{e(WORK_URL)}</Iptc4xmpCore:CiUrlWork>\n'
        '   </Iptc4xmpCore:CreatorContactInfo>\n'
        '  </rdf:Description>\n'
        ' </rdf:RDF>\n'
        '</x:xmpmeta>\n'
        '<?xpacket end="w"?>'
    ).encode("utf-8")


# ----------------------------------------------------------- IPTC construction

# Datasets this script owns. Anything else already in the IPTC block is left
# exactly as it was — we are adding authorship, not laundering the file.
OWNED_IIM = {(2, 80), (2, 85), (2, 110), (2, 116), (2, 0), (1, 90)}


def _iim(record, dataset, value):
    raw = value if isinstance(value, bytes) else value.encode("utf-8")
    if len(raw) > 0x7FFF:
        raise ValueError("IIM extended datasets not supported here")
    return b"\x1c" + bytes([record, dataset]) + struct.pack(">H", len(raw)) + raw


def build_iptc(preserved=b""):
    """The IPTC IIM application record, with any foreign datasets kept.

    1:90 CodedCharacterSet declares UTF-8 (ESC % G). Without it the "©" in the
    copyright notice is undefined-encoding and readers guess — usually at
    Latin-1, which turns it into "Â©".
    """
    out = _iim(1, 90, b"\x1b%G")
    out += _iim(2, 0, b"\x00\x04")          # record version
    out += _iim(2, 80, CREATOR)             # By-line
    out += _iim(2, 85, JOB_TITLE)           # By-line Title
    out += _iim(2, 110, CREDIT)             # Credit
    out += _iim(2, 116, COPYRIGHT)          # Copyright Notice
    return out + preserved


def parse_iim(blob):
    """Split an IIM block into [(record, dataset, value_bytes), ...]."""
    out, i = [], 0
    while i + 5 <= len(blob):
        if blob[i] != 0x1C:
            break
        rec, ds = blob[i + 1], blob[i + 2]
        n = struct.unpack(">H", blob[i + 3:i + 5])[0]
        if n & 0x8000:                       # extended dataset: stop, don't guess
            break
        out.append((rec, ds, blob[i + 5:i + 5 + n]))
        i += 5 + n
    return out


# ------------------------------------------------- Photoshop IRB (APP13) block

IRB_HEADER = b"Photoshop 3.0\x00"
IPTC_RESOURCE_ID = 0x0404


def _parse_irb(blob):
    """[(resource_id, name_bytes, data), ...] from a Photoshop IRB payload."""
    out, i = [], 0
    while i + 12 <= len(blob):
        if blob[i:i + 4] != b"8BIM":
            break
        rid = struct.unpack(">H", blob[i + 4:i + 6])[0]
        nlen = blob[i + 6]
        name = blob[i + 7:i + 7 + nlen]
        j = i + 7 + nlen
        if (nlen + 1) % 2:                  # Pascal string padded to even
            j += 1
        size = struct.unpack(">I", blob[j:j + 4])[0]
        data = blob[j + 4:j + 4 + size]
        j += 4 + size + (size % 2)          # data padded to even
        out.append((rid, name, data))
        i = j
    return out


def _build_irb(resources):
    out = io.BytesIO()
    for rid, name, data in resources:
        out.write(b"8BIM" + struct.pack(">H", rid))
        out.write(bytes([len(name)]) + name)
        if (len(name) + 1) % 2:
            out.write(b"\x00")
        out.write(struct.pack(">I", len(data)) + data)
        if len(data) % 2:
            out.write(b"\x00")
    return out.getvalue()


# ---------------------------------------------------------- JPEG segment layer

def split_jpeg(raw):
    """(segments, tail) where segments are the markers before Start-of-Scan.

    `tail` is everything from the SOS marker to EOF, copied byte-for-byte and
    never parsed. That is where the entropy-coded pixel data lives, which is
    exactly why this function refuses to look at it.
    """
    if raw[:2] != b"\xff\xd8":
        raise ValueError("not a JPEG")
    segs, i = [], 2
    while i < len(raw):
        if raw[i] != 0xFF:
            raise ValueError(f"bad marker at {i}")
        m = raw[i + 1]
        if m == 0xDA:                        # SOS — pixels start here
            return segs, raw[i:]
        if m in (0xD8, 0xD9) or 0xD0 <= m <= 0xD7 or m == 0x01:
            i += 2                           # standalone, no payload
            continue
        n = struct.unpack(">H", raw[i + 2:i + 4])[0]
        segs.append((m, raw[i + 4:i + 2 + n]))
        i += 2 + n
    raise ValueError("no Start-of-Scan found")


def assemble_jpeg(segs, tail):
    out = io.BytesIO()
    out.write(b"\xff\xd8")
    for m, payload in segs:
        out.write(b"\xff" + bytes([m]) + struct.pack(">H", len(payload) + 2))
        out.write(payload)
    out.write(tail)
    return out.getvalue()


def stamp_bytes(raw):
    """Return `raw` with the authorship XMP and IPTC in place.

    Everything else about the file — the Exif APP1 and its camera data, the
    JFIF APP0, the ICC profile, and every byte of the compressed scan — comes
    through untouched and in its original order.
    """
    segs, tail = split_jpeg(raw)

    # Preserve any IPTC datasets we don't own, and any non-IPTC 8BIM resource
    # (clipping paths, thumbnails, print settings) from an existing APP13.
    preserved_iim, other_resources = b"", []
    for m, payload in segs:
        if m == 0xED and payload.startswith(IRB_HEADER):
            for rid, name, data in _parse_irb(payload[len(IRB_HEADER):]):
                if rid == IPTC_RESOURCE_ID:
                    preserved_iim = b"".join(
                        _iim(r, d, v) for r, d, v in parse_iim(data)
                        if (r, d) not in OWNED_IIM)
                else:
                    other_resources.append((rid, name, data))

    # Drop the segments we are replacing; keep every other one as-is.
    kept = [(m, p) for m, p in segs
            if not (m == 0xE1 and p.startswith(XMP_NS))
            and not (m == 0xED and p.startswith(IRB_HEADER))]

    xmp_seg = (0xE1, XMP_NS + build_xmp())
    irb = _build_irb(other_resources +
                     [(IPTC_RESOURCE_ID, b"", build_iptc(preserved_iim))])
    app13_seg = (0xED, IRB_HEADER + irb)

    for m, p in (xmp_seg, app13_seg):
        if len(p) + 2 > 0xFFFF:
            raise ValueError(f"segment 0x{m:02X} exceeds the 64KB JPEG limit")

    # Insert after the existing APPn run so the JFIF APP0 stays first and any
    # multi-chunk ICC profile stays contiguous and in order.
    at = 0
    for idx, (m, _) in enumerate(kept):
        if 0xE0 <= m <= 0xEF:
            at = idx + 1
    return assemble_jpeg(kept[:at] + [xmp_seg, app13_seg] + kept[at:], tail)


def stamp_file(path):
    """Stamp one file in place. Returns True if the bytes changed.

    Safe to call on anything: a path outside the allowlist is a silent no-op,
    which is what lets build_thumb_shuffle.py call it on every crop it writes
    without needing to know where the carve-outs are.
    """
    path = Path(path)
    if not should_stamp(path):
        return False
    raw = path.read_bytes()
    new = stamp_bytes(raw)
    if new == raw:
        return False
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(new)
    tmp.replace(path)
    return True


# ------------------------------------------------------------------- read-back

def read_metadata(path):
    """The fields this script writes, read back off disk."""
    segs, _ = split_jpeg(Path(path).read_bytes())
    out = {"xmp": {}, "iptc": {}, "has_exif": False}
    import re
    for m, payload in segs:
        if m == 0xE1 and payload.startswith(b"Exif\x00\x00"):
            out["has_exif"] = True
        elif m == 0xE1 and payload.startswith(XMP_NS):
            x = payload[len(XMP_NS):].decode("utf-8", "replace")
            for label, pat in (
                ("dc:creator", r"<dc:creator>.*?<rdf:li[^>]*>(.*?)</rdf:li>"),
                ("dc:rights", r"<dc:rights>.*?<rdf:li[^>]*>(.*?)</rdf:li>"),
                ("xmpRights:UsageTerms",
                 r"<xmpRights:UsageTerms>.*?<rdf:li[^>]*>(.*?)</rdf:li>"),
                ("Iptc4xmpCore:CiUrlWork",
                 r"<Iptc4xmpCore:CiUrlWork>(.*?)</Iptc4xmpCore:CiUrlWork>"),
                ("photoshop:AuthorsPosition", r'photoshop:AuthorsPosition="(.*?)"'),
                ("photoshop:Credit", r'photoshop:Credit="(.*?)"'),
                ("xmpRights:WebStatement", r'xmpRights:WebStatement="(.*?)"'),
            ):
                mm = re.search(pat, x, re.S)
                if mm:
                    out["xmp"][label] = mm.group(1)
        elif m == 0xED and payload.startswith(IRB_HEADER):
            for rid, _, data in _parse_irb(payload[len(IRB_HEADER):]):
                if rid == IPTC_RESOURCE_ID:
                    names = {(2, 80): "By-line", (2, 85): "By-line Title",
                             (2, 110): "Credit", (2, 116): "Copyright Notice"}
                    for r, d, v in parse_iim(data):
                        if (r, d) in names:
                            out["iptc"][names[(r, d)]] = v.decode("utf-8", "replace")
    return out


def pixel_digest(path):
    """SHA-256 of the DECODED pixel buffer — not the file.

    The file hash is expected to change (that is the whole point). This is the
    number that has to stay put: if it moves, the image was recompressed.
    """
    import hashlib
    from PIL import Image
    with Image.open(path) as im:
        return hashlib.sha256(im.convert("RGB").tobytes()).hexdigest()


# ------------------------------------------------------------------------ main

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true",
                    help="list what would be stamped, write nothing")
    ap.add_argument("--check", action="store_true",
                    help="verify fields are present and that a re-run is a no-op")
    ap.add_argument("--report", type=int, metavar="N", default=0,
                    help="print the metadata of N in-scope files")
    args = ap.parse_args()

    files = in_scope_files()
    total = sum(f.stat().st_size for f in files)
    print(f"In scope: {len(files)} files, {total:,} bytes")
    print(f"  allow: {', '.join(ALLOW_DIRS)}")
    print(f"  deny:  {', '.join(DENY_DIRS)} + {len(DENY_FILES)} named file(s)")

    if args.report:
        import json
        for f in files[:args.report]:
            print(f"\n--- {f.relative_to(ROOT)}")
            print(json.dumps(read_metadata(f), indent=2, ensure_ascii=False))
        return 0

    if args.check:
        missing, not_idempotent = [], []
        for f in files:
            md = read_metadata(f)
            if (md["xmp"].get("dc:creator") != CREATOR
                    or md["iptc"].get("By-line") != CREATOR
                    or md["xmp"].get("xmpRights:WebStatement") != WORK_URL):
                missing.append(f)
            raw = f.read_bytes()
            if stamp_bytes(raw) != raw:
                not_idempotent.append(f)
        print(f"\nfields present: {len(files) - len(missing)}/{len(files)}")
        print(f"re-run is a no-op: {len(files) - len(not_idempotent)}/{len(files)}")
        for f in missing[:10]:
            print(f"  ! missing fields: {f.relative_to(ROOT)}")
        for f in not_idempotent[:10]:
            print(f"  ! not idempotent: {f.relative_to(ROOT)}")
        return 1 if (missing or not_idempotent) else 0

    if args.dry_run:
        for f in files:
            raw = f.read_bytes()
            mark = "would stamp" if stamp_bytes(raw) != raw else "unchanged"
            print(f"  {mark}: {f.relative_to(ROOT)}")
        return 0

    changed = 0
    for f in files:
        if stamp_file(f):
            changed += 1
    print(f"\nstamped: {changed}, already current: {len(files) - changed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
