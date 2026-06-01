// Site entry point. Conditionally initializes subsystems based on what's
// on the current page. ES module, deferred by default.

import { autoInitLightboxes } from './lightbox.js';
import { Carousel, shuffleCarouselImages } from './carousel.js';
// still-row.js is loaded dynamically below. Content blockers commonly
// match URL patterns like "instagram" or "pixel" — a static import of
// a blocked file would tear down this whole module graph (every
// subsystem would then silently fail). Dynamic import isolates the
// failure. visit-log.js (formerly pixel.js, renamed because 1Blocker
// blocks anything matching /pixel\.js/) is loaded dynamically by
// lightbox.js as well.
import {
    initSmoothScroll,
    initReturnToTop,
    initMobileNavCollapse,
    initCopyrightYear,
    initScrollFade,
    initStaggeredThumbs,
    initSliderScrollBlur,
    initSectionPassed,
    initStickyHeaderState,
    initReelButtonShift,
    initAlignWatchReelsBottom,
    initHorizontalScrollLock,
} from './scroll.js';

function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
}
// Instagram-WebView detection now lives as an inline script in _includes/head.html
// so the html.is-instagram-webview class is in place before CSS first applies.

// Wrap each subsystem so a failure in one doesn't take down the rest.
function safe(label, fn) {
    try { fn(); } catch (err) { console.error(`[site.js] ${label} failed:`, err); }
}

ready(() => {
    safe('horizontalScrollLock', () => initHorizontalScrollLock());
    safe('smoothScroll', () => initSmoothScroll());
    safe('mobileNavCollapse', () => initMobileNavCollapse());
    safe('copyrightYear', () => initCopyrightYear());
    safe('staggeredThumbs', () => initStaggeredThumbs());
    safe('scrollFade', () => initScrollFade());
    safe('stickyHeader', () => initStickyHeaderState());
    const hasSlider = !!document.getElementById('slider-container');
    const isCinematic = document.body.classList.contains('cinematic');
    // Reel-button shift runs anywhere there's a collapsible right-edge slot.
    if (hasSlider || isCinematic) {
        safe('reelButtonShift', () => initReelButtonShift());
    }
    if (isCinematic) {
        safe('alignWatchReelsBottom', () => initAlignWatchReelsBottom());
    }
    document.body.classList.add('loaded');

    const isHome = document.body.classList.contains('home');
    if (hasSlider) {
        const slider = document.getElementById('slider-container');
        safe('shuffleCarousel', () => shuffleCarouselImages(slider, '/img/slider/', 5));
        safe('carousel', () => new Carousel(slider, { interval: 5000 }));
        safe('sliderBlur', () => initSliderScrollBlur('#slider-container'));
        safe('sectionPassed', () => initSectionPassed('#cinematographer', 'past-cinematographer'));
    } else if (isCinematic && isHome) {
        // No hero, but the Watch Reels button still slides as you scroll —
        // gives it a second chance to catch the eye after the user's
        // engaged with the page. Threshold = roughly 60% of viewport.
        safe('cinematicPastToggle', () => {
            const update = () => {
                document.body.classList.toggle(
                    'past-cinematographer',
                    window.scrollY > window.innerHeight * 0.6
                );
            };
            window.addEventListener('scroll', update, { passive: true });
            window.addEventListener('resize', update, { passive: true });
            update();
        });
    } else {
        // Project / sub-pages — static post-scroll layout. The cinematic
        // header collapses to its compact dark state immediately rather
        // than waiting for a scroll trigger that may never fire.
        document.body.classList.add('past-cinematographer');
    }

    // Still-row populates async via dynamic import. Lightbox init
    // must run AFTER the new <a class="stills-image"> elements are
    // in the DOM, otherwise they don't get picked up into the gallery.
    // If the dynamic import is blocked, the .catch resolves the chain
    // so lightbox init still runs for any other lightbox triggers on
    // the page.
    const stillRowPromise = import('./still-row.js')
        .then(m => m.initInstagramStills())
        .catch(err => {
            console.error('[site.js] still-row failed (likely content blocker):', err);
        });
    stillRowPromise.then(() => {
        safe('lightboxes', () => autoInitLightboxes());
    });
    // Best-effort: if a content blocker eats visit-log.js, swallow
    // silently so the rest of the page is unaffected. Fires the page-
    // load pixel AND arms a delegated click listener on outbound links
    // so the admin Visitors page can show exit destinations.
    safe('visitPixel', () => {
        import('./visit-log.js')
            .then(m => {
                m.sendPagePixel();
                if (m.initOutboundLinkTracking) m.initOutboundLinkTracking();
            })
            .catch(() => { /* blocked — ignore */ });
    });

    // Return-to-top button is the glass-button on every page now (see js/glass-return-to-top.js)
});
