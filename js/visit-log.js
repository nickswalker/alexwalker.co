// Anonymous visit + video-play pings to the alexwalker-stats Flask backend
// (lives in /Volumes/docker/alexwalker-stats, separate from the cinemaxxing
// stack). Hashed (IP + UA) server-side; no cookies, no third party.
//   ?p=<path>   current pathname, for the Top Pages admin view
//   ?me=<tok>   personal bookmark label
//   ?v=<id>     video id for a play event (sent only when a lightbox opens)

const BACKEND_BASE = 'https://nexus.tail1c6f41.ts.net/aw';
const PIXEL_URL = `${BACKEND_BASE}/p.gif`;
const DURATION_URL = `${BACKEND_BASE}/vd`;

function ping(extra) {
    const params = new URLSearchParams(extra);
    const img = new Image();
    img.referrerPolicy = 'no-referrer-when-downgrade';
    img.decoding = 'async';
    img.src = `${PIXEL_URL}?${params.toString()}`;
}

export function sendPagePixel() {
    const me = new URLSearchParams(window.location.search).get('me');
    const data = { p: window.location.pathname || '/' };
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
    ping({ v: id, p: window.location.pathname || '/' });
}

// Fire on lightbox close. Uses sendBeacon so the request survives navigation
// and tab-close. FormData → "simple request" → no preflight needed.
export function sendVideoDuration(href, durationMs) {
    const id = videoIdFromHref(href);
    if (!id || !durationMs || durationMs <= 0) return;
    try {
        const fd = new FormData();
        fd.append('v', id);
        fd.append('d', String(Math.round(durationMs)));
        if (navigator.sendBeacon) {
            navigator.sendBeacon(DURATION_URL, fd);
        } else {
            fetch(DURATION_URL, { method: 'POST', body: fd, keepalive: true })
                .catch(() => { /* ignore */ });
        }
    } catch (_) { /* ignore */ }
}
