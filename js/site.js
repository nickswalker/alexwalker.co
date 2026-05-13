// Site entry point. Conditionally initializes subsystems based on what's
// on the current page. ES module, deferred by default.

import { autoInitLightboxes } from './lightbox.js';
import { Carousel, shuffleCarouselImages } from './carousel.js';
import { sendPagePixel } from './pixel.js';
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
    safe('smoothScroll', () => initSmoothScroll());
    safe('mobileNavCollapse', () => initMobileNavCollapse());
    safe('copyrightYear', () => initCopyrightYear());
    safe('staggeredThumbs', () => initStaggeredThumbs());
    safe('scrollFade', () => initScrollFade());
    safe('stickyHeader', () => initStickyHeaderState());
    safe('reelButtonShift', () => initReelButtonShift());
    document.body.classList.add('loaded');

    const slider = document.getElementById('slider-container');
    if (slider) {
        safe('shuffleCarousel', () => shuffleCarouselImages(slider, '/img/slider/', 5));
        safe('carousel', () => new Carousel(slider, { interval: 5000 }));
        safe('sliderBlur', () => initSliderScrollBlur('#slider-container'));
        safe('sectionPassed', () => initSectionPassed('#cinematographer', 'past-cinematographer'));
    } else {
        // Project / sub-pages don't have the homepage hero or the
        // cinematographer section. Lock the reel-button in its
        // post-cinematographer position so the menu bar matches what the
        // user sees on the homepage after scrolling past that section.
        document.body.classList.add('past-cinematographer');
    }

    safe('lightboxes', () => autoInitLightboxes());
    safe('visitPixel', () => sendPagePixel());

    // Return-to-top button is the glass-button on every page now (see js/glass-return-to-top.js)
});
