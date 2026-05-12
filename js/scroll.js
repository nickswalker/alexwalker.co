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
    const observer = new IntersectionObserver((entries, obs) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const el = entry.target;
            const itemDelay = parseInt(el.style.getPropertyValue('--delay')) || 0;
            if (itemDelay > 0) {
                setTimeout(() => el.classList.add('visible'), itemDelay);
            } else {
                el.classList.add('visible');
            }
            obs.unobserve(el);
        }
    }, { threshold: 0.05 });
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
        document.body.classList.toggle(bodyClass, rect.top <= 80);
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
    const scrollDown = document.getElementById('scroll-down-indicator');
    // Scroll-down indicator's natural width (CSS-defined). The reel slides
    // over to land at the arrow's former LEFT edge — i.e., where the arrow
    // visually started — not at the container's content-right edge.
    const ARROW_WIDTH = 44;

    function applyShift() {
        if (window.matchMedia('(max-width: 700px)').matches) {
            reel.style.transform = '';
            return;
        }
        if (!document.body.classList.contains('past-cinematographer')) {
            reel.style.transform = '';
            return;
        }
        reel.style.transform = '';
        const reelRect = reel.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const paddingRight = parseFloat(getComputedStyle(container).paddingRight) || 0;
        // Project where the reel will naturally settle once the scroll-down
        // indicator finishes collapsing. With 7 flex items and space-between,
        // the reel (item 6 of 7) sits 5 gaps from the left — so when the
        // arrow's remaining width is redistributed across 6 gaps, the reel
        // naturally shifts right by 5/6 of that remaining width.
        // Using the indicator's CURRENT width (which may be mid-transition or
        // fully collapsed) keeps the math correct in every state.
        const currentArrowWidth = scrollDown ? scrollDown.getBoundingClientRect().width : 0;
        const naturalShiftRemaining = currentArrowWidth * 5 / 6;
        const projectedRight = reelRect.right + naturalShiftRemaining;
        const targetRight = containerRect.right - paddingRight - ARROW_WIDTH;
        const shift = Math.max(0, targetRight - projectedRight);
        if (shift > 0) reel.style.transform = `translateX(${shift}px)`;
    }

    function onPastChange(nowPast) {
        if (!nowPast) {
            reel.style.transform = '';
            return;
        }
        // Apply immediately so the reel's transform transition runs in
        // PARALLEL with the scroll-down indicator's collapse — not after it.
        // The projection inside applyShift accounts for the natural
        // redistribution that's about to happen.
        applyShift();
    }

    // Initial state — if page loads already past cinematographer.
    requestAnimationFrame(() => {
        if (document.body.classList.contains('past-cinematographer')) applyShift();
    });
    window.addEventListener('resize', applyShift, { passive: true });

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
    let wHeight = window.innerHeight;
    let scheduled = false;
    window.addEventListener('resize', () => { wHeight = window.innerHeight; }, { passive: true });
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
