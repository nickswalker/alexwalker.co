// Does the never-adjacent guard actually stop the banned pairings?
//
//   node scripts/test_never_adjacent.js
//
// No browser and no server: this drives the REAL selection function out of
// js/thumb-shuffle.js (chooseFrame + indexNeverAdjacent, loaded from the file
// verbatim) over the REAL build output in data/thumb-shuffle.json, with the
// REAL tile order read out of index.html. The only thing reconstructed here is
// the grid geometry, which in the browser comes from getBoundingClientRect and
// here comes from a column count — the two agree because the grids are plain
// CSS grid with a fixed number of equal tracks.
//
// Both layouts are exercised, because "adjacent" means different things in
// each and the pairing Alex reported only stacks on a phone:
//
//   desktop  narrative 2 columns, commercial 4
//   phone    both 1 column (the narrative grid collapses at <=600px portrait)
//
// Every pair in _data/shuffle_never_adjacent.yml is checked, with the guard
// ON and OFF over the same number of loads, so the OFF column shows the
// pairing was reachable in the first place and the ON column shows it is gone.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOADS = Number(process.env.LOADS || 4000);
// Loads per simulated visitor. Long enough to exhaust the biggest pool (9)
// and wrap, which is what walks each tile off its favourite frame and makes
// the awkward combinations reachable at all.
const SESSION_LOADS = Number(process.env.SESSION_LOADS || 12);

// Load js/thumb-shuffle.js as a real ES module without touching package.json
// (the repo's other node scripts are CommonJS). The source runs verbatim —
// that is the whole point: a re-implementation here would test nothing.
async function loadShuffleModule() {
    const src = fs.readFileSync(path.join(ROOT, 'js', 'thumb-shuffle.js'), 'utf8');
    return import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
}

/** Tile keys per grid, in DOM order, straight out of index.html. */
function tileOrder() {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const lists = [];
    const ulRe = /<ul class="[^"]*\bthumbnails\b[^"]*\bplaybuttons\b[^"]*"[^>]*>([\s\S]*?)<\/ul>/g;
    // The narrative UL lists the classes in the other order, so match on the
    // pair of class names rather than on one exact string.
    const anyUl = /<ul class="([^"]*)"[^>]*>([\s\S]*?)<\/ul>/g;
    let m;
    while ((m = anyUl.exec(html))) {
        const cls = m[1];
        if (!/\bthumbnails\b/.test(cls) || !/\bplaybuttons\b/.test(cls)) continue;
        const keys = [...m[2].matchAll(/data-rich="(\w+)"/g)].map(x => x[1]);
        if (keys.length) lists.push({ cls, keys });
    }
    void ulRe;
    return lists;
}

/**
 * gridNeighbours() for a fixed column count — same rule as the browser:
 * the tile directly above (weight 1.6) and the tile immediately left when it
 * shares the row (weight 1.0), both pointing at EARLIER tiles only.
 */
function neighboursFor(n, cols) {
    const out = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i++) {
        if (i - cols >= 0) out[i].push({ index: i - cols, weight: 1.6 });
        if (i % cols !== 0) out[i].push({ index: i - 1, weight: 1.0 });
    }
    return out;
}

/**
 * One page load: fill every slot in DOM order, exactly as initThumbShuffle
 * does — INCLUDING the localStorage no-repeat history, which `prev` stands in
 * for and which the caller carries across loads.
 *
 * Modelling the history is not optional. Without it every load starts from a
 * full pool, the scorer returns its single favourite frame for each tile, and
 * the run degenerates to the same handful of combinations — the banned
 * pairing then never appears even with the guard OFF, and the test proves
 * nothing. The no-repeat rule is what walks a tile through the rest of its
 * pool over a session, and that is when two stills that are individually
 * second-best end up side by side.
 */
