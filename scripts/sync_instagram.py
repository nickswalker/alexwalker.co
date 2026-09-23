#!/usr/bin/env python3
"""Sync recent Instagram stills into _data/instagram.yml + img/instagram/*.

Fetches up to MAX_ITEMS recent IMAGE posts (or first image of a carousel)
from the authenticated IG Business account, downloads originals + thumbs,
extracts dominant color, writes a hue-sorted YAML data file, and refreshes
the long-lived access token. Designed to run from GitHub Actions cron.

Token lifecycle (full write-up: scripts/README.md):
  --no-refresh     sync media only, never touch the token
  --refresh-only   refresh the long-lived token and PERSIST it back to
                   the IG_ACCESS_TOKEN repo secret; fatal on any failure
  (no flag)        both, refresh last

SECURITY: token values are NEVER printed. Every secret this script
touches is registered with ::add-mask:: and only ever shown as a
last-4 fingerprint. This repo is PUBLIC and its build logs are public.
"""
import argparse
import colorsys
import json
import os
import re
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


# ---------------------------------------------------------------------------
# Secret handling. This repository is PUBLIC, so Actions logs are public too.
# Nothing here may ever emit a token value: we register every secret with the
# runner's ::add-mask:: command (which redacts it from ALL subsequent log
# output, including output produced by other steps) and we only ever display
# a last-4 fingerprint.
# ---------------------------------------------------------------------------
ON_ACTIONS = os.environ.get("GITHUB_ACTIONS") == "true"
_SECRETS = []


def _gha(line):
    """Emit a GitHub Actions workflow command. No-op outside Actions."""
    if ON_ACTIONS:
        print(line, flush=True)


def mask(secret):
    """Register a secret with the runner so it is redacted everywhere, and
    remember it so redact() can scrub it from any text we print ourselves."""
    if not secret:
        return
    if secret not in _SECRETS:
        _SECRETS.append(secret)
    _gha(f"::add-mask::{secret}")


def fingerprint(secret):
    """The ONLY representation of a secret allowed in output."""
    if not secret:
        return "<unset>"
    return f"<redacted:...{secret[-4:]}>" if len(secret) >= 4 else "<redacted>"


def redact(text):
    """Belt-and-braces scrub of known secrets out of third-party output
    (e.g. gh CLI stderr) before we print it."""
    if not text:
        return text
    for secret in _SECRETS:
        if secret:
            text = text.replace(secret, fingerprint(secret))
    # Catch token-shaped strings we were never told about.
    text = re.sub(r"\b(gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})",
                  "<redacted:token-shaped>", text)
    return text


def summary(markdown):
    """Append to the Actions job summary (the big panel on the run page)."""
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    try:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(markdown.rstrip() + "\n\n")
    except Exception:
        pass


def die(code, headline, body):
    """Fail loudly: banner on stderr, an Actions ::error:: annotation, and a
    job-summary block. Used wherever continuing would mean failing silently."""
    body = redact(body)
    print(f"\n{'=' * 72}\n!! {headline}\n{'=' * 72}\n{body}\n", file=sys.stderr)
    _gha(f"::error title={headline}::" + body.strip().replace("\n", "%0A"))
    summary(f"## FAILED: {headline}\n\n```\n{body.strip()}\n```")
    sys.exit(code)


TOKEN = os.environ["IG_ACCESS_TOKEN"]
mask(TOKEN)
mask(os.environ.get("IG_REFRESH_PAT"))
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

# The one thing only Alex can do: Meta requires a human to authorize in a
# browser. Everything downstream of this URL is automated.
OAUTH_URL = (
    "https://www.instagram.com/oauth/authorize?"
    "client_id=2043524626547727&"
    "redirect_uri=https%3A%2F%2Falexwalker.co%2F&"
    "response_type=code&"
    "scope=instagram_business_basic"
)
REAUTH_STEPS = (
    f"  1. Open this URL in a browser and authorize:\n     {OAUTH_URL}\n"
    "  2. Copy the `code` value out of the resulting alexwalker.co redirect URL.\n"
    "  3. Exchange it for a long-lived token (scripts/README.md, "
    "'Re-authorizing from scratch').\n"
    "  4. Put that long-lived token in the IG_ACCESS_TOKEN repo secret:\n"
    "     gh secret set IG_ACCESS_TOKEN --repo nickswalker/alexwalker.co\n"
    "  5. Re-run this workflow. From then on it refreshes itself daily.\n"
)


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
    die(
        2,
        "EXPIRED/REVOKED: the IG_ACCESS_TOKEN repo secret "
        f"({fingerprint(TOKEN)}) is no longer valid",
        f"Meta says: [{code}] {msg}\n\n"
        "WHAT EXPIRED: the Instagram long-lived access token stored in the\n"
        "GitHub secret IG_ACCESS_TOKEN (repo nickswalker/alexwalker.co).\n"
        "Long-lived tokens last ~60 days; this one is dead, so alexwalker.co\n"
        "has stopped picking up new Instagram stills.\n\n"
        "THE ONE ACTION NEEDED - re-authorize in a browser (only Alex can do\n"
        "this; Meta requires a human):\n\n" + REAUTH_STEPS,
    )


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


