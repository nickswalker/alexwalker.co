#!/usr/bin/env node
// Bakes the 10 viewport×theme JPEGs that the WebGL glass button samples
// from. The selection logic lives in js/container.js (getSnapshotPath):
// width buckets → mobile / tablet / desktop, orientation suffix for the
// non-desktop buckets, and a light/dark variant per theme.
//
// Run this after any redesign change that materially shifts the page
// near where the return-to-top button hovers — otherwise the button
// samples a stale image of the previous design.
//
// Usage:
//   npm run bake-glass                              # local jekyll @ :4000
//   npm run bake-glass -- https://alexwalker.co     # live site
//   npm run bake-glass -- http://testing.alexwalker.co

const { chromium } = require("playwright");
const path = require("path");

const URL = process.argv[2] || "http://localhost:4000";
const OUT_DIR = path.resolve(__dirname, "..", "img");

// Width buckets must match getSnapshotPath() in js/container.js.
// Heights are representative — they only affect what slice of the
// page ends up in the JPEG.
const VIEWPORTS = [
    { name: "desktop", width: 1440, height: 900 },
    { name: "tablet", width: 820, height: 1180 },
    { name: "tablet-landscape", width: 1180, height: 820 },
    { name: "mobile", width: 390, height: 844 },
    { name: "mobile-landscape", width: 844, height: 390 },
];
const THEMES = ["light", "dark"];

async function capture(browser, vp, theme) {
    const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
        colorScheme: theme,
    });
    const page = await ctx.newPage();
    // Hide the return-to-top wrapper before any paint so it can't
    // photograph itself into its own snapshot.
    await page.addInitScript(() => {
        const s = document.createElement("style");
        s.textContent = "#glass-wrapper{display:none!important}";
        document.documentElement.appendChild(s);
    });
    // `load` resolves once main resources are loaded — more reliable
    // than `networkidle`, which can hang forever on pages that keep
    // connections open (analytics pixels, video embeds).
    await page.goto(URL, { waitUntil: "load", timeout: 30000 });
    // Jekyll's dev server injects a livereload script that occasionally
    // re-navigates the page right after load; let it settle before we
    // start evaluating, otherwise the next evaluate() blows up with
    // "Execution context was destroyed".
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(600);
    // Walk the page top-to-bottom in one-viewport steps so any
    // IntersectionObserver-based lazy loading triggers, then return
    // to top before capturing.
    await page.evaluate(async () => {
        const step = window.innerHeight;
        const max = document.body.scrollHeight;
        for (let y = 0; y <= max; y += step) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 120));
        }
        window.scrollTo(0, 0);
    });

    // Force every scroll-fade-controlled element fully visible AND
    // promote every lazy <img> to eager loading so the document
    // actually fetches them. Without this, items below the fold (and
    // the JS-populated IG row) leave a black void in the snapshot —
    // the return-to-top button would then sample blackness over the
    // stills / narrative sections. Bounded waits below.
    await page.evaluate(() => {
        document.querySelectorAll('.scroll-fade').forEach((el) => {
            el.classList.add('visible');
        });
        document.querySelectorAll('img[loading="lazy"]').forEach((img) => {
            img.loading = 'eager';
        });
    });

    // Wait (capped) for the IG row to populate. Previously this returned
    // true when the row was missing — which masked the failure mode where
    // Jekyll's server-side fallback hadn't rendered and JS hadn't yet
    // populated the row. Require actual <li> children so the snapshot
    // includes the stills band that the return-to-top button samples.
    let stillsOk = false;
    try {
        await page.waitForFunction(
            () => {
                const row = document.getElementById('instagram-stills');
                if (!row) return false;
                return row.querySelectorAll('li').length >= 8;
            },
            { timeout: 15000 }
        );
        stillsOk = true;
    } catch { /* fall through — log below */ }
    if (!stillsOk) {
        console.warn(`    ⚠ stills row never populated — snapshot will have a void where the button samples it`);
    }

    // Wait (capped) for all images to finish or fail.
    await page.evaluate(async () => {
        const imgs = Array.from(document.images);
        const settle = imgs.map(
            (img) =>
                img.complete
                    ? Promise.resolve()
                    : new Promise((res) => {
                        img.addEventListener('load', res, { once: true });
                        img.addEventListener('error', res, { once: true });
                    })
        );
        const timeout = new Promise((res) => setTimeout(res, 4000));
        await Promise.race([Promise.all(settle), timeout]);
    });
    await page.waitForTimeout(500);
    console.log(`    waited for content; capturing…`);
    const out = path.join(OUT_DIR, `glass-${vp.name}-${theme}.jpg`);
    // Full-page screenshot — the WebGL button shader uses scrollY to
    // shift its texture sample point, so the snapshot must cover the
    // entire document, not just the initial viewport.
    await page.screenshot({
        path: out,
        type: "jpeg",
        quality: 85,
        fullPage: true,
    });
    await ctx.close();
    console.log(
        `  ✓ ${path.basename(out)}  (${vp.width}×${vp.height}, ${theme})`
    );
}

(async () => {
    console.log(`Baking glass snapshots from ${URL}\n`);
    const browser = await chromium.launch();
    try {
        for (const vp of VIEWPORTS) {
            for (const t of THEMES) {
                await capture(browser, vp, t);
            }
        }
    } finally {
        await browser.close();
    }
    console.log(`\nDone. 10 files written to ${path.relative(process.cwd(), OUT_DIR)}/`);
})();
