// Anonymous visit + video-play pings to the alexwalker-stats Flask backend
// (lives in /Volumes/docker/alexwalker-stats, separate from the cinemaxxing
// stack). Hashed (IP + UA) server-side; no cookies, no third party.
//   ?p=<path>   current pathname, for the Top Pages admin view
//   ?me=<tok>   personal bookmark label
//   ?v=<id>     video id for a play event (sent only when a lightbox opens)

const PIXEL_URL = 'https://nexus.tail1c6f41.ts.net/aw/p.gif';

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
export function sendVideoPixel(href) {
    try {
        const u = new URL(href, window.location.origin);
        const list = u.searchParams.get('list');
        const m = u.pathname.match(/\/embed\/(?:videoseries)?\/?([^/?#]+)?/);
        const vid = m && m[1] ? m[1] : null;
        const id = vid || (list ? `list:${list}` : null);
        if (!id) return;
        ping({ v: id, p: window.location.pathname || '/' });
    } catch (_) { /* ignore malformed URLs */ }
}
