#!/usr/bin/env python3
"""Sync recent Instagram stills into _data/instagram.yml + img/instagram/*.

Fetches up to MAX_ITEMS recent IMAGE posts (or first image of a carousel)
from the authenticated IG Business account, downloads originals + thumbs,
extracts dominant color, writes a hue-sorted YAML data file, and refreshes
the long-lived access token. Designed to run from GitHub Actions cron.
"""
import colorsys
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path

import requests
import yaml
from colorthief import ColorThief
from PIL import Image, ImageOps

# smartcrop produces saliency-based crops (faces, edges, color
# complexity). Optional — falls back to plain center crop if it's
# not installed or fails on a given image.
try:
    from smartcrop import SmartCrop
    _smartcrop = SmartCrop()
except Exception:
    _smartcrop = None

TOKEN = os.environ["IG_ACCESS_TOKEN"]
REPO_ROOT = Path(__file__).resolve().parent.parent
IMG_DIR = REPO_ROOT / "img" / "instagram"
DATA_FILE = REPO_ROOT / "_data" / "instagram.yml"
CAPTIONS_FILE = REPO_ROOT / "_data" / "instagram_captions.yml"

MAX_ITEMS = 200
YEARS_BACK = 5
THUMB_SIZE = 600  # square thumbnail edge length (in px)
JPEG_FULL_QUALITY = 88
JPEG_THUMB_QUALITY = 82
MIN_DATE = datetime.now(timezone.utc) - timedelta(days=YEARS_BACK * 365)


def make_square_thumb(img, size, manual_crop=None):
    """Return a size×size RGB thumbnail. When manual_crop is provided
    (dict with keys cx, cy, size — all normalized 0-1, cx/cy are the
    center of the square in image coords, size is the side relative
    to min(image_width, image_height)), uses that crop verbatim.

    Otherwise uses smartcrop saliency detection if available — biases
    toward faces, edges, color complexity. Falls back to plain center
    crop on smartcrop failure or absence."""
    img = img.convert("RGB")
    w, h = img.size
    if manual_crop:
        cx = float(manual_crop.get("cx", 0.5))
        cy = float(manual_crop.get("cy", 0.5))
        s  = float(manual_crop.get("size", 1.0))
        side_px = max(1, int(round(s * min(w, h))))
        left = int(round(cx * w - side_px / 2))
        top  = int(round(cy * h - side_px / 2))
        # Clamp to image bounds — protects against malformed/outdated coords.
        left = max(0, min(w - side_px, left))
        top  = max(0, min(h - side_px, top))
        cropped = img.crop((left, top, left + side_px, top + side_px))
        return cropped.resize((size, size), Image.LANCZOS)
    if w == h:
        return img.resize((size, size), Image.LANCZOS)
    if _smartcrop is not None:
        try:
            result = _smartcrop.crop(img, size, size)
            t = result["top_crop"]
            cropped = img.crop((
                t["x"], t["y"],
                t["x"] + t["width"], t["y"] + t["height"],
            ))
            return cropped.resize((size, size), Image.LANCZOS)
        except Exception as e:
            print(f"    smartcrop failed ({e}); falling back to center crop",
                  file=sys.stderr)
    return ImageOps.fit(img, (size, size), Image.LANCZOS, centering=(0.5, 0.5))


def load_manual_crops():
    """Read crop overrides from _data/instagram_captions.yml. Returns
    {iid: {cx, cy, size}}. Captions file is hand-edited; missing or
    malformed files leave us with no overrides."""
    if not CAPTIONS_FILE.exists():
        return {}
    try:
        with open(CAPTIONS_FILE, encoding="utf-8") as f:
            caps = yaml.safe_load(f) or {}
    except Exception as e:
        print(f"    warning: failed to parse {CAPTIONS_FILE.name}: {e}",
              file=sys.stderr)
        return {}
    out = {}
    for iid, fields in (caps or {}).items():
        if isinstance(fields, dict) and isinstance(fields.get("crop"), dict):
            out[str(iid)] = fields["crop"]
    return out