def _gh(args, credential, stdin=None):
    """Run the gh CLI with the rotation credential in GH_TOKEN. The token
    value is passed via env/stdin only, never argv (argv is visible to every
    process on the runner). Returns the CompletedProcess."""
    env = os.environ.copy()
    env["GH_TOKEN"] = credential
    return subprocess.run(["gh", *args], env=env, input=stdin,
                          capture_output=True, text=True, timeout=120)


def rotation_credential():
    """The credential used to write the refreshed token back to the
    IG_ACCESS_TOKEN repo secret.

    Deliberately shape-agnostic so Alex can drop in whichever credential he
    prefers with NO code change — the workflow resolves all of these into
    IG_REFRESH_PAT before calling us:

      * a GitHub App installation token (minted per-run from the
        IG_APP_ID + IG_APP_PRIVATE_KEY secrets — nothing to expire), or
      * a classic PAT created with 'No expiration' and the `repo` scope, or
      * any other token with write access to this repo's Actions secrets.

    See scripts/README.md for which one is recommended and why."""
    return os.environ.get("IG_REFRESH_PAT") or ""


def refresh_and_persist():
    """Refresh the Instagram long-lived token and WRITE IT BACK to the
    IG_ACCESS_TOKEN repo secret.

    Meta long-lived tokens last ~60 days and may be refreshed once they are
    >24h and <60d old; each refresh returns a fresh 60-day token. Because we
    run daily, the token is perpetually renewed — PROVIDED the new value is
    persisted. It is the persistence that failed on 2026-09-15: the write-back
    referenced a secret (IG_REFRESH_PAT) that had never been created, the
    failure was a warning rather than an error, and the token quietly aged out.

    So: every failure below is FATAL. A refresh that is not persisted is worse
    than no refresh at all, because it looks like success."""
    try:
        r = requests.get(
            "https://graph.instagram.com/refresh_access_token",
            params={"grant_type": "ig_refresh_token", "access_token": TOKEN},
            timeout=30,
        )
    except Exception as e:
        die(3, "Instagram token refresh failed (network)",
            f"{type(e).__name__}: {e}\n\n"
            "Transient? Re-run the workflow. If it keeps failing, the token\n"
            "will expire ~60 days after it was last refreshed.")

    if not r.ok:
        body = r.text or ""
        # Meta refuses to refresh a token younger than 24h. That is benign:
        # the token was just minted and has a full ~60 days of life.
        if re.search(r"24\s*hour", body, re.I):
            print("Refresh skipped: token is less than 24h old (Meta's rule). "
                  "Nothing to persist.")
            summary("## Instagram token\n\nRefresh skipped - token is <24h old. "
                    "Next daily run will refresh it.")
            return
        die(3, "Instagram token refresh was REFUSED by Meta",
            f"HTTP {r.status_code}: {body[:500]}\n\n"
            f"WHAT EXPIRED: the long-lived Instagram token in the\n"
            f"IG_ACCESS_TOKEN repo secret ({fingerprint(TOKEN)}) can no longer\n"
            "be refreshed - it is past its ~60 day life or was revoked.\n\n"
            "THE ONE ACTION NEEDED - re-authorize in a browser:\n\n" + REAUTH_STEPS)

    data = r.json()
    new_token = data.get("access_token") or ""
    mask(new_token)
    days = int(data.get("expires_in", 0)) // 86400

    if not new_token:
        die(3, "Instagram returned no access_token on refresh",
            f"Response keys: {sorted(data)}")

    if new_token == TOKEN:
        print(f"Token refreshed in place; expiry extended to ~{days} days. "
              "Same value, nothing to persist.")
        summary(f"## Instagram token OK\n\nRefreshed in place, "
                f"~{days} days of life. Fingerprint {fingerprint(TOKEN)}.")
        return

    credential = rotation_credential()
    if not credential:
        die(4,
            "Instagram token ROTATED but CANNOT BE SAVED - no rotation credential",
            "Meta issued a new long-lived token, but there is no credential to\n"
            "write it into the IG_ACCESS_TOKEN repo secret, so the new value is\n"
            "being DISCARDED. The old token keeps ageing and will die.\n\n"
            "(The new token is deliberately NOT printed - this repo is public\n"
            f"and its logs are public. Fingerprint only: {fingerprint(new_token)})\n\n"
            "THE ONE ACTION NEEDED - give the workflow a non-expiring credential.\n"
            "Either set BOTH of these repo secrets:\n"
            "    IG_APP_ID, IG_APP_PRIVATE_KEY   (a GitHub App - preferred)\n"
            "or set this one:\n"
            "    IG_REFRESH_PAT                  (classic PAT, scope `repo`,\n"
            "                                     expiration: No expiration)\n\n"
            "Then re-run this workflow. See scripts/README.md.")
    mask(credential)

    repo = os.environ.get("GITHUB_REPOSITORY") or "nickswalker/alexwalker.co"
    try:
        p = _gh(["secret", "set", "IG_ACCESS_TOKEN", "--repo", repo],
                credential, stdin=new_token)
    except FileNotFoundError:
        die(5, "Cannot persist refreshed Instagram token - gh CLI not found",
            "scripts/sync_instagram.py --refresh-only needs the gh CLI. It is\n"
            "preinstalled on GitHub-hosted runners; install it if running "
            "elsewhere.")
    except subprocess.TimeoutExpired:
        die(5, "Cannot persist refreshed Instagram token - gh timed out",
            "`gh secret set` did not return within 120s.")

    if p.returncode != 0:
        die(5, "FAILED to persist the refreshed Instagram token",
            f"`gh secret set IG_ACCESS_TOKEN --repo {repo}` exited "
            f"{p.returncode}.\n"
            f"stderr: {redact(p.stderr)[:600]}\n\n"
            "The refreshed token has been DISCARDED and the stored one keeps\n"
            "ageing. Most likely the rotation credential lacks write access to\n"
            "this repo's Actions secrets, or it has expired.\n\n"
            "THE ONE ACTION NEEDED: replace the rotation credential with one\n"
            "that can write repo secrets and does not expire "
            "(see scripts/README.md).")

    # Read back: `gh secret set` exiting 0 is not proof the value landed.
    updated = None
    try:
        v = _gh(["api", f"repos/{repo}/actions/secrets/IG_ACCESS_TOKEN"], credential)
        if v.returncode == 0:
            updated = (json.loads(v.stdout) or {}).get("updated_at")
    except Exception:
        pass
    if updated:
        age = datetime.now(timezone.utc) - datetime.fromisoformat(
            updated.replace("Z", "+00:00"))
        if age > timedelta(minutes=10):
            die(6, "IG_ACCESS_TOKEN secret did NOT change",
                f"`gh secret set` reported success but the secret's updated_at\n"
                f"is still {updated} ({int(age.total_seconds() // 60)} minutes "
                "old).\nTreating this as a failed rotation rather than trusting "
                "it.")

    print(f"Rotated IG_ACCESS_TOKEN secret -> {fingerprint(new_token)}; "
          f"valid ~{days} days"
          + (f" (secret updated_at {updated})" if updated else "") + ".")
    summary(f"## Instagram token rotated\n\n"
            f"- New token persisted to the `IG_ACCESS_TOKEN` secret\n"
            f"- Fingerprint: `{fingerprint(new_token)}`\n"
            f"- Valid for ~{days} days\n"
            f"- Secret `updated_at`: `{updated or 'unverified'}`")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--no-refresh", action="store_true",
                   help="sync media only; do not touch the access token")
    g.add_argument("--refresh-only", action="store_true",
                   help="only refresh + persist the access token")
    args = ap.parse_args()

    if args.refresh_only:
        verify_token()
        refresh_and_persist()
        return

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

    if not args.no_refresh:
        refresh_and_persist()


if __name__ == "__main__":
    main()
