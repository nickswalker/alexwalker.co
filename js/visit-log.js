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
const OUTBOUND_URL = `${BACKEND_BASE}/out`;

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

// Outbound-click tracker. Site-wide delegated listener: any click on an
// anchor whose hostname differs from the current one ships a beacon to
// /out so the admin Visitors page can show which exit link a visitor
// took before leaving the site. sendBeacon (form data, simple request)
// survives the navigation that the click is about to cause. Self-links
// to alexwalker.co subdomains, in-page anchors, javascript:, mailto:,
// tel:, and Tailscale-routed analytics URLs are all skipped.
function isOutbound(href, currentHost) {
    if (!href) return false;
    const trimmed = href.trim();
    if (!trimmed) return false;
    if (/^(?:javascript|mailto|tel|sms|data|blob):/i.test(trimmed)) return false;
    if (trimmed[0] === '#' || trimmed[0] === '?') return false;
    if (!/^https?:/i.test(trimmed)) return false;
    try {
        const u = new URL(trimmed, window.location.href);
        if (!u.hostname || u.hostname === currentHost) return false;
        // Treat alexwalker.co subdomains as same-site (analytics, etc.).
        if (u.hostname === currentHost ||
            u.hostname.endsWith('.' + currentHost) ||
            currentHost.endsWith('.' + u.hostname)) return false;
        // Skip our own backend endpoints if they ever appear inline.
        if (u.hostname === 'nexus.tail1c6f41.ts.net') return false;
        return u.toString();
    } catch (_) { return false; }
}
export function initOutboundLinkTracking() {
    if (typeof document === 'undefined') return;
    const currentHost = window.location.hostname;
    document.addEventListener('click', function (e) {
        // Walk up to find the nearest anchor; clicks can land on inner spans.
        const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
        if (!a) return;
        const dest = isOutbound(a.getAttribute('href'), currentHost);
        if (!dest) return;
        const { dev, me } = getOwnerFlags();
        const params = new URLSearchParams();
        params.set('u', dest);
        params.set('p', window.location.pathname || '/');
        if (dev) params.set('dev', '1');
        if (me) params.set('me', me);
        // sendBeacon prefers Blob/FormData over URL params for some
        // browsers, but form data works everywhere and counts as a CORS
        // simple request — same shape as /vd.
        try {
            const fd = new FormData();
            fd.append('u', dest);
            fd.append('p', window.location.pathname || '/');
            const url = (dev || me)
                ? `${OUTBOUND_URL}?${params.toString()}`
                : OUTBOUND_URL;
            if (navigator.sendBeacon) {
                navigator.sendBeacon(url, fd);
            } else {
                fetch(url, { method: 'POST', body: fd, keepalive: true })
                    .catch(() => { /* ignore */ });
            }
        } catch (_) { /* ignore */ }
    }, { capture: true });
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