def verify_token():
    """Ping /me before doing anything else. IG long-lived tokens
    nominally last 60 days but get revoked unpredictably (user toggles
    privacy settings, Meta auto-revokes, etc.). Surfacing this here as
    a clear, actionable error beats a 200-line traceback later."""
    OAUTH_URL = (
        "https://www.instagram.com/oauth/authorize?"
        "client_id=2043524626547727&"
        "redirect_uri=https%3A%2F%2Falexwalker.co%2F&"
        "response_type=code&"
        "scope=instagram_business_basic"
    )
    try:
        r = requests.get(
            "https://graph.instagram.com/me",
            params={"fields": "id,username", "access_token": TOKEN},
            timeout=15,
        )
    except Exception as e:
        print(f"ERROR: token sanity check failed (network): {e}", file=sys.stderr)
        sys.exit(2)
    if r.ok:
        data = r.json()
        print(f"Token OK — authed as @{data.get('username')} (id {data.get('id')}).\n")
        return
    try:
        err = r.json().get("error", {})
        msg = err.get("message", r.text)
        code = err.get("code")
    except Exception:
        msg, code = r.text, "?"
    print(
        "\nERROR: Instagram access token is invalid or revoked.\n"
        f"  Meta says: [{code}] {msg}\n\n"
        "  Long-lived tokens nominally last 60 days but get revoked by\n"
        "  Meta unpredictably. To regenerate:\n\n"
        f"  1. Open this URL in a browser and authorize:\n     {OAUTH_URL}\n"
        "  2. Copy the `code` value from the resulting redirect URL.\n"
        "  3. Exchange it for a long-lived token (see scripts/README\n"
        "     or ask Claude to walk through it).\n"
        "  4. Update the IG_ACCESS_TOKEN secret on GitHub.\n",
        file=sys.stderr,
    )
    sys.exit(2)


def fetch_media():
    items = []
    url = "https://graph.instagram.com/me/media"
    params = {
        "fields": (
            "id,caption,media_type,media_url,permalink,timestamp,"
            "children{media_type,media_url}"
        ),
        "limit": 50,
        "access_token": TOKEN,
    }
    while url:
        r = requests.get(url, params=params, timeout=30)
        r.raise_for_status()
        page = r.json()
        page_items = page.get("data", [])
        items.extend(page_items)
        if page_items:
            oldest = datetime.fromisoformat(
                page_items[-1]["timestamp"].replace("+0000", "+00:00")
            )
            if oldest < MIN_DATE:
                break
        url = page.get("paging", {}).get("next")
        params = None
        if len(items) >= 400:
            break
    return items


def pick_image_url(item):
    mt = item.get("media_type")
    if mt == "IMAGE":
        return item.get("media_url")
    if mt == "CAROUSEL_ALBUM":
        for c in (item.get("children") or {}).get("data", []):
            if c.get("media_type") == "IMAGE":
                return c.get("media_url")
    return None


def clean_caption(raw):
    if not raw:
        return ""
    first_para = raw.strip().split("\n\n")[0].strip()
    # Drop trailing hashtag run
    words = first_para.split()
    while words and words[-1].startswith("#"):
        words.pop()
    return " ".join(words)[:140]


def process(item, manual_crops=None):
    img_url = pick_image_url(item)
    if not img_url:
        return None
    ts = datetime.fromisoformat(item["timestamp"].replace("+0000", "+00:00"))
    if ts < MIN_DATE:
        return None

    iid = item["id"]
    full_path = IMG_DIR / f"{iid}.jpg"
    thumb_path = IMG_DIR / f"{iid}-thumb.jpg"
    manual_crop = (manual_crops or {}).get(iid)

    # Download original if missing.
    if not full_path.exists():
        r = requests.get(img_url, timeout=60)
        r.raise_for_status()
        img = Image.open(BytesIO(r.content)).convert("RGB")
        img.save(full_path, "JPEG", quality=JPEG_FULL_QUALITY, optimize=True)

    # (Re)generate thumb if missing, wrong size, or a manual crop is set
    # (cheap to redo, and the crop coords may have changed since last run).
    needs_thumb = True
    if thumb_path.exists() and not manual_crop:
        try:
            with Image.open(thumb_path) as t:
                if t.width == THUMB_SIZE and t.height == THUMB_SIZE:
                    needs_thumb = False
        except Exception:
            pass
    if needs_thumb:
        with Image.open(full_path) as full_img:
            thumb_img = make_square_thumb(full_img, THUMB_SIZE, manual_crop=manual_crop)
        thumb_img.save(thumb_path, "JPEG", quality=JPEG_THUMB_QUALITY, optimize=True)

    rgb = ColorThief(str(full_path)).get_color(quality=4)
    h, s, v = colorsys.rgb_to_hsv(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255)

    return {
        "id": iid,
        "permalink": item["permalink"],
        "timestamp": ts.isoformat(),
        "caption": clean_caption(item.get("caption")),
        "image": f"/img/instagram/{iid}.jpg",
        "thumb": f"/img/instagram/{iid}-thumb.jpg",
        "rgb": list(rgb),
        "hue": round(h, 4),
        "saturation": round(s, 4),
        "value": round(v, 4),
    }


