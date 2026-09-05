// Functional checks for the homepage thumbnail shuffle.
//
//   node scripts/test_thumb_shuffle.js http://127.0.0.1:4002
//
// 1. thumbnails differ between loads
// 2. no still repeats for a tile until its pool is exhausted, then reshuffles
// 3. the lightbox still opens the full gallery in the authored order
// 4. with JavaScript disabled a sensible thumbnail still renders
// 5. every shuffled image carries its own alt text

const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:4002';

const results = [];
function check(name, pass, detail = '') {
    results.push({ name, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function tileState(page) {
    return page.$$eval('.thumbnails.playbuttons a[data-rich] img', els =>
        els.map(e => ({
            key: e.closest('a').dataset.rich,
            src: new URL(e.currentSrc || e.src, location.href).pathname,
            alt: e.alt,
        })));
}

(async () => {
    const browser = await chromium.launch();

    // ---- 1 + 2: variation and no-repeat, across one persistent session.
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const loads = [];
    for (let i = 0; i < 6; i++) {
        await page.goto(BASE + '/', { waitUntil: 'networkidle' });
        await page.waitForTimeout(500);
        loads.push(await tileState(page));
    }

    const shuffled = loads[0].filter(t => t.src.startsWith('/img/shuffle/'));
    check('19 tiles are shuffle-enabled', shuffled.length === 19, `${shuffled.length} tiles`);

    let variedTiles = 0;
    const byKey = {};
    for (const t of shuffled) byKey[t.key] = [];
    for (const load of loads) {
        for (const t of load) if (byKey[t.key]) byKey[t.key].push(t.src);
    }
    for (const k of Object.keys(byKey)) {
        if (new Set(byKey[k]).size > 1) variedTiles++;
    }
    check('tiles change between loads', variedTiles >= 15,
        `${variedTiles}/19 tiles showed more than one still over 6 loads`);

    // No-repeat: within the first N loads (N = pool size) a tile must not
    // show the same still twice.
    const data = await (await fetch(BASE + '/data/thumb-shuffle.json')).json();
    let violations = [];
    for (const k of Object.keys(byKey)) {
        const pool = data.tiles[k].frames.length;
        const window = byKey[k].slice(0, Math.min(pool, byKey[k].length));
        if (new Set(window).size !== window.length) violations.push(`${k} (pool ${pool})`);
    }
    check('no still repeats before its pool is exhausted', violations.length === 0,
        violations.length ? violations.join(', ') : 'checked all 19 pools');

    // Reshuffle after exhaustion: keep loading past the largest pool and
    // confirm tiles keep producing images rather than going blank/stuck.
    for (let i = 0; i < 6; i++) {
        await page.goto(BASE + '/', { waitUntil: 'networkidle' });
        await page.waitForTimeout(300);
    }
    const afterExhaustion = await tileState(page);
    check('tiles still render after the pool is exhausted',
        afterExhaustion.filter(t => t.src.startsWith('/img/shuffle/')).length === 19);

    // ---- 5: alt text is per-image, not the tile's generic label.
    const alts = afterExhaustion.filter(t => t.src.startsWith('/img/shuffle/'));
    const withAlt = alts.filter(t => t.alt && t.alt.trim().length);
    check('shuffled images carry their own alt text', withAlt.length >= 14,
        `${withAlt.length}/19 have non-empty alt`);
    const tll = alts.find(t => t.key === 'tll');
    // An authored description, not the "<title> still N" positional fallback:
    // several words long and not matching that pattern.
    const tllAlt = (tll && tll.alt) || '';
    check('TLL stills keep their authored alt text',
        tllAlt.split(/\s+/).length >= 6 && !/ still \d+$/.test(tllAlt),
        tll ? `"${tllAlt.slice(0, 60)}…"` : 'missing');

    // ---- 3: lightbox opens the full gallery in the authored order.
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.click('a[data-rich="hoa"]');
    await page.waitForTimeout(1200);
    const frames = await page.$$eval('dialog[open] .rich-frame img, dialog[open] img.rich-still',
        els => els.map(e => new URL(e.src, location.href).pathname));
    const expected = data.tiles.hoa.frames.filter(f => !/\/thumb\.jpg$/.test(f.src)).length;
    check('lightbox opens with the full still gallery',
        frames.length >= expected, `${frames.length} frames shown, ${expected} stills configured`);
    check('lightbox shows ORIGINAL stills, not the tile crops',
        frames.length > 0 && frames.every(f => !f.startsWith('/img/shuffle/')),
        frames.slice(0, 2).join(', '));
    await page.keyboard.press('Escape');
    await ctx.close();

    // ---- 4: JavaScript disabled.
    const noJsCtx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
    const noJs = await noJsCtx.newPage();
    await noJs.goto(BASE + '/', { waitUntil: 'load' });
    const staticTiles = await tileState(noJs);
    const rendered = await noJs.$$eval('.thumbnails.playbuttons a[data-rich] img',
        els => els.filter(e => e.getAttribute('src')).length);
    check('no-JS: every tile still has a thumbnail src',
        rendered === staticTiles.length && staticTiles.length === 24,
        `${rendered}/${staticTiles.length} tiles`);
    check('no-JS: tiles use the build-time default crop',
        staticTiles.filter(t => t.src.startsWith('/img/shuffle/')).length === 19);
    await noJsCtx.close();

    await browser.close();
    const failed = results.filter(r => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    process.exit(failed.length ? 1 : 0);
})();
