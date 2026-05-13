// Site-wide scroll behaviors: smooth-scroll anchors, return-to-top fade,
// mobile nav collapse, scroll-fade IntersectionObserver, copyright year.

export function initSmoothScroll(selector = '.smooth-scroll') {
    document.addEventListener('click', (e) => {
        const a = e.target.closest(selector);
        if (!a) return;
        const hash = a.getAttribute('href');
        if (!hash || !hash.startsWith('#') || hash.length < 2) return;
        const target = document.querySelector(hash);
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}

// Show/hide return-to-top button by toggling .visible based on a scroll threshold.
// CSS handles the actual fade via opacity transitions.
export function initReturnToTop({
    selector = '#return-to-top',
    threshold = null,
    onShow = null,
    onHide = null,
} = {}) {
    const btn = document.querySelector(selector);
    if (!btn) return;
    let shown = false;
    const getThreshold = () => threshold ?? window.innerHeight;

    function update() {
        const should = window.scrollY >= getThreshold();
        if (should === shown) return;
        shown = should;
        btn.classList.toggle('visible', shown);
        if (shown && onShow) onShow();
        else if (!shown && onHide) onHide();
    }
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    update();
}

export function initMobileNavCollapse(breakpoint = 700) {
    function apply() {
        const isMobile = window.innerWidth <= breakpoint;
        document.querySelectorAll('header nav > ul > li').forEach(li => {
            if (!isMobile) {
                // Don't blow away an empty scroll-down's intentional display:none
                if (li.id === 'scroll-down-indicator' && li.children.length === 0) return;
                li.style.display = '';
                return;
            }
            const keep = li.classList.contains('logo')
                      || li.classList.contains('reel-button-menu')
                      // Scroll-down is only kept when it actually has content
                      // (homepage). Project pages render it empty + display:none.
                      || (li.id === 'scroll-down-indicator' && li.children.length > 0);
            li.style.display = keep ? '' : 'none';
        });
    }
    window.addEventListener('load', apply);
    window.addEventListener('resize', apply);
}

export function initCopyrightYear(selector = '#copyright-current-year') {
    const el = document.querySelector(selector);
    if (el) el.textContent = new Date().getFullYear().toString();
}

export function initScrollFade(selector = '.scroll-fade') {
    if (!('IntersectionObserver' in window)) {
        document.querySelectorAll(selector).forEach(el => el.classList.add('visible'));
        return;
    }
    // Elements that are already in the viewport when the observer attaches
    // get their .visible class staggered so the cascade is actually visible
    // — without the stagger, the JS+CSS sequence completes faster than the
    // browser's first paint and the user misses the fade entirely.
    // Below-the-fold elements get no stagger — they fade as they enter view.
    const INITIAL_STAGGER_MS = 90;
    let initialBatchSeen = 0;
    let initialBatchDone = false;
    // Anything firing after this timestamp counts as scroll-triggered.
    setTimeout(() => { initialBatchDone = true; }, 1500);

    const observer = new IntersectionObserver((entries, obs) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const el = entry.target;
            const itemDelay = parseInt(el.style.getPropertyValue('--delay')) || 0;
            const cascadeDelay = !initialBatchDone
                ? (initialBatchSeen++ * INITIAL_STAGGER_MS)
                : 0;
            const total = itemDelay + cascadeDelay;
            if (total > 0) {
                setTimeout(() => el.classList.add('visible'), total);
            } else {
                el.classList.add('visible');
            }
            obs.unobserve(el);
        }
    }, {
        threshold: 0,
        // Shrink the effective viewport up from the bottom so elements only
        // start fading in once they're solidly visible. -25% means the
        // element's top has to be 75% of viewport-height down before
        // triggering — keeps the 450ms fade comfortably in-view even on
        // mobile fast-flick scrolling where -12% had the fade completing
        // before the user perceived the element.
        rootMargin: '0px 0px -25% 0px',
    });
    document.querySelectorAll(selector).forEach(el => observer.observe(el));
}

// Staggered fade-in for thumbnail grids — small step so total cascade stays under ~0.5s
// for typical 4-12-item grids.
export function initStaggeredThumbs(selector = '.thumbnails.four-up li', step = 35) {
    document.querySelectorAll(selector).forEach((item, i) => {
        item.classList.add('scroll-fade', 'staggered');
        item.style.setProperty('--delay', `${i * step}ms`);
    });
}