def sort_key(x):
    # Saturated colors flow around the hue wheel; neutrals/desaturated
    # items trail at the end sorted bright→dark.
    if x["saturation"] < 0.15:
        return (1, 1 - x["value"])
    return (0, x["hue"])


def refresh_token():
    try:
        r = requests.get(
            "https://graph.instagram.com/refresh_access_token",
            params={"grant_type": "ig_refresh_token", "access_token": TOKEN},
            timeout=30,
        )
        if not r.ok:
            print(f"Token refresh skipped (HTTP {r.status_code}): {r.text}", file=sys.stderr)
            return
        new = r.json()
        days = new["expires_in"] // 86400
        print(f"Token refreshed; new expiry in ~{days} days.")
        new_token = new["access_token"]
        if new_token == TOKEN:
            return
        pat = os.environ.get("IG_REFRESH_PAT")
        if not pat:
            print(
                "\nWARNING: token rotated. IG_REFRESH_PAT not set so the\n"
                "GitHub secret wasn't updated automatically. Copy the new\n"
                "token below and update the IG_ACCESS_TOKEN repo secret:\n\n"
                f"  {new_token}\n",
                file=sys.stderr,
            )
            return
        env = os.environ.copy()
        env["GH_TOKEN"] = pat
        p = subprocess.run(
            ["gh", "secret", "set", "IG_ACCESS_TOKEN", "--body", new_token],
            env=env, capture_output=True, text=True,
        )
        if p.returncode == 0:
            print("Rotated IG_ACCESS_TOKEN secret.")
        else:
            print(f"Failed to rotate secret: {p.stderr}", file=sys.stderr)
    except Exception as e:
        print(f"Token refresh failed: {e}", file=sys.stderr)


def main():
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)

    verify_token()
    manual_crops = load_manual_crops()
    if manual_crops:
        print(f"Loaded {len(manual_crops)} manual crop override(s) from "
              f"{CAPTIONS_FILE.name}.")
    media = fetch_media()
    print(f"Fetched {len(media)} candidate posts from Instagram.")

    processed = []
    for item in media:
        if len(processed) >= MAX_ITEMS:
            break
        try:
            entry = process(item, manual_crops=manual_crops)
        except Exception as e:
            print(f"  ! skipping {item.get('id')}: {e}", file=sys.stderr)
            continue
        if entry:
            processed.append(entry)
            print(f"  ✓ {entry['id']} ({entry['timestamp'][:10]})")

    processed.sort(key=sort_key)

    keep_ids = {p["id"] for p in processed}
    for f in IMG_DIR.glob("*.jpg"):
        stem = f.stem
        if stem.endswith("-thumb"):
            stem = stem[: -len("-thumb")]
        if stem not in keep_ids:
            print(f"  ✗ removing stale {f.name}")
            f.unlink()

    with open(DATA_FILE, "w") as fh:
        yaml.dump(processed, fh, sort_keys=False, allow_unicode=True)
    print(f"Wrote {len(processed)} entries to {DATA_FILE.relative_to(REPO_ROOT)}.")

    refresh_token()


if __name__ == "__main__":
    main()
