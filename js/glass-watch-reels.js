// Glass-style Watch Reels pill for mobile. Mirrors glass-return-to-top.js but
// renders a pill-shaped Button (text: "Watch Reels") with a darker tint so it
// reads as a distinct second-tier action below the circular return-to-top.
//
// The host element is the existing anchor `<a id="reel-glass-button">`. The
// anchor stays the click target (lightbox auto-init binds to it via the
// selector list in js/lightbox.js), so the WebGL Button is appended inside it
// purely as decoration — click events bubble up to the anchor.
//
// Depends on the global `Button` and `Container` classes (js/button.js,
// js/container.js).

(function () {
    'use strict';

    let pillButton = null;
    let glassBuilt = false;
    let glassRefreshQueued = false;

    // Darker tint than return-to-top (0.78) so the pill reads as a secondary,
    // weightier surface than the circular button it sits next to.
    const PILL_TINT_OPACITY = 0.95;

    function applyGlassSettingsToInstance(instance) {
        if (!instance || !instance.gl_refs || !instance.gl_refs.gl) return;
        const gl = instance.gl_refs.gl;
        const refs = instance.gl_refs;
        const controls = window.glassControls || {};
        if (refs.edgeIntensityLoc) gl.uniform1f(refs.edgeIntensityLoc, controls.edgeIntensity ?? 0.0);
        if (refs.rimIntensityLoc) gl.uniform1f(refs.rimIntensityLoc, controls.rimIntensity ?? 0.043);
        if (refs.baseIntensityLoc) gl.uniform1f(refs.baseIntensityLoc, controls.baseIntensity ?? 0.0);
        if (refs.edgeDistanceLoc) gl.uniform1f(refs.edgeDistanceLoc, controls.edgeDistance ?? 0.41);
        if (refs.rimDistanceLoc) gl.uniform1f(refs.rimDistanceLoc, controls.rimDistance ?? 0.25);
        if (refs.baseDistanceLoc) gl.uniform1f(refs.baseDistanceLoc, controls.baseDistance ?? 0.16);
        if (refs.cornerBoostLoc) gl.uniform1f(refs.cornerBoostLoc, controls.cornerBoost ?? 0.078);
        if (refs.rippleEffectLoc) gl.uniform1f(refs.rippleEffectLoc, controls.rippleEffect ?? 0.1);
        if (refs.blurRadiusLoc) gl.uniform1f(refs.blurRadiusLoc, controls.blurRadius ?? 15.0);
        // Override tint so the pill is visibly darker than the RTT circle.
        if (refs.tintOpacityLoc) gl.uniform1f(refs.tintOpacityLoc, PILL_TINT_OPACITY);
        if (typeof instance.render === 'function') instance.render();
    }

    function refreshPillGlass() {
        if (!pillButton || !glassBuilt) return;
        if (glassRefreshQueued) return;
        glassRefreshQueued = true;
        requestAnimationFrame(() => {
            glassRefreshQueued = false;
            if (typeof pillButton.updateSizeFromDOM === 'function') {
                pillButton.updateSizeFromDOM();
            }
            applyGlassSettingsToInstance(pillButton);
            if (typeof pillButton.render === 'function') {
                pillButton.render();
            }
        });
    }

    function buildPillButton() {
        const anchor = document.getElementById('reel-glass-button');
        if (!anchor || glassBuilt) return;
        if (typeof Button === 'undefined') return;

        // The anchor only renders on mobile (display:none on desktop). Don't
        // spin up a WebGL context for a hidden element — it'd be wasted GPU
        // and the snapshot it samples might not even exist yet.
        if (getComputedStyle(anchor).display === 'none') return;

        // Clear the fallback text content so the WebGL canvas owns the visual.
        // The anchor remains the click target — clicks on the inner canvas
        // bubble up and the lightbox auto-init fires off the embedded video.
        anchor.textContent = '';
        anchor.classList.add('glass-built');

        const button = new Button({
            text: 'Watch Reels',
            size: 16,
            type: 'pill',
            tintOpacity: PILL_TINT_OPACITY,
            warp: false,
            // No onClick — let the click bubble up to the anchor so the
            // lightbox auto-init handles it the same way it does for any
            // other portfolio link. Passing onClick would call
            // preventDefault and short-circuit that handoff.
        });
        anchor.appendChild(button.element);

        pillButton = button;
        glassBuilt = true;

        setTimeout(() => {
            applyGlassSettingsToInstance(button);
            if (typeof button.updateSizeFromDOM === 'function') button.updateSizeFromDOM();
            if (typeof button.render === 'function') button.render();
        }, 300);
    }

    function init() {
        const anchor = document.getElementById('reel-glass-button');
        if (!anchor) return;
        // Build on first paint after layout has settled — the pill is always
        // visible on mobile (no scroll-threshold like RTT), so no need to gate.
        const tryBuild = () => {
            buildPillButton();
            if (glassBuilt) setTimeout(refreshPillGlass, 350);
        };
        // Defer to let container.js bake its page snapshot first; otherwise
        // initWebGL has no source texture and the pill renders flat.
        if (document.readyState === 'complete') {
            setTimeout(tryBuild, 200);
        } else {
            window.addEventListener('load', () => setTimeout(tryBuild, 200), { once: true });
        }

        window.addEventListener('resize', function () {
            if (glassBuilt) refreshPillGlass();
            else tryBuild();
        }, { passive: true });

        window.addEventListener('scroll', function () {
            if (glassBuilt) refreshPillGlass();
        }, { passive: true });
    }

    if (document.readyState !== 'loading') init();
    else document.addEventListener('DOMContentLoaded', init);
})();