// Toggle .is-stuck on the sticky header once it pins to the top of the viewport.
// Used by CSS to render a subtle box-shadow above the header that covers the
// sub-pixel gap *only when the header is actually stuck*, not while at rest.
export function initStickyHeaderState(selector = 'header') {
    const header = document.querySelector(selector);
    if (!header) return;
    function update() {
        // getBoundingClientRect().top <= 0 means the header is at or above the
        // viewport top — i.e. sticky is engaged.
        header.classList.toggle('is-stuck', header.getBoundingClientRect().top <= 0);
    }
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    update();
}

// Toggle a body class when the user has scrolled past a section's top.
// Used to fade the scroll-down indicator after the cinematographer section appears.
export function initSectionPassed(sectionSelector, bodyClass) {
    const section = document.querySelector(sectionSelector);
    if (!section) return;
    function update() {
        const rect = section.getBoundingClientRect();
        // Toggle when the section's top edge is at or above viewport top.
        // Stays active until the user scrolls UP past the section's top —
        // not at an arbitrary 80px buffer below it.
        document.body.classList.toggle(bodyClass, rect.top <= 0);
    }
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    update();
}

// On tablet/desktop, when body.past-cinematographer fires, compute exactly how
// far the Watch Reels button needs to translate so its right edge mirrors the
// Alex Walker logo's left inset (the header container's right padding).
// Other nav items keep their natural space-between distribution.
export function initReelButtonShift() {
    const reel = document.querySelector('.reel-button-menu');
    if (!reel) return;
    const container = reel.closest('.container');
    if (!container) return;
    // The reel button's final right edge should align with the section
    // content's right edge (where thumbnails/posters end). Sections use
    // padding-right: 24px at >=700px viewports.
    const SECTION_GUTTER = 24;
    // With 7 flex items + space-between, when the scroll-down indicator
    // (44px) collapses to 0, the reel (item 6 of 7) shifts right by 5/6 of
    // the freed width — i.e. 36.67px. Captured as a constant so the
    // projection doesn't depend on mid-flight gBCR readings.
    const NATURAL_SHIFT = (5 / 6) * 44;
    let lastShift = 0;
    // Pre-collapse natural reel.right captured when past-cinematographer is
    // NOT set. Refresh-while-scrolled was failing because gBCR returned
    // inconsistent scroll-down/reel positions at the moment the class was
    // first added, leading to wildly wrong projections. Stable baseline
    // sidesteps the issue.
    let preCollapseReelRight = null;
    // Whether the scroll-down indicator participates in the flex layout. On
    // index.html it does (width: 44px) and will collapse to 0 when past-
    // cinematographer fires, contributing NATURAL_SHIFT to the reel's drift.
    // On project pages the partial sets it to display:none, so it contributes
    // no natural shift — without this flag the reel would end up 36.67px
    // further right than its homepage counterpart.
    let arrowInLayout = false;

    function captureBaseline() {
        if (window.matchMedia('(max-width: 700px)').matches) return;
        if (document.body.classList.contains('past-cinematographer')) return;
        if (reel.style.transform) reel.style.transform = '';
        preCollapseReelRight = reel.getBoundingClientRect().right;
        const sd = document.getElementById('scroll-down-indicator');
        arrowInLayout = !!(sd && getComputedStyle(sd).display !== 'none');
    }

    function applyShift() {
        if (window.matchMedia('(max-width: 700px)').matches) {
            if (lastShift !== 0) { lastShift = 0; reel.style.transform = ''; }
            return;
        }
        if (!document.body.classList.contains('past-cinematographer')) {
            if (lastShift !== 0) { lastShift = 0; reel.style.transform = ''; }
            return;
        }
        // Derive the post-collapse natural reel position from the captured
        // pre-collapse baseline. Add the NATURAL_SHIFT only if the arrow is
        // actually in the flex layout (homepage). On project pages the arrow
        // is display:none, so the reel doesn't redistribute at all — its
        // natural post-state equals its pre-state.
        let postCollapseReelRight;
        if (preCollapseReelRight !== null) {
            postCollapseReelRight = preCollapseReelRight + (arrowInLayout ? NATURAL_SHIFT : 0);
        } else {
            postCollapseReelRight = reel.getBoundingClientRect().right - lastShift;
        }
        const containerRect = container.getBoundingClientRect();
        const targetRight = containerRect.right - SECTION_GUTTER;
        // Allow negative shifts so project pages (where the reel naturally
        // sits AT content-right) can move LEFT to match the homepage's
        // content-right - 24 final position.
        const newShift = targetRight - postCollapseReelRight;
        if (Math.abs(newShift - lastShift) < 0.5) return;
        lastShift = newShift;
        reel.style.transform = Math.abs(newShift) > 0.5 ? `translateX(${newShift}px)` : '';
    }

    let reverseTimeout = null;
    function onPastChange(nowPast) {
        clearTimeout(reverseTimeout);
        if (!nowPast) {
            // Reverse direction: delay so the scroll-down indicator has time
            // to start visibly reappearing before the reel slides back.
            reverseTimeout = setTimeout(() => {
                if (!document.body.classList.contains('past-cinematographer')) {
                    lastShift = 0;
                    reel.style.transform = '';
                    // DO NOT captureBaseline here — the CSS transform
                    // transition is still animating back to none, so gBCR
                    // would return a mid-animation value and poison the
                    // baseline for the next forward cycle.
                }
            }, 100);
            return;
        }
        applyShift();
    }

    // Capture the baseline NOW — initSectionPassed runs later in site.js,
    // so at this moment past-cinematographer is guaranteed not yet set and
    // no transition is in flight.
    captureBaseline();
    // Also recapture after window.load (fonts/images can shift the reel's
    // natural position once they're decoded). Same safety: past-cinematographer
    // is either still false, or already long since stabilized.
    window.addEventListener('load', () => {
        captureBaseline();
        applyShift();
    });
    // Initial state — if the page loads already past cinematographer
    // (refresh while scrolled), apply the shift from the captured baseline.
    requestAnimationFrame(() => {
        if (document.body.classList.contains('past-cinematographer')) applyShift();
    });
    // On resize, recapture so the projection stays correct at the new width.
    // - Pristine state (not past, no transform): straightforward captureBaseline.
    // - Past-cinematographer: the captured pre-collapse baseline is now stale
    //   because the viewport changed. Strip the inline transform briefly to
    //   read the POST-collapse natural position at the new width, then derive
    //   the pre-collapse baseline by subtracting NATURAL_SHIFT (only if the
    //   scroll-down arrow is in flex layout — homepage; on project pages it's
    //   display:none and contributes no natural shift).
    window.addEventListener('resize', () => {
        const isPast = document.body.classList.contains('past-cinematographer');
        if (!isPast && !reel.style.transform) {
            captureBaseline();
        } else if (isPast && !window.matchMedia('(max-width: 700px)').matches) {
            const prevTransform = reel.style.transform;
            reel.style.transform = '';
            // Force a synchronous layout read so we measure the untransformed
            // position. Reading offsetLeft is the cheap canonical way.
            void reel.offsetLeft;
            const sd = document.getElementById('scroll-down-indicator');
            arrowInLayout = !!(sd && getComputedStyle(sd).display !== 'none');
            const postCollapseRight = reel.getBoundingClientRect().right;
            preCollapseReelRight = postCollapseRight - (arrowInLayout ? NATURAL_SHIFT : 0);
            reel.style.transform = prevTransform;
        }
        applyShift();
    }, { passive: true });

    let prevPast = document.body.classList.contains('past-cinematographer');
    new MutationObserver(() => {
        const nowPast = document.body.classList.contains('past-cinematographer');
        if (nowPast !== prevPast) {
            prevPast = nowPast;
            onPastChange(nowPast);
        }
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
}

// Slider blur+opacity tied to scroll position (index.html hero only).
// rAF-throttled so we never paint more than once per frame.
export function initSliderScrollBlur(selector = '#slider-container') {
    const el = document.querySelector(selector);
    if (!el) return;
    el.style.willChange = 'filter, opacity';
    // Reference height for the scroll ratio. Use the slider's OWN rendered
    // height (which is `100svh - 54px`, a stable small-viewport value) instead
    // of window.innerHeight. On iOS Safari portrait, innerHeight grows as the
    // URL bar collapses during scroll, which would otherwise re-divide
    // scrollY by a moving denominator and make the slider's blur/opacity
    // jump visibly mid-scroll. Recompute only on orientation/load — not on
    // every URL-bar collapse resize event.
    let wHeight = el.getBoundingClientRect().height || window.innerHeight;
    function refresh() { wHeight = el.getBoundingClientRect().height || window.innerHeight; }
    window.addEventListener('orientationchange', refresh);
    window.addEventListener('load', refresh);
    let scheduled = false;
    function apply() {
        scheduled = false;
        // While a lightbox has the body locked, window.scrollY reads as 0 and we'd
        // wipe the blur from the still-visible hero. Skip until the lightbox is closed.
        if (document.documentElement.classList.contains('lightbox-open')) return;
        const pct = window.scrollY / wHeight;
        if (pct > 1.05) return;
        const blur = Math.max((pct - 0.3) * 25, 0);
        const opacity = Math.max(1.0 - (pct - 0.3), 0);
        el.style.opacity = opacity;
        el.style.filter = `blur(${blur.toFixed(2)}px)`;
    }
    window.addEventListener('scroll', () => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(apply);
    }, { passive: true });
    apply();
}
