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

// How much each kind of grid neighbour counts. A tile stacked directly ABOVE
// another is the harshest comparison a visitor makes — the two frames share a
// vertical edge and the eye travels straight down between them — so vertical
// adjacency is weighted well above side-by-side.
const VERTICAL_WEIGHT = 1.6;
const HORIZONTAL_WEIGHT = 1.0;

const DARK = 0.25;          // below this mean luminance a frame reads as "dark"
const CLASH = 0.28;         // hue distance (0..0.5) beyond which two frames clash
const SAME_BALANCE = 0.12;  // subject sits in the same third
const SAME_EDGE = 0.02;     // same visual busy-ness
const TIGHT = 0.42;         // face fills this much of the frame height = close-up

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
 *
 * `neighbours` is [{ frame, weight }] — weight says how strongly this pairing
 * is felt, so a bad stack costs more than the same badness side-by-side.
 */
function scoreCandidate(cand, neighbours) {
    let score = 0;

    for (const { frame: n, weight } of neighbours) {
        let s = 0;

        // Colour. Frames that are both washed out have no palette worth
        // comparing, so only judge hue when both actually carry colour.
        if (cand.saturation >= 0.12 && n.saturation >= 0.12) {
            const d = hueDistance(cand.hue, n.hue);
            if (d <= 0.14) s += 2.0;            // analogous — reads as one look
            else if (d < CLASH) s += 0.5;
            else s -= 2.5;                      // near-opposite — clashes
        }

        // Tone. Two dark frames adjacent turn into one black hole in the grid.
        if (cand.luminance < DARK && n.luminance < DARK) s -= 3.0;
        // ...but a hard bright/dark jump next to each other is also jarring.
        const lumGap = Math.abs(cand.luminance - n.luminance);
        if (lumGap > 0.42) s -= 1.2;
        else if (lumGap > 0.10 && lumGap < 0.30) s += 1.0; // pleasant variation

        // Composition. Same subject placement AND same busy-ness reads as a
        // duplicate even when the images are unrelated.
        if (Math.abs(cand.balance - n.balance) < SAME_BALANCE
            && Math.abs(cand.edge - n.edge) < SAME_EDGE) {
            s -= 2.0;
        }
        // Mirrored subject placement (one left-weighted, one right-weighted)
        // is the classic pleasing pair.
        if (Math.abs(cand.balance - n.balance) > 0.25) s += 0.8;

        // Subject facing. Two people looking the same way in adjacent tiles
        // read as one shot repeated — the mirrored-pair effect. `facing` is
        // 'neutral' whenever the build wasn't sure, and neutral never fires
        // this rule in either direction.
        const sameFacing = cand.facing && cand.facing !== 'neutral'
            && cand.facing === n.facing;
        if (sameFacing) s -= 3.2;
        else if (cand.facing === 'left' && n.facing === 'right') s += 1.0;
        else if (cand.facing === 'right' && n.facing === 'left') s += 1.0;

        // Shot size. Two tight close-ups stacked is repetitive even when the
        // subjects look opposite ways, so this stands on its own — and adds
        // to the facing penalty when both problems are present.
        const bothTight = (cand.tight || 0) >= TIGHT && (n.tight || 0) >= TIGHT;
        if (bothTight) s -= 2.2;

        score += s * weight;
    }

    // Break ties without a tie-breaking rule anyone could notice. Small
    // relative to the terms above, so it never overrides a real clash.
    return score + Math.random() * 0.6;
}

/**
 * Index the build's flat [cropA, cropB] pairs as `src -> Set(src)`, both ways.
 *
 * scoreCandidate above is a PREFERENCE — it makes a bad pairing expensive and
 * then takes the best of what is left, so a bad enough pool can still produce
 * one. This is the HARD constraint: a pair listed in
 * _data/shuffle_never_adjacent.yml is removed from the running before scoring
 * rather than penalised, because the things it catches are the ones the
 * numbers cannot see (two different films that both happen to show a man in a
 * cowboy hat with a guitar score as a pleasing contrast, and read as a
 * duplicate).
 */
export function indexNeverAdjacent(pairs) {
    const map = new Map();
    for (const pair of pairs || []) {
        if (!Array.isArray(pair) || pair.length !== 2) continue;
        const [a, b] = pair;
        if (!a || !b || a === b) continue;
        if (!map.has(a)) map.set(a, new Set());
        if (!map.has(b)) map.set(b, new Set());
        map.get(a).add(b);
        map.get(b).add(a);
    }
    return map;
}

/**
 * Pick one frame for a slot: hard constraint first, then the scorer.
 *
 * Exported so scripts/test_never_adjacent.js drives the REAL selection rather
 * than a re-implementation of it — the whole value of the guard is that this
 * exact function is what runs in the browser.
 *
 * `pool` is what the no-repeat rule left for this tile; `fullPool` is every
 * frame it has. The two rules can disagree, and when they do the ranking is
 * explicit:
 *
 *   never-adjacent  HARD    — a listed pairing must not render
 *   no-repeat       SOFT    — a preference for variety within a session
 *
 * So when the history has walked a tile down to nothing but frames a
 * neighbour bans, the HISTORY yields: the tile reshuffles early (reopening
 * frames the visitor has already seen this session) rather than shipping a
 * pairing that was explicitly forbidden. Without that the guard leaks exactly
 * when it matters most — measured at 0.22% of loads before this fallback
 * existed, against 1.03% with no guard at all.
 *
 * Returns { pick, forced, resetHistory }:
 *   forced        every frame the tile has is banned — a banned frame renders
 *                 anyway, because the constraint must not blank a tile. The
 *                 build prints each paired tile's pool size so this is visible
 *                 before it ships; with two healthy pools it cannot happen.
 *   resetHistory  the caller should clear this tile's no-repeat history, since
 *                 the pick came from the full pool rather than the unseen one.
 */
