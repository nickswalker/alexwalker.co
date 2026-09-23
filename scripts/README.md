# scripts/

One-off image and site tooling lives here. The only thing in this directory
that runs unattended — and the only thing with a credential attached — is the
Instagram stills pipeline, documented below.

---

# Instagram token lifecycle

**Grep terms:** `IG_ACCESS_TOKEN` `IG_REFRESH_PAT` `IG_APP_ID`
`IG_APP_PRIVATE_KEY` instagram token expired reauthorize captions editor

## What runs

| Piece | Where |
| --- | --- |
| Sync script | `scripts/sync_instagram.py` |
| Workflow | `.github/workflows/sync-instagram.yaml` — daily 05:00 UTC + `workflow_dispatch` |
| Output | `_data/instagram.yml`, `img/instagram/*.jpg` (auto-committed) |
| Hand-edited captions/crops | `_data/instagram_captions.yml` |

The workflow does three things in order: **sync media** → **commit** →
**refresh and persist the access token**. They are separate steps on purpose,
so a credential problem fails the job loudly without discarding the photos.

## How the token stays alive

Meta issues **long-lived** Instagram tokens that last **~60 days**. They can be
refreshed once they are older than 24h and younger than 60 days, and each
refresh returns a *new* token good for another 60 days.

That renewal is only durable if the new value is **written back** to the
`IG_ACCESS_TOKEN` repo secret. The workflow refreshes on **every run** (daily),
so the token is renewed roughly 60× more often than strictly necessary — any
single failed run is harmless.

> **This is what broke on 2026-09-15.** The write-back read a secret called
> `IG_REFRESH_PAT` that had **never been created**, and the failure was printed
> as a *warning*. Every daily run "succeeded", the refreshed token was thrown
> away each time, and the stored one quietly aged out. Every failure on that
> path is now **fatal** and annotated on the run page.

## Secrets

| Secret | Purpose | Expires? |
| --- | --- | --- |
| `IG_ACCESS_TOKEN` | The Instagram long-lived token. Read by the sync script; **rewritten by the workflow on every refresh.** | ~60 days, auto-renewed |
| `IG_REFRESH_PAT` | Credential used to write `IG_ACCESS_TOKEN` back. **Must be a classic PAT with scope `repo` and expiration "No expiration".** | must be **never** |
| `IG_APP_ID` + `IG_APP_PRIVATE_KEY` | Optional alternative to `IG_REFRESH_PAT`: a GitHub App. The workflow mints a fresh installation token each run. | never (private keys don't expire) |
| `SSH_PRIVATE_KEY`, `CLOUDFLARE_*` | Unrelated — used by the deploy job in `ci.yaml`. | n/a |

Set either `IG_REFRESH_PAT` **or** the two `IG_APP_*` secrets. If both exist the
App token wins. No code change is needed to switch between them.

**Do not use a fine-grained PAT here.** They cap at 366 days, and GitHub's
"regenerate" button re-arms the *original* duration — so a 30- or 90-day token
regenerates to another 30 or 90 days, forever. That treadmill is the thing this
setup exists to get off.

`GITHUB_TOKEN` cannot be used: it has no permission to write Actions secrets.

## When it breaks: re-authorizing from scratch

Only needed if Meta revokes the token or the refresh chain is broken for
>60 days. **Meta requires a human in a browser — this step cannot be
automated.** Everything after it is.

1. Open this URL while logged into the Instagram account and authorize:

   ```
   https://www.instagram.com/oauth/authorize?client_id=2043524626547727&redirect_uri=https%3A%2F%2Falexwalker.co%2F&response_type=code&scope=instagram_business_basic
   ```

2. You land on `https://alexwalker.co/?code=XXXX…#_`. Copy the `code` value
   (strip a trailing `#_` if present). It is valid for about an hour.

3. Exchange it for a **short-lived** token. `IG_APP_SECRET` is the Instagram
   app secret from the Meta app dashboard (App ID `2043524626547727`):

   ```sh
   curl -sX POST https://api.instagram.com/oauth/access_token \
     -F client_id=2043524626547727 \
     -F client_secret="$IG_APP_SECRET" \
     -F grant_type=authorization_code \
     -F redirect_uri=https://alexwalker.co/ \
     -F code="$CODE"
   ```

4. Exchange that for the **long-lived (60-day)** token:

   ```sh
   curl -s "https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=$IG_APP_SECRET&access_token=$SHORT_LIVED"
   ```

5. Store it (reads the value from stdin so it never lands in shell history):

   ```sh
   gh secret set IG_ACCESS_TOKEN --repo nickswalker/alexwalker.co
   ```

6. Re-run the workflow:

   ```sh
   gh workflow run sync-instagram.yaml --repo nickswalker/alexwalker.co
   ```

   From here it renews itself daily. Confirm the run's job summary says
   *"Instagram token rotated"* or *"Instagram token OK"*.

## Secrets never appear in logs

This repository is **public**, so its Actions logs are public. `sync_instagram.py`
registers every token it handles with `::add-mask::` (the runner then redacts
that value from all subsequent output, including other steps' output) and prints
tokens only as a last-4 fingerprint, e.g. `<redacted:...9f3a>`. Output captured
from the `gh` CLI is scrubbed before printing, including anything merely
*shaped* like a token. The new token value is passed to `gh secret set` on
**stdin**, never on the command line, so it is not visible in the runner's
process list.

## Where the caption editor lives

Captions and per-image crop overrides are **not** edited in this repo by hand.
They are edited in the **alexwalker-stats Flask app**:

- Source on the NAS: `/Volumes/docker/alexwalker-stats` (`app.py`)
- URL: `/admin/captions/` — **tailnet-only** (gated on the
  `Tailscale-User-Login` header; not reachable from the public internet)
- Saving proxies a commit of `_data/instagram_captions.yml` to
  `nickswalker/alexwalker.co` through the server's own `GITHUB_PAT`, then
  dispatches this workflow so the crops are re-rendered and deployed.

That app holds its own GitHub credential in `/Volumes/docker/alexwalker-stats/.env`
(`GITHUB_PAT`). It is separate from `IG_REFRESH_PAT` and is **not** used by CI.
