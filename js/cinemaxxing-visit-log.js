// Anonymous visit pings to the movie-tool Flask backend (web container,
// which also serves the Cinemaxxing newsletter admin). Hashed (IP + UA)
// server-side; no cookies, no third party. Separate file from
// visit-log.js so cinemaxxing.co and alexwalker.co stats stay isolated:
// different backend base, different dev-latching localStorage keys.
//   ?p=<path>   current pathname, for the Top Pages admin view
//   ?me=<tok>   personal bookmark label
//   ?dev=1      owner override — latches into localStorage so subsequent
//               pages on the same browser are also filtered as owner
//               traffic. Needed because iOS MagicDNS doesn't always route
//               the pixel through the tailnet on cellular.

const BACKEND_BASE = 'https://nexus.tail1c6f41.ts.net';
const PIXEL_URL = `${BACKEND_BASE}/p.gif`;
const OUTBOUND_URL = `${BACKEND_BASE}/out`;

const DEV_KEY = 'cx-dev';
const ME_KEY = 'cx-me';

// Hostnames treated as same-site for outbound-click purposes. cinemaxxing.co
// is proxied through a Cloudflare worker that masks alexwalker.co, so the
// page can be served from either host — keep both in the allowlist so
// internal navigation never fires an /out beacon.
const SAME_SITE_HOSTS = new Set([
    'cinemaxxing.co',
    'www.cinemaxxing.co',
    'alexwalker.co',
    'www.alexwalker.co',
    'nexus.tail1c6f41.ts.net', // beacon endpoint itself
]);

function getOwnerFlags() {
    const url = new URLSearchParams(window.location.search);
    const urlDev = url.get('dev') === '1';
    const urlMe = url.get('me') || '';
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

// Outbound-click tracker. Delegated listener: any click on an anchor whose
// hostname isn't in SAME_SITE_HOSTS ships a beacon to /out so the admin
// Visitors page can show which exit link a visitor took (e.g. a theater
// "Website" link or a TICKETS link to alamodrafthouse.com) before leaving.
// sendBeacon survives the navigation. javascript:, mailto:, tel:, in-page
// anchors, and the beacon endpoint itself are all skipped.
function isOutbound(href) {
    if (!href) return false;
    const trimmed = href.trim();
    if (!trimmed) return false;
    if (/^(?:javascript|mailto|tel|sms|data|blob):/i.test(trimmed)) return false;
    if (trimmed[0] === '#' || trimmed[0] === '?') return false;
    if (!/^https?:/i.test(trimmed)) return false;
    try {
        const u = new URL(trimmed, window.location.href);
        if (!u.hostname) return false;
        if (SAME_SITE_HOSTS.has(u.hostname)) return false;
        return u.toString();
    } catch (_) { return false; }
}

export function initOutboundLinkTracking() {
    if (typeof document === 'undefined') return;
    document.addEventListener('click', function (e) {
        const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
        if (!a) return;
        const dest = isOutbound(a.getAttribute('href'));
        if (!dest) return;
        const { dev, me } = getOwnerFlags();
        const params = new URLSearchParams();
        params.set('u', dest);
        params.set('p', window.location.pathname || '/');
        if (dev) params.set('dev', '1');
        if (me) params.set('me', me);
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
