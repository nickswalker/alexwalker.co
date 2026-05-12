// Glass-style return-to-top button. Looks for a #glass-wrapper element on the
// page; if present, instantiates a circular WebGL glass button inside it that
// fades in once the user has scrolled past one viewport height, and smooth-scrolls
// to the top when clicked.
//
// Depends on the global `Button` and `Container` classes (js/button.js,
// js/container.js) and pre-baked snapshot images at /img/glass-*-{light,dark}.jpg.

(function () {
    'use strict';

    window.glassControls = window.glassControls || {
        edgeIntensity: 0.000,
        rimIntensity: 0.043,
        baseIntensity: 0.000,
        edgeDistance: 0.410,
        rimDistance: 0.250,
        baseDistance: 0.160,
        cornerBoost: 0.078,
        rippleEffect: 0.100,
        blurRadius: 15.000,
        tintOpacity: 0.630
    };

    let returnToTopButton = null;
    let glassBuilt = false;
    let glassRefreshQueued = false;

    function applyGlassSettingsToInstance(instance) {
        if (!instance || !instance.gl_refs || !instance.gl_refs.gl) return;
        const gl = instance.gl_refs.gl;
        const refs = instance.gl_refs;
        const controls = window.glassControls;
        if (refs.edgeIntensityLoc) gl.uniform1f(refs.edgeIntensityLoc, controls.edgeIntensity);
        if (refs.rimIntensityLoc) gl.uniform1f(refs.rimIntensityLoc, controls.rimIntensity);
        if (refs.baseIntensityLoc) gl.uniform1f(refs.baseIntensityLoc, controls.baseIntensity);
        if (refs.edgeDistanceLoc) gl.uniform1f(refs.edgeDistanceLoc, controls.edgeDistance);
        if (refs.rimDistanceLoc) gl.uniform1f(refs.rimDistanceLoc, controls.rimDistance);
        if (refs.baseDistanceLoc) gl.uniform1f(refs.baseDistanceLoc, controls.baseDistance);
        if (refs.cornerBoostLoc) gl.uniform1f(refs.cornerBoostLoc, controls.cornerBoost);
        if (refs.rippleEffectLoc) gl.uniform1f(refs.rippleEffectLoc, controls.rippleEffect);
        if (refs.blurRadiusLoc) gl.uniform1f(refs.blurRadiusLoc, controls.blurRadius);
        if (refs.tintOpacityLoc) gl.uniform1f(refs.tintOpacityLoc, controls.tintOpacity);
        if (typeof instance.render === 'function') instance.render();
    }

    function refreshReturnToTopGlass() {
        if (!returnToTopButton || !glassBuilt) return;
        if (glassRefreshQueued) return;
        glassRefreshQueued = true;
        requestAnimationFrame(() => {
            glassRefreshQueued = false;
            if (typeof returnToTopButton.updateSizeFromDOM === 'function') {
                returnToTopButton.updateSizeFromDOM();
            }
            applyGlassSettingsToInstance(returnToTopButton);
            if (typeof returnToTopButton.render === 'function') {
                returnToTopButton.render();
            }
        });
    }

    function buildReturnToTopButton() {
        const wrapper = document.getElementById('glass-wrapper');
        if (!wrapper || glassBuilt) return;
        if (typeof Button === 'undefined') return; // container.js / button.js not loaded yet

        wrapper.innerHTML = '';

        const isMobile = window.matchMedia('(max-width: 480px)').matches;
        const scrollToTop = () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        };
        const button = new Button({
            text: '↑',
            size: isMobile ? 26 : 28,
            type: 'circle',
            tintOpacity: 0.630,
            warp: false,
            onClick: scrollToTop,
        });
        button.element.id = 'return-to-top';
        button.element.classList.add('smooth-scroll');
        wrapper.appendChild(button.element);

        // iOS-specific quirk: while the page has momentum-scroll inertia, the
        // first finger contact gets consumed as "stop the scroll" instead of
        // a tap — touchend doesn't reliably fire, and the synthetic click is
        // skipped entirely. Handling touchstart instead fires the action the
        // moment the finger lands on the button, even mid-momentum.
        // preventDefault suppresses the synthetic mouse-event chain so the
        // Button's own click handler doesn't re-fire on the same gesture.
        let touchHandled = false;
        button.element.addEventListener('touchstart', (e) => {
            if (e.cancelable) e.preventDefault();
            if (touchHandled) return;
            touchHandled = true;
            scrollToTop();
        }, { passive: false });
        // Reset for the next tap sequence so subsequent taps still work.
        button.element.addEventListener('touchend', () => {
            touchHandled = false;
        }, { passive: true });
        button.element.addEventListener('touchcancel', () => {
            touchHandled = false;
        }, { passive: true });

        returnToTopButton = button;
        glassBuilt = true;

        setTimeout(() => {
            applyGlassSettingsToInstance(button);
            if (typeof button.updateSizeFromDOM === 'function') button.updateSizeFromDOM();
            if (typeof button.render === 'function') button.render();
        }, 300);
    }

    function init() {
        const wrapper = document.getElementById('glass-wrapper');
        if (!wrapper) return;
        let shown = false;

        window.addEventListener('scroll', function () {
            const shouldShow = window.scrollY >= window.innerHeight * 0.85;
            if (shouldShow && !shown) {
                wrapper.classList.add('visible');
                shown = true;
                if (!glassBuilt) {
                    buildReturnToTopButton();
                    setTimeout(refreshReturnToTopGlass, 350);
                } else {
                    refreshReturnToTopGlass();
                }
            } else if (!shouldShow && shown) {
                wrapper.classList.remove('visible');
                shown = false;
            }
            if (shouldShow && glassBuilt) refreshReturnToTopGlass();
        }, { passive: true });

        window.addEventListener('resize', function () {
            if (glassBuilt) refreshReturnToTopGlass();
        }, { passive: true });
    }

    if (document.readyState !== 'loading') init();
    else document.addEventListener('DOMContentLoaded', init);
})();
