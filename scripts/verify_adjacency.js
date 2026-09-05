// Does the facing / close-up constraint actually change what lands next to what?
//
//   node scripts/verify_adjacency.js http://127.0.0.1:4002
//
// Measures how often two VERTICALLY ADJACENT tiles end up showing subjects
// facing the same way, or two tight close-ups stacked — the two things Alex
// flagged. The baseline is the same grid, the same tile pairs and the same
// pools, picked uniformly at random, so the only difference being measured is
// scoreCandidate() in js/thumb-shuffle.js.

const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:4002';
// Each load gets a FRESH context, so every tile's no-repeat history is empty
// and the scorer is choosing from the full pool. That isolates what the
// scoring does; inside one long session the no-repeat rule shrinks pools to
// one or two candidates and there is simply nothing left to choose between.
const LOADS = Number(process.env.LOADS || 90);
const TRIALS = 20000;
const TIGHT = 0.42;

// Vertical adjacency, measured off the laid-out grid exactly the way
// gridNeighbours() in js/thumb-shuffle.js measures it.
const GRID = () => {
    const anchors = [...document.querySelectorAll('.thumbnails.playbuttons a[data-rich]')]
        .filter(a => a.querySelector('img'));
    const info = anchors.map(a => {
        const li = a.closest('li') || a;
        const r = li.getBoundingClientRect();
        const img = a.querySelector('img');
        return {
            ul: [...document.querySelectorAll('ul')].indexOf(a.closest('ul')),
            top: Math.round(r.top + scrollY),
            left: Math.round(r.left),
            key: a.dataset.rich,
            src: new URL(img.currentSrc || img.src, location.href).pathname,
        };
    });
    const pairs = [];
    info.forEach((me, i) => {
        let above = -1;
        for (let j = 0; j < i; j++) {
            const o = info[j];
            if (o.ul !== me.ul || Math.abs(o.left - me.left) > 4) continue;
            if (me.top - o.top <= 4) continue;
            if (above < 0 || o.top > info[above].top) above = j;
        }
        if (above >= 0) pairs.push({
            aKey: info[above].key, bKey: me.key,
            aSrc: info[above].src, bSrc: me.src,
        });
    });
    return pairs;
};

const sameFacing = (a, b) => a.facing !== 'neutral' && a.facing === b.facing;
const bothTight = (a, b) => a.tight >= TIGHT && b.tight >= TIGHT;

(async () => {
    const data = await (await fetch(BASE + '/data/thumb-shuffle.json')).json();
    const bySrc = new Map();
    for (const t of Object.values(data.tiles))
        for (const f of t.frames) bySrc.set(f.src, f);

    const browser = await chromium.launch();

    let facingHits = 0, tightHits = 0, total = 0, topology = null;
    for (let i = 0; i < LOADS; i++) {
        const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const page = await ctx.newPage();
        await page.goto(BASE + '/', { waitUntil: 'networkidle' });
        await page.waitForTimeout(200);
        const pairs = await page.evaluate(GRID);
        await ctx.close();
        if (!topology) topology = pairs.map(p => [p.aKey, p.bKey]);
        for (const p of pairs) {
            const a = bySrc.get(p.aSrc), b = bySrc.get(p.bSrc);
            if (!a || !b) continue;
            total++;
            if (sameFacing(a, b)) facingHits++;
            if (bothTight(a, b)) tightHits++;
        }
    }
    await browser.close();

    // Baseline: the SAME vertically-adjacent tile pairs, each tile drawing
    // uniformly from its own pool. Anything left is the scoring's doing.
    let rF = 0, rT = 0, rN = 0;
    const pool = k => data.tiles[k].frames;
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    for (let i = 0; i < TRIALS; i++) {
        for (const [aKey, bKey] of topology) {
            if (!data.tiles[aKey] || !data.tiles[bKey]) continue;
            const a = pick(pool(aKey)), b = pick(pool(bKey));
            rN++;
            if (sameFacing(a, b)) rF++;
            if (bothTight(a, b)) rT++;
        }
    }

    const pct = (n, d) => (d ? (n / d * 100).toFixed(1) : '0.0') + '%';
    console.log(`vertical tile pairs in the grid: ${topology.length}`);
    console.log(`sampled on the real page: ${total} pairs over ${LOADS} loads`);
    console.log(`  same-facing stacked : ${pct(facingHits, total)}  `
        + `(random baseline ${pct(rF, rN)})`);
    console.log(`  both tight close-up : ${pct(tightHits, total)}  `
        + `(random baseline ${pct(rT, rN)})`);
})();
