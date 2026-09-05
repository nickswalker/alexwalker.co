// Homepage tile shuffle — a different still on each of the Narrative and
// Commercial tiles on every page load.
//
// This is the same idea as the Instagram stills row (js/still-row.js) applied
// to the project grids, and it deliberately reuses that module's three moving
// parts rather than inventing a second system:
//
//   * fetch a build-generated JSON blob of per-image measurements,
//   * exclude what the previous load showed, via localStorage, so nothing
//     repeats back-to-back,
//   * Fisher-Yates over the surviving candidates.
//
// What's new here is that still-row picks 16 images from ONE pool, where this
// picks one image per tile from ~19 separate pools and has to make the
// resulting SET look deliberate. Hence `scoreCandidate` below — still-row's
// arrangeHueSpectrum/arrangeTonalCluster sort a single row after the fact,
// which can't work when each slot is a different project.
//
// All the measurement is done at build time by scripts/build_thumb_shuffle.py.
// This file only reads numbers and compares them.

const DATA_URL = '/data/thumb-shuffle.json';
const PREV_KEY = 'thumb-shuffle-prev';

// A tile's pool is exhausted-then-reshuffled: we remember every still already
// shown for that tile and only reset once they've all been seen.
const MAX_TILE_HISTORY = 32;

// Neighbours in a 2-column grid: the tile immediately before, and the tile
// directly above (two back). Those are the two a visitor actually sees
// side-by-side/stacked, so they're the only ones worth scoring against.
const NEIGHBOUR_OFFSETS = [1, 2];

const DARK = 0.25;          // below this mean luminance a frame reads as "dark"
const CLASH = 0.28;         // hue distance (0..0.5) beyond which two frames clash
const SAME_BALANCE = 0.12;  // subject sits in the same third
const SAME_EDGE = 0.02;     // same visual busy-ness

async function fetchJSON(url) {
    try {
        const r = await fetch(url, { cache: 'no-cache' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
    } catch (e) {
        console.error('[thumb-shuffle] failed to fetch', url, e);
        return null;
    }
}

function shuffle(arr) {
    // Fisher-Yates in place — same helper as still-row.js.
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/** Shortest distance between two hues on the colour wheel, 0..0.5. */
function hueDistance(a, b) {
    const d = Math.abs(a - b) % 1;
    return d > 0.5 ? 1 - d : d;
}

function readPrev() {
    try {
        const raw = JSON.parse(localStorage.getItem(PREV_KEY) || '{}');
        return raw && typeof raw === 'object' ? raw : {};
    } catch { return {}; }
}

function writePrev(prev) {
    try {
        localStorage.setItem(PREV_KEY, JSON.stringify(prev));
    } catch { /* private mode, quota — the page is still correct without it */ }
}

/**
 * How well does `cand` sit next to the frames already placed in `neighbours`?
 * Higher is better. Every term is a plain comparison of two build-time
 * numbers, so scoring the whole grid is a few hundred float ops.
 */
function scoreCandidate(cand, neighbours) {
    let score = 0;

    for (const n of neighbours) {
        // Colour. Frames that are both washed out have no palette worth
        // comparing, so only judge hue when both actually carry colour.
        if (cand.saturation >= 0.12 && n.saturation >= 0.12) {
            const d = hueDistance(cand.hue, n.hue);
            if (d <= 0.14) score += 2.0;        // analogous — reads as one look
            else if (d < CLASH) score += 0.5;
            else score -= 2.5;                  // near-opposite — clashes
        }

        // Tone. Two dark frames adjacent turn into one black hole in the grid.
        if (cand.luminance < DARK && n.luminance < DARK) score -= 3.0;
        // ...but a hard bright/dark jump next to each other is also jarring.
        const lumGap = Math.abs(cand.luminance - n.luminance);
        if (lumGap > 0.42) score -= 1.2;
        else if (lumGap > 0.10 && lumGap < 0.30) score += 1.0; // pleasant variation

        // Composition. Same subject placement AND same busy-ness reads as a
        // duplicate even when the images are unrelated.
        if (Math.abs(cand.balance - n.balance) < SAME_BALANCE
            && Math.abs(cand.edge - n.edge) < SAME_EDGE) {
            score -= 2.0;
        }
        // Mirrored subject placement (one left-weighted, one right-weighted)
        // is the classic pleasing pair.
        if (Math.abs(cand.balance - n.balance) > 0.25) score += 0.8;
    }

    // Break ties without a tie-breaking rule anyone could notice. Small
    // relative to the terms above, so it never overrides a real clash.
    return score + Math.random() * 0.6;
}

export async function initThumbShuffle() {
    const anchors = Array.from(
        document.querySelectorAll('.thumbnails.playbuttons a[data-rich]')
    ).filter(a => a.querySelector('img'));
    if (!anchors.length) return;

    const data = await fetchJSON(DATA_URL);
    if (!data || !data.tiles) return;

    const prev = readPrev();
    const chosen = [];   // parallel to `anchors`; holds the picked frame or null
    const nextPrev = {};

    anchors.forEach((anchor, idx) => {
        const key = anchor.dataset.rich;
        const tile = data.tiles[key];
        chosen[idx] = null;
        if (!tile || !Array.isArray(tile.frames) || tile.frames.length < 2) return;

        // No-repeat: drop everything this visitor has already been shown for
        // THIS tile. When the pool runs dry the history resets and the tile
        // starts over — a full reshuffle, not a re-randomise.
        const seen = new Set(Array.isArray(prev[key]) ? prev[key] : []);
        let pool = tile.frames.filter(f => !seen.has(f.src));
        let history = Array.isArray(prev[key]) ? prev[key].slice() : [];
        if (!pool.length) {
            pool = tile.frames.slice();
            history = [];
        }

        // Neighbours already decided this pass, in grid-adjacency order.
        const neighbours = [];
        for (const off of NEIGHBOUR_OFFSETS) {
            const n = chosen[idx - off];
            if (n) neighbours.push(n);
        }

        // Shuffle first so equal scores don't always resolve to the same
        // frame, then take the best-scoring candidate for this slot.
        const candidates = shuffle(pool.slice());
        let best = candidates[0];
        let bestScore = -Infinity;
        for (const c of candidates) {
            const s = scoreCandidate(c, neighbours);
            if (s > bestScore) { bestScore = s; best = c; }
        }

        chosen[idx] = best;
        history.push(best.src);
        nextPrev[key] = history.slice(-MAX_TILE_HISTORY);
    });

    // Single write pass. Only the <img> changes — the anchor, its href, its
    // data-rich and the lightbox's own frame list are all untouched, so
    // clicking a tile still opens the full gallery in the authored order.
    anchors.forEach((anchor, idx) => {
        const pick = chosen[idx];
        if (!pick) return;
        const img = anchor.querySelector('img');
        if (!img) return;
        img.src = pick.src;
        // Each still carries its OWN description, not the tile's generic one.
        if (pick.alt) img.alt = pick.alt;
    });

    writePrev(Object.assign({}, prev, nextPrev));
}
