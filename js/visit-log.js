// Anonymous visit + video-play pings to the alexwalker-stats Flask backend
// (lives in /Volumes/docker/alexwalker-stats, separate from the cinemaxxing
// stack). Hashed (IP + UA) server-side; no cookies, no third party.
//   ?p=<path>   current pathname, for the Top Pages admin view
//   ?me=<tok>   personal bookmark label
//   ?v=<id>     video id for a play event (sent only when a lightbox opens)
//   ?dev=1      owner override — visiting any page with ?dev=1 latches the
//               flag in localStorage so subsequent pages on the same
//               browser are also filtered as owner traffic. Needed because
//               iOS MagicDNS doesn't always route the pixel through the
//               tailnet on cellular, so the backend's Tailscale-header
//               auto-detect misses it.

const BACKEND_BASE = 'https://nexus.tail1c6f41.ts.net/aw';
const PIXEL_URL = `${BACKEND_BASE}/p.gif`;
const DURATION_URL = `${BACKEND_BASE}/vd`;

const DEV_KEY = 'aw-dev';
const ME_KEY = 'aw-me';

function getOwnerFlags() {
    const url = new URLSearchParams(window.location.search);
    const urlDev = url.get('dev') === '1';
    const urlMe = url.get('me') || '';
    // Latch URL-level overrides into localStorage so the *next* navigation
    // (which may not carry the query string) still tags this browser.
    try {
        if (urlDev) localStorage.setItem(DEV_KEY, '1');
        if (urlMe) localStorage.setItem(ME_KEY, urlMe);
    } catch (_) {}
    let dev = urlDev;
    let me = urlMe;
    if (!dev) {
        try { dev = localStorage.getItem(DEV_KEY) === '1'; } catch (_) {}
    }
    if (!me) {
        try { me = localStorage.getItem(ME_KEY) || ''; } catch (_) {}
    }
    return { dev, me };
}

function ping(extra) {
    const params = new URLSearchParams(extra);
    const img = new Image();
    img.referrerPolicy = 'no-referrer-when-downgrade';
    img.decoding = 'async';
    img.src = `${PIXEL_URL}?${params.toString()}`;
}

export function sendPagePixel() {
    const { dev, me } = getOwnerFlags();
    const data = { p: window.location.pathname || '/' };
    if (dev) data.dev = '1';
    if (me) data.me = me;
    ping(data);
}

// Extract a YouTube video id (or playlist id) from an embed URL so the
// backend can aggregate which videos visitors actually played.
function videoIdFromHref(href) {
    try {
        const u = new URL(href, window.location.origin);
        const list = u.searchParams.get('list');
        const m = u.pathname.match(/\/embed\/(?:videoseries)?\/?([^/?#]+)?/);
        const vid = m && m[1] ? m[1] : null;
        return vid || (list ? `list:${list}` : null);
    } catch (_) {
        return null;
    }
}

export function sendVideoPixel(href) {
    const id = videoIdFromHref(href);
    if (!id) return;
    const { dev, me } = getOwnerFlags();
    const data = { v: id, p: window.location.pathname || '/' };
    if (dev) data.dev = '1';
    if (me) data.me = me;
    ping(data);
}

// Fire on lightbox close. Uses sendBeacon so the request survives navigation
// and tab-close. FormData → "simple request" → no preflight needed.
export function sendVideoDuration(href, durationMs) {
    const id = videoIdFromHref(href);
    if (!id || !durationMs || durationMs <= 0) return;
    const { dev } = getOwnerFlags();
    try {
        const fd = new FormData();
        fd.append('v', id);
        fd.append('d', String(Math.round(durationMs)));
        // Owner flag goes in the URL query string because the backend's
        // _is_owner_traffic() reads request.args, not the form body.
        const url = dev ? `${DURATION_URL}?dev=1` : DURATION_URL;
        if (navigator.sendBeacon) {
            navigator.sendBeacon(url, fd);
        } else {
            fetch(url, { method: 'POST', body: fd, keepalive: true })
                .catch(() => { /* ignore */ });
        }
    } catch (_) { /* ignore */ }
}