export function chooseFrame(pool, neighbours, banned, fullPool) {
    const blocked = new Set();
    if (banned && banned.size) {
        for (const { frame } of neighbours) {
            const enemies = banned.get(frame.src);
            if (enemies) for (const e of enemies) blocked.add(e);
        }
    }

    // Shuffle first so equal scores don't always resolve to the same frame.
    const best = (arr) => {
        const candidates = shuffle(arr.slice());
        let pick = candidates[0];
        let bestScore = -Infinity;
        for (const c of candidates) {
            const s = scoreCandidate(c, neighbours);
            if (s > bestScore) { bestScore = s; pick = c; }
        }
        return pick;
    };

    if (!blocked.size) return { pick: best(pool), forced: false, resetHistory: false };

    const allowed = pool.filter(c => !blocked.has(c.src));
    if (allowed.length) return { pick: best(allowed), forced: false, resetHistory: false };

    const wider = (fullPool || []).filter(c => !blocked.has(c.src));
    if (wider.length) return { pick: best(wider), forced: false, resetHistory: true };

    return { pick: best(pool), forced: true, resetHistory: false };
}

// Two tiles are in the same row / same column if their edges agree to within
// this many pixels. Grid tracks line up exactly; this is just float slop.
const ALIGN_TOLERANCE = 4;

/**
 * Grid neighbours for every tile, as [{ index, weight }] pointing at EARLIER
 * tiles only (the ones already decided when this slot is filled).
 *
 * Read off the laid-out geometry rather than counted from the CSS, because
 * the two grids don't agree — Narrative is pinned to 2 columns, Commercial
 * goes to 4 above 900px — and both collapse on a phone. Asking where the
 * boxes actually are answers "which tile is directly above this one" for any
 * column count, any breakpoint, and any ragged final row, with nothing here
 * to drift out of sync when the stylesheet changes.
 */
function gridNeighbours(anchors) {
    const out = anchors.map(() => []);

    // Group by list first: tiles in different grids are never neighbours,
    // even where the two grids happen to line up on screen.
    const byList = new Map();
    anchors.forEach((a, i) => {
        const ul = a.closest('ul') || a.parentElement;
        if (!byList.has(ul)) byList.set(ul, []);
        byList.get(ul).push(i);
    });

    const rect = (i) => {
        const el = anchors[i].closest('li') || anchors[i];
        const r = el.getBoundingClientRect();
        return { top: r.top + window.scrollY, left: r.left };
    };

    for (const indices of byList.values()) {
        const boxes = new Map(indices.map(i => [i, rect(i)]));

        indices.forEach((i, pos) => {
            const me = boxes.get(i);

            // Directly above: same column, nearest row that starts higher up.
            let above = -1;
            for (const j of indices) {
                if (j >= i) break;
                const other = boxes.get(j);
                if (Math.abs(other.left - me.left) > ALIGN_TOLERANCE) continue;
                if (me.top - other.top <= ALIGN_TOLERANCE) continue;
                if (above < 0 || other.top > boxes.get(above).top) above = j;
            }
            if (above >= 0) out[i].push({ index: above, weight: VERTICAL_WEIGHT });

            // Immediately left: the previous tile, only if it shares this row.
            const prev = indices[pos - 1];
            if (prev !== undefined
                && Math.abs(boxes.get(prev).top - me.top) <= ALIGN_TOLERANCE) {
                out[i].push({ index: prev, weight: HORIZONTAL_WEIGHT });
            }
        });
    }
    return out;
}

export async function initThumbShuffle() {
    const anchors = Array.from(
        document.querySelectorAll('.thumbnails.playbuttons a[data-rich]')
    ).filter(a => a.querySelector('img'));
    if (!anchors.length) return;

    const neighbourMap = gridNeighbours(anchors);

    const data = await fetchJSON(DATA_URL);
    if (!data || !data.tiles) return;

    const prev = readPrev();
    const chosen = [];   // parallel to `anchors`; holds the picked frame or null
    const nextPrev = {};
    const banned = indexNeverAdjacent(data.neverAdjacent);

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

        // Neighbours already decided this pass, each with its adjacency weight.
        const neighbours = [];
        for (const { index, weight } of neighbourMap[idx]) {
            const n = chosen[index];
            if (n) neighbours.push({ frame: n, weight });
        }

        // Hard never-adjacent constraint, then the scorer. See chooseFrame.
        // resetHistory means it had to reach past the no-repeat rule to keep a
        // banned pairing off the page — so this tile's history starts over.
        const { pick: best, resetHistory } = chooseFrame(
            pool, neighbours, banned, tile.frames);
        if (resetHistory) history = [];

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
