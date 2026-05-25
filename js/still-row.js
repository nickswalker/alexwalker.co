// Populates the #instagram-stills row on page load. Reads the embedded
// JSON data, randomly picks an arrangement method (hue spectrum or
// tonal cluster) and a content-selection strategy (newest / most
// colorful / brightest), then writes <a class="stills-image"> elements
// that the existing lightbox auto-init will grab.

const TARGET_COUNT = 16;
// Each strategy ranks the full library, takes the top CANDIDATE_POOL, then
// picks TARGET_COUNT at random from that bucket. Without this widening,
// `selectSubset` would return the same top-16 every time — across the 3
// strategies that's only ~46 distinct photos out of a 135-post library,
// and a viewer who refreshes a few times sees the same shots cycle.
// 60 keeps each bucket meaningfully skewed (colorful still picks from
// the more-saturated half, newest still skews to the recent years) while
// letting the rotation reach across the whole library over a session.
const CANDIDATE_POOL = 60;
const METHODS = ['hue', 'tonal'];
const SELECTIONS = ['newest', 'colorful', 'brightest'];
const PREV_KEY = 'instagram-stills-prev-ids';

async function fetchJSON(url) {
    try {
        const r = await fetch(url, { cache: 'no-cache' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
    } catch (e) {
        console.error('[instagram-stills] failed to fetch', url, e);
        return null;
    }
}

function shuffle(arr) {
    // Fisher-Yates in place.
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function selectSubset(items, strategy, count) {
    const sorted = items.slice();
    if (strategy === 'newest') {
        sorted.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    } else if (strategy === 'colorful') {
        sorted.sort((a, b) => b.saturation - a.saturation);
    } else if (strategy === 'brightest') {
        sorted.sort((a, b) => b.value - a.value);
    }
    // Take the top CANDIDATE_POOL by this strategy, then randomly pick
    // `count` from that bucket so the rotation actually traverses the
    // library instead of locking on the same 16 every refresh.
    const candidates = sorted.slice(0, CANDIDATE_POOL);
    return shuffle(candidates).slice(0, count);
}

function arrangeHueSpectrum(items) {
    const saturated = items
        .filter(i => i.saturation >= 0.15)
        .sort((a, b) => a.hue - b.hue);
    const neutrals = items
        .filter(i => i.saturation < 0.15)
        .sort((a, b) => b.value - a.value);
    return saturated.concat(neutrals);
}

function arrangeTonalCluster(items) {
    const sat = items.filter(i => i.saturation >= 0.15);
    const warm = sat.filter(i => i.hue < 0.17 || i.hue >= 0.83).sort((a, b) => a.hue - b.hue);
    const greens = sat.filter(i => i.hue >= 0.17 && i.hue < 0.4).sort((a, b) => a.hue - b.hue);
    const cool = sat.filter(i => i.hue >= 0.4 && i.hue < 0.7).sort((a, b) => a.hue - b.hue);
    const purples = sat.filter(i => i.hue >= 0.7 && i.hue < 0.83).sort((a, b) => a.hue - b.hue);
    const neutrals = items
        .filter(i => i.saturation < 0.15)
        .sort((a, b) => b.value - a.value);
    return warm.concat(greens, cool, purples, neutrals);
}

function escapeHTML(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function cleanIgCaption(text) {
    if (!text) return '';
    // Drop trailing hashtag run, then trim and truncate.
    const noTags = text.replace(/(\s+#\S+)+\s*$/g, '').trim();
    return noTags.length > 120 ? noTags.slice(0, 117) + '…' : noTags;
}

function formatDate(iso) {
    try {
        const d = new Date(iso);
        return `${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()}`;
    } catch { return ''; }
}

function buildCaption(item, cap) {
    const parts = [];
    if (cap && cap.title) {
        parts.push(`<strong>${escapeHTML(cap.title)}</strong>`);
    } else {
        const ig = cleanIgCaption(item.caption);
        if (ig) parts.push(escapeHTML(ig));
    }
    if (cap && cap.location) parts.push(escapeHTML(cap.location));
    if (cap && cap.date) parts.push(escapeHTML(cap.date));
    else if (item.timestamp) parts.push(formatDate(item.timestamp));
    if (cap && cap.camera) parts.push(escapeHTML(cap.camera));
    if (cap && cap.lens) parts.push(escapeHTML(cap.lens));
    parts.push(
        `<a href="${escapeHTML(item.permalink)}" target="_blank" rel="noopener">View on Instagram</a>`
    );
    return parts.join('<br>');
}

export async function initInstagramStills() {
    const row = document.getElementById('instagram-stills');
    if (!row) return;

    const [items, captionsRaw] = await Promise.all([
        fetchJSON('/data/instagram.json'),
        fetchJSON('/data/instagram_captions.json'),
    ]);
    const captions = captionsRaw || {};
    if (!Array.isArray(items) || items.length === 0) return;

    // Filter out items the user has explicitly marked hide:true
    const visible = items.filter(i => !(captions[i.id] && captions[i.id].hide));

    // Exclude the 16 IDs shown on the immediately-previous load so no
    // photo repeats across consecutive refreshes. Two refreshes later
    // anything is eligible again. If excluding leaves us too few to
    // fill the row (e.g. pool shrank), fall back to the full set.
    let prevIds = [];
    try {
        prevIds = JSON.parse(localStorage.getItem(PREV_KEY) || '[]');
    } catch { prevIds = []; }
    const prevSet = new Set(prevIds);
    const eligible = visible.filter(i => !prevSet.has(i.id));
    const pool = eligible.length >= TARGET_COUNT ? eligible : visible;

    // Randomize arrangement and selection on each page load
    const method = METHODS[Math.floor(Math.random() * METHODS.length)];
    const selection = SELECTIONS[Math.floor(Math.random() * SELECTIONS.length)];

    const subset = selectSubset(pool, selection, TARGET_COUNT);
    const arranged = method === 'hue'
        ? arrangeHueSpectrum(subset)
        : arrangeTonalCluster(subset);

    row.innerHTML = arranged.map(item => {
        const cap = captions[item.id];
        const captionHTML = buildCaption(item, cap);
        // captionHTML is already safe (user fields escaped inside
        // buildCaption); only need to make it attribute-safe by
        // escaping double quotes.
        const captionAttr = captionHTML.replace(/"/g, '&quot;');
        const altText = (cap && cap.title) || cleanIgCaption(item.caption) || '';
        return `<li>
            <a href="${escapeHTML(item.image)}" class="stills-image" data-lightbox="stills" data-caption="${captionAttr}">
                <img src="${escapeHTML(item.thumb)}" loading="lazy" alt="${escapeHTML(altText)}">
            </a>
        </li>`;
    }).join('');

    // Remember this load's IDs so the next refresh can exclude them.
    try {
        localStorage.setItem(PREV_KEY, JSON.stringify(subset.map(i => i.id)));
    } catch { /* private mode, quota, etc. — safe to skip */ }

    // Mark which combo rendered — useful for debugging or sharing favorites.
    row.dataset.arrangement = method;
    row.dataset.selection = selection;
}

// Subtle "Refresh the page to see a different set of stills" hint that
// fades in only after the visitor has lingered on the stills section.
// "Lingered" = the section has been continuously in the viewport for
// LINGER_MS. Scrolling away resets the timer so a quick pass-through
// won't trigger it. Once revealed, it stays for the rest of the session.
(function armStillsHint() {
    const LINGER_MS = 4500;
    const hint = document.querySelector('.stills-hint');
    const section = document.getElementById('stills');
    if (!hint || !section || !('IntersectionObserver' in window)) return;

    let timer = null;
    const reveal = () => hint.classList.add('is-visible');

    const io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting && entry.intersectionRatio >= 0.4) {
                if (timer == null && !hint.classList.contains('is-visible')) {
                    timer = window.setTimeout(reveal, LINGER_MS);
                }
            } else if (timer != null) {
                window.clearTimeout(timer);
                timer = null;
            }
        }
    }, { threshold: [0, 0.4, 1] });

    io.observe(section);
})();
