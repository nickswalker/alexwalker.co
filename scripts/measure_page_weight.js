// Measure real homepage transfer weight, before (4001) vs after (4002).
//
// Loads each URL, waits for the network to settle, then scrolls the whole
// page so every lazy image is actually fetched — a lazy-loading change that
// only defers bytes shouldn't be allowed to look like a saving.
//
//   node scripts/measure_page_weight.js http://127.0.0.1:4001 http://127.0.0.1:4002

const { chromium } = require('playwright');

async function measure(url, label) {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    const byType = {};
    let total = 0;
    const seen = [];

    page.on('response', async (res) => {
        try {
            const buf = await res.body().catch(() => null);
            const n = buf ? buf.length : 0;
            const u = new URL(res.url()).pathname;
            const kind = /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(u) ? 'image'
                : /\.js$/i.test(u) ? 'js'
                : /\.css$/i.test(u) ? 'css'
                : /\.(woff2?|ttf|otf)$/i.test(u) ? 'font'
                : /\.json$/i.test(u) ? 'json' : 'other';
            byType[kind] = (byType[kind] || 0) + n;
            total += n;
            seen.push([kind, u, n]);
        } catch { /* ignore */ }
    });

    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    // Force every lazy image to load, then settle again.
    await page.evaluate(async () => {
        const step = window.innerHeight * 0.8;
        for (let y = 0; y < document.body.scrollHeight; y += step) {
            window.scrollTo(0, y);
            await new Promise(r => setTimeout(r, 120));
        }
        window.scrollTo(0, 0);
    });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);

    // What the tiles ended up showing.
    const tiles = await page.$$eval('.thumbnails.playbuttons a[data-rich] img',
        els => els.map(e => [e.closest('a').dataset.rich, new URL(e.currentSrc || e.src).pathname, e.alt]));

    await browser.close();
    return { label, url, total, byType, tiles, seen };
}

(async () => {
    const urls = process.argv.slice(2);
    const results = [];
    for (const u of urls) results.push(await measure(u, u));

    for (const r of results) {
        console.log(`\n=== ${r.url}`);
        console.log(`  TOTAL ${r.total.toLocaleString()} bytes`);
        for (const [k, v] of Object.entries(r.byType).sort((a, b) => b[1] - a[1])) {
            console.log(`    ${k.padEnd(6)} ${v.toLocaleString()}`);
        }
        const shuffled = r.tiles.filter(t => t[1].startsWith('/img/shuffle/'));
        console.log(`  tiles: ${r.tiles.length}, shuffled: ${shuffled.length}`);
    }
    if (results.length === 2) {
        const d = results[1].total - results[0].total;
        const di = (results[1].byType.image || 0) - (results[0].byType.image || 0);
        console.log(`\nDELTA total: ${d >= 0 ? '+' : ''}${d.toLocaleString()} bytes`);
        console.log(`DELTA image: ${di >= 0 ? '+' : ''}${di.toLocaleString()} bytes`);
    }
    require('fs').writeFileSync('/tmp/page_weight.json', JSON.stringify(results, null, 1));
})();