function simulateLoad(keys, nbrs, data, banned, chooseFrame, prev) {
    const chosen = new Array(keys.length).fill(null);
    let forcedCount = 0;
    keys.forEach((key, idx) => {
        const tile = data.tiles[key];
        if (!tile || !Array.isArray(tile.frames) || tile.frames.length < 2) return;

        const seen = new Set(prev[key] || []);
        let pool = tile.frames.filter(f => !seen.has(f.src));
        let history = (prev[key] || []).slice();
        if (!pool.length) { pool = tile.frames.slice(); history = []; }

        const neighbours = [];
        for (const { index, weight } of nbrs[idx]) {
            const n = chosen[index];
            if (n) neighbours.push({ frame: n, weight });
        }
        const { pick, forced, resetHistory } = chooseFrame(
            pool, neighbours, banned, tile.frames);
        if (forced) forcedCount++;
        if (resetHistory) history = [];
        chosen[idx] = pick;
        history.push(pick.src);
        prev[key] = history.slice(-32);
    });
    return { chosen, forcedCount };
}

/** Every adjacent {a,b} src pair actually rendered by this load. */
function adjacentPairs(chosen, nbrs) {
    const pairs = [];
    chosen.forEach((me, i) => {
        if (!me) return;
        for (const { index } of nbrs[i]) {
            const other = chosen[index];
            if (other) pairs.push([other.src, me.src]);
        }
    });
    return pairs;
}

(async () => {
    const { chooseFrame, indexNeverAdjacent } = await loadShuffleModule();
    const data = JSON.parse(
        fs.readFileSync(path.join(ROOT, 'data', 'thumb-shuffle.json'), 'utf8'));

    const banned = indexNeverAdjacent(data.neverAdjacent);
    const empty = indexNeverAdjacent([]);
    const rules = (data.neverAdjacent || []).map(([a, b]) => ({ a, b }));

    console.log(`never-adjacent rules in data/thumb-shuffle.json: ${rules.length}`);
    for (const r of rules) console.log(`  · ${r.a}  <->  ${r.b}`);
    if (!rules.length) { console.log('nothing to verify'); process.exit(1); }

    const lists = tileOrder();
    const layouts = [
        { name: 'desktop', cols: c => (/narrative-cinema/.test(c) ? 2 : 4) },
        { name: 'phone  ', cols: () => 1 },
    ];

    let failures = 0;
    for (const layout of layouts) {
        for (const guard of [false, true]) {
            const map = guard ? banned : empty;
            const hits = new Map(rules.map((r, i) => [i, 0]));
            let totalAdj = 0, forced = 0;

            // Sessions of SESSION_LOADS consecutive loads sharing one history,
            // the way a returning visitor's localStorage does; a fresh session
            // starts with an empty history the way a new visitor does.
            for (let s = 0; s < Math.ceil(LOADS / SESSION_LOADS); s++) {
                const prev = {};
                for (let load = 0; load < SESSION_LOADS; load++) {
                    for (const { cls, keys } of lists) {
                        const nbrs = neighboursFor(keys.length, layout.cols(cls));
                        const r = simulateLoad(keys, nbrs, data, map, chooseFrame, prev);
                        forced += r.forcedCount;
                        for (const [x, y] of adjacentPairs(r.chosen, nbrs)) {
                            totalAdj++;
                            rules.forEach((rule, i) => {
                                if ((x === rule.a && y === rule.b) || (x === rule.b && y === rule.a))
                                    hits.set(i, hits.get(i) + 1);
                            });
                        }
                    }
                }
            }

            const tag = `${layout.name}  guard ${guard ? 'ON ' : 'OFF'}`;
            for (const [i, n] of hits) {
                const rate = (n / LOADS * 100).toFixed(2);
                const bad = guard && n > 0;
                if (bad) failures++;
                console.log(`${bad ? 'FAIL' : 'ok  '}  ${tag}  rule ${i}: `
                    + `${n} occurrence(s) in ${LOADS} loads (${rate}% of loads)`);
            }
            if (guard && forced) {
                console.log(`      note: ${forced} slot(s) had every candidate `
                    + `banned and fell back — see chooseFrame`);
            }
        }
    }

    console.log(`\n${failures ? 'FAILED' : 'PASSED'} — `
        + `${failures} rule/layout combination(s) still produced a banned pairing`);
    process.exit(failures ? 1 : 0);
})();
