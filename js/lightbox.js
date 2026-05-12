import { sendVideoPixel } from './pixel.js';
import { buildPlayerMarkup, mountPlayer, parseVideoUrl, loadYouTubeApi, loadVimeoApi } from './uniform-player.js';

// Native-dialog lightbox: images (gallery) + iframes (video).
// Features: keyboard nav, swipe, captions, slideshow, fullscreen, thumbs,
// mobile body-scroll-lock, lazy iframe load, View Transitions when supported.

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|svg)(\?|$)/i;
const VIDEO_HOSTS = /(youtube\.com|youtu\.be|vimeo\.com|player\.vimeo\.com)/i;

function detectType(href) {
    if (!href) return 'iframe';
    if (IMAGE_EXT.test(href)) return 'image';
    if (VIDEO_HOSTS.test(href)) return 'iframe';
    return href.includes('/embed/') ? 'iframe' : 'image';
}

function youtubeIdToEmbed(href) {
    return href; // already /embed/ urls in this codebase; placeholder for future
}

// Normalize YouTube embed URLs:
// 1. youtube.com → www.youtube.com (bare youtube.com/embed 301-redirects which
//    iframes don't follow cleanly).
// 2. youtu.be/VIDEO → www.youtube.com/embed/VIDEO
// 3. Legacy /embed?listType=playlist&list=ID → canonical /embed/videoseries?list=ID
// 4. Strip the `origin=` query param. YouTube's new embed system uses si= for
//    embed authentication and a stale origin= param can trigger "video unavailable".
function enhanceVideoSrc(href) {
    try {
        const u = new URL(href, window.location.origin);
        if (/^youtube\.com$/i.test(u.hostname)) u.hostname = 'www.youtube.com';
        if (/^youtu\.be$/i.test(u.hostname)) {
            const id = u.pathname.replace(/^\//, '');
            u.hostname = 'www.youtube.com';
            u.pathname = '/embed/' + id;
        }
        if (/youtube\.com/i.test(u.hostname)) {
            const isPlaylist = u.searchParams.has('list') || u.searchParams.has('listType');
            const isBareEmbed = u.pathname === '/embed' || u.pathname === '/embed/';
            if (isPlaylist && isBareEmbed) {
                const listId = u.searchParams.get('list');
                u.pathname = '/embed/videoseries';
                u.search = '';
                if (listId) u.searchParams.set('list', listId);
            }
            u.searchParams.delete('origin');
        }
        return u.toString();
    } catch (_) {}
    return href;
}

let bodyLockCount = 0;
let savedScrollY = 0;

// Robust scroll lock: video iframes propagate scroll/wheel events to the
// parent on iOS, so disabling overflow alone isn't enough. Pin <body> with
// position: fixed + negative top, then restore the scroll position on
// unlock. The lightbox <dialog> covers the viewport so the sticky header
// being temporarily un-stuck is invisible.
function lockBody() {
    if (bodyLockCount++ > 0) return;
    savedScrollY = window.scrollY;
    // Apply the dark .lightbox-open class FIRST so html + body are already
    // painted black by the time we set position: fixed below. Otherwise iOS
    // collapses its address bar in response to the fixed body and repaints
    // with the still-white body background, producing a white flash on
    // touch screens.
    document.documentElement.classList.add('lightbox-open');
    document.body.style.position = 'fixed';
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
}
function unlockBody() {
    if (--bodyLockCount > 0) return;
    bodyLockCount = 0;
    // Mirror the lock order: clear position FIRST (which re-expands the
    // address bar on iOS), then drop the dark class. Body bg stays dark
    // through the toolbar's repaint, so no flash on close either.
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    window.scrollTo(0, savedScrollY);
    document.documentElement.classList.remove('lightbox-open');
}

export class Lightbox {
    constructor(options = {}) {
        this.items = options.items || [];
        this.loop = options.loop !== false;
        this.slideshow = !!options.slideshow;
        this.slideshowInterval = options.slideshowInterval || 6000;
        this.fullscreen = !!options.fullscreen;
        this.thumbs = !!options.thumbs;
        this.nav = options.nav !== false;
        this.captionFn = options.caption || (item => item.caption || '');
        this.onClose = options.onClose || null;

        this.index = 0;
        this.dialog = null;
        this.slideshowTimer = null;
        this._buildDialog();
    }

    _buildDialog() {
        const dlg = document.createElement('dialog');
        dlg.className = 'lightbox';
        dlg.innerHTML = `
            <div class="lightbox__toolbar" role="toolbar" aria-label="Lightbox controls">
                <button class="lightbox__btn lightbox__btn--play" type="button" aria-label="Toggle slideshow" hidden>
                    <span class="lightbox__icon-play"></span>
                </button>
                <button class="lightbox__btn lightbox__btn--fullscreen" type="button" aria-label="Toggle fullscreen" hidden>
                    <span class="lightbox__icon-fullscreen"></span>
                </button>
                <button class="lightbox__btn lightbox__btn--thumbs" type="button" aria-label="Toggle thumbnails" hidden>
                    <span class="lightbox__icon-thumbs"></span>
                </button>
                <button class="lightbox__btn lightbox__btn--close" type="button" aria-label="Close">
                    <span class="lightbox__icon-close"></span>
                </button>
            </div>
            <button class="lightbox__nav lightbox__nav--prev" type="button" aria-label="Previous" hidden>
                <span class="lightbox__icon-arrow"></span>
            </button>
            <button class="lightbox__nav lightbox__nav--next" type="button" aria-label="Next" hidden>
                <span class="lightbox__icon-arrow"></span>
            </button>
            <div class="lightbox__counter" aria-live="polite" hidden></div>
            <div class="lightbox__stage" aria-live="polite"></div>
            <div class="lightbox__caption" aria-live="polite"></div>
            <div class="lightbox__thumbs" hidden></div>
        `;
        document.body.appendChild(dlg);
        this.dialog = dlg;
        this.stage = dlg.querySelector('.lightbox__stage');
        this.captionEl = dlg.querySelector('.lightbox__caption');
        this.counterEl = dlg.querySelector('.lightbox__counter');
        this.thumbsEl = dlg.querySelector('.lightbox__thumbs');
        this.btnPlay = dlg.querySelector('.lightbox__btn--play');
        this.btnFull = dlg.querySelector('.lightbox__btn--fullscreen');
        this.btnThumbs = dlg.querySelector('.lightbox__btn--thumbs');
        this.btnClose = dlg.querySelector('.lightbox__btn--close');
        this.btnPrev = dlg.querySelector('.lightbox__nav--prev');
        this.btnNext = dlg.querySelector('.lightbox__nav--next');

        this.btnClose.addEventListener('click', () => this.close());
        this.btnPrev.addEventListener('click', () => this.prev());
        this.btnNext.addEventListener('click', () => this.next());
        this.btnPlay.addEventListener('click', () => this.toggleSlideshow());
        this.btnFull.addEventListener('click', () => this.toggleFullscreen());
        this.btnThumbs.addEventListener('click', () => this.toggleThumbs());

        dlg.addEventListener('click', (e) => {
            if (e.target === dlg) this.close();
        });
        dlg.addEventListener('close', () => this._cleanup());
        dlg.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight') this.next();
            else if (e.key === 'ArrowLeft') this.prev();
            else if (e.key === ' ' && this.slideshow) {
                e.preventDefault();
                this.toggleSlideshow();
            }
        });

        // Mouse pointer drag → scrollLeft with inertial flick. Touch is handled natively.
        let dragStartX = null;
        let dragStartY = null;
        let dragStartScroll = 0;
        let dragPointer = null;
        let dragMoved = false;
        // Velocity tracking — sample the last few moves for a stable read at release.
        let velSamples = []; // {t, x, y}
        const DISMISS_DRAG_Y = 120;
        const DISMISS_FLICK_VELOCITY = 0.5; // px/ms — vertical flick speed to dismiss
        const DISMISS_FLICK_MIN_DY = 20;    // minimum travel paired with flick velocity
        const FLICK_THRESHOLD = 0.45;  // px/ms — moderate horizontal flick (panel advance)
        const FLICK_STRONG = 1.4;      // px/ms — strong flick (skips multiple)

        // Pan state — drag while zoomed translates the image instead of
        // scrolling the gallery. Tracked separately from gallery drag.
        let panImg = null;
        let panInitialTx = 0, panInitialTy = 0;

        this.stage.addEventListener('pointerdown', (e) => {
            if (e.pointerType !== 'mouse') return;
            if (e.button !== 0) return;
            if (e.target.closest('iframe, button, a')) return;
            // Don't engage gallery-drag (and its setPointerCapture) for clicks
            // inside the uniform video player. Capturing the pointer routes
            // the subsequent click event to the stage instead of the player's
            // hit/play/mute/fullscreen targets, breaking every player button.
            if (e.target.closest('.up')) return;
            const zoomedPanel = e.target.closest('.lightbox__panel.is-zoomed');
            dragPointer = e.pointerId;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            dragMoved = false;
            if (zoomedPanel) {
                // Pan mode: track pan offset; do not engage gallery scroll.
                // Disable the CSS transform transition so each pointermove
                // updates the position instantly — otherwise the 250ms
                // tween causes panning to feel laggy.
                panImg = zoomedPanel.querySelector('.lightbox__image');
                panImg.style.transition = 'none';
                const t = this._getImageTranslate(panImg);
                panInitialTx = t.x;
                panInitialTy = t.y;
            } else {
                panImg = null;
                dragStartScroll = this.stage.scrollLeft;
                velSamples = [{ t: performance.now(), x: e.clientX, y: e.clientY }];
            }
            this.stage.setPointerCapture(e.pointerId);
            this.stage.classList.add('is-dragging');
        });
        this.stage.addEventListener('pointermove', (e) => {
            if (e.pointerId !== dragPointer || dragStartX === null) return;
            const dx = e.clientX - dragStartX;
            const dy = e.clientY - dragStartY;
            if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragMoved = true;
            if (panImg) {
                this._setImageTranslate(panImg, panInitialTx + dx, panInitialTy + dy);
                return;
            }
            this.stage.scrollLeft = dragStartScroll - dx;
            const now = performance.now();
            velSamples.push({ t: now, x: e.clientX, y: e.clientY });
            while (velSamples.length > 1 && now - velSamples[0].t > 100) velSamples.shift();
            // Vertical drag: move ONLY the current image; fade everything else.
            // Works in both directions — drag up or down to dismiss.
            // Don't trigger for tiny vertical drift while horizontal-scrolling.
            const verticalDominant = Math.abs(dy) > Math.abs(dx) * 1.2;
            this._setDismissDrag(verticalDominant ? dy : 0);
        });
        const endDrag = (e) => {
            if (e.pointerId !== dragPointer || dragStartX === null) return;
            const dy = e.clientY - dragStartY;
            this.stage.releasePointerCapture(e.pointerId);
            this.stage.classList.remove('is-dragging');
            const moved = dragMoved;
            if (panImg) {
                // Finish pan. Restore transitions for subsequent zoom-in/out
                // animations. If user did NOT actually move (just clicked on
                // a zoomed image), the click will toggle zoom out. If they
                // panned, suppress the click so zoom doesn't toggle.
                panImg.style.transition = '';
                panImg = null;
                dragStartX = dragStartY = null;
                dragPointer = null;
                if (moved) {
                    const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); this.stage.removeEventListener('click', stop, true); };
                    this.stage.addEventListener('click', stop, true);
                    setTimeout(() => this.stage.removeEventListener('click', stop, true), 60);
                }
                return;
            }
            this._setDismissDrag(0);
            // Compute average horizontal + vertical velocity over recent samples (px/ms).
            let velocity = 0;
            let velY = 0;
            if (velSamples.length >= 2) {
                const first = velSamples[0];
                const last = velSamples[velSamples.length - 1];
                const dt = Math.max(last.t - first.t, 1);
                velocity = (last.x - first.x) / dt;
                velY = (last.y - first.y) / dt;
            }
            dragStartX = dragStartY = null;
            dragPointer = null;
            const isVerticalFlick = Math.abs(velY) >= DISMISS_FLICK_VELOCITY
                && Math.abs(dy) >= DISMISS_FLICK_MIN_DY
                && Math.sign(velY) === Math.sign(dy);
            if (Math.abs(dy) > DISMISS_DRAG_Y || isVerticalFlick) { this.close(); return; }
            // Inertial flick: high horizontal velocity → advance one or more panels.
            // Wraps around at the ends when loop is enabled.
            if (this.items.length > 1 && Math.abs(velocity) > FLICK_THRESHOLD) {
                const dir = velocity < 0 ? 1 : -1;
                const stride = Math.abs(velocity) > FLICK_STRONG ? 2 : 1;
                let target = this.index + dir * stride;
                if (this.loop) {
                    target = ((target % this.items.length) + this.items.length) % this.items.length;
                } else {
                    target = Math.max(0, Math.min(target, this.items.length - 1));
                }
                this.index = target;
                this._scrollToIndex(target, 'smooth');
                this._renderMeta();
            } else {
                this._snapToNearest();
            }
            // Suppress the click that follows a drag so it doesn't bubble to backdrop close
            if (moved) {
                const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); this.stage.removeEventListener('click', stop, true); };
                this.stage.addEventListener('click', stop, true);
                setTimeout(() => this.stage.removeEventListener('click', stop, true), 60);
            }
        };
        this.stage.addEventListener('pointerup', endDrag);
        this.stage.addEventListener('pointercancel', endDrag);

        // Single click on a still toggles zoom: zoom in centered on click,
        // click again zooms out. The pointerdown/pointerup pipeline above
        // suppresses this click when the user drags (gallery scroll OR pan).
        // Note: when pointer-capture is in play, the click's e.target is the
        // captured stage element, not the visually clicked image. Fall back
        // to elementFromPoint so the captured-pointer case still works.
        this.stage.addEventListener('click', (e) => {
            let img = e.target.closest('.lightbox__image');
            if (!img) {
                const el = document.elementFromPoint(e.clientX, e.clientY);
                img = el && el.closest && el.closest('.lightbox__image');
            }
            if (img) this._toggleZoomAt(img, e.clientX, e.clientY);
        });

        // Touch handling — vertical flick to dismiss + double-tap zoom
        // (we let native overflow-x scroll handle horizontal swipes for momentum)
        let touchStartX = 0, touchStartY = 0, touchDir = null;
        let touchStartTime = 0;
        let lastTapTime = 0, lastTapX = 0, lastTapY = 0;
        let touchVelSamples = [];
        // Slow-drag fallback distance. A fast flick dismisses with far less
        // travel — see velocity check in touchend.
        const VERTICAL_DISMISS_THRESHOLD = 90;
        // Pixels-per-millisecond. A "flick" reaching this speed dismisses
        // even after only ~20px of travel.
        const VERTICAL_FLICK_VELOCITY = 0.5;
        const VERTICAL_FLICK_MIN_DY = 20;

        // Touch pan state — drag while zoomed translates the image instead
        // of doing the dismiss / horizontal-swipe behaviors.
        let touchPanImg = null;
        let touchPanInitialTx = 0, touchPanInitialTy = 0;

        this.stage.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;
            const t = e.touches[0];
            touchStartX = t.clientX;
            touchStartY = t.clientY;
            touchDir = null;
            touchStartTime = performance.now();
            touchVelSamples = [{ t: touchStartTime, y: t.clientY }];
            const zoomedPanel = document.elementFromPoint(t.clientX, t.clientY)?.closest('.lightbox__panel.is-zoomed');
            if (zoomedPanel) {
                touchPanImg = zoomedPanel.querySelector('.lightbox__image');
                touchPanImg.style.transition = 'none';
                const cur = this._getImageTranslate(touchPanImg);
                touchPanInitialTx = cur.x;
                touchPanInitialTy = cur.y;
            } else {
                touchPanImg = null;
            }
        }, { passive: true });

        this.stage.addEventListener('touchmove', (e) => {
            if (e.touches.length !== 1) return;
            const t = e.touches[0];
            const dx = t.clientX - touchStartX;
            const dy = t.clientY - touchStartY;
            if (touchPanImg) {
                // Pan the zoomed image. preventDefault to block native page
                // scroll + the dismiss/swipe handlers below.
                e.preventDefault();
                this._setImageTranslate(touchPanImg, touchPanInitialTx + dx, touchPanInitialTy + dy);
                return;
            }
            if (touchDir === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
                touchDir = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
            }
            if (touchDir === 'v') {
                e.preventDefault();
                this._setDismissDrag(dy);
                const now = performance.now();
                touchVelSamples.push({ t: now, y: t.clientY });
                // Keep only samples from the last 100ms for a fresh velocity reading.
                while (touchVelSamples.length > 1 && now - touchVelSamples[0].t > 100) {
                    touchVelSamples.shift();
                }
            }
        }, { passive: false });

        this.stage.addEventListener('touchend', (e) => {
            const t = e.changedTouches?.[0];
            if (!t) return;
            const dx = t.clientX - touchStartX;
            const dy = t.clientY - touchStartY;
            const elapsed = performance.now() - touchStartTime;

            if (touchPanImg) {
                // Restore the CSS transition that was disabled during the
                // pan (see touchmove). The image stays at its current
                // translated position; subsequent zoom-in/out will animate
                // smoothly back.
                touchPanImg.style.transition = '';
                touchPanImg = null;
                touchDir = null;
                // Tap-on-zoomed-image (no movement) is handled by the
                // synthetic click event that fires after touchend — we
                // deliberately do not call _toggleZoomAt here, to avoid
                // double-toggling (touchend + click).
                return;
            }

            // Compute instantaneous velocity from the last ~100ms of samples.
            let velY = 0;
            if (touchVelSamples.length >= 2) {
                const first = touchVelSamples[0];
                const last = touchVelSamples[touchVelSamples.length - 1];
                const dt = Math.max(last.t - first.t, 1);
                velY = (last.y - first.y) / dt; // px/ms, signed
            }
            const isFlick = Math.abs(velY) >= VERTICAL_FLICK_VELOCITY
                && Math.abs(dy) >= VERTICAL_FLICK_MIN_DY
                && Math.sign(velY) === Math.sign(dy); // direction matches drag
            const isSlowDrag = Math.abs(dy) > VERTICAL_DISMISS_THRESHOLD;
            if (touchDir === 'v' && (isFlick || isSlowDrag)) {
                this.close();
                touchDir = null;
                return;
            }
            if (touchDir === 'v') this._setDismissDrag(0);
            // Single tap on a non-zoomed still → zoom in. We don't call
            // _toggleZoomAt here; the synthetic `click` event that follows
            // touchend handles it via the listener bound to this.stage.
            touchDir = null;
        }, { passive: true });

        // Pinch-zoom via Safari gesture events (covers iOS + macOS Safari).
        // Other browsers fall back to double-tap.
        let pinchImg = null;
        let pinchScale = 1;
        this.stage.addEventListener('gesturestart', (e) => {
            const img = e.target.closest('.lightbox__image');
            if (!img) return;
            e.preventDefault();
            pinchImg = img;
            pinchScale = 1;
        });
        this.stage.addEventListener('gesturechange', (e) => {
            if (!pinchImg) return;
            e.preventDefault();
            const scale = Math.max(1, Math.min(e.scale, 4));
            pinchImg.style.transform = `scale(${scale})`;
            pinchScale = scale;
        });
        this.stage.addEventListener('gestureend', (e) => {
            if (!pinchImg) return;
            e.preventDefault();
            const panel = pinchImg.closest('.lightbox__panel');
            if (pinchScale > 1.3) {
                panel.classList.add('is-zoomed');
                pinchImg.style.transform = '';
            } else {
                panel.classList.remove('is-zoomed');
                pinchImg.style.transform = '';
            }
            pinchImg = null;
            pinchScale = 1;
        });

        // Snap-aware scroll listener: update current index after the user finishes scrolling
        let scrollTimer = null;
        const onScroll = () => {
            if (scrollTimer) clearTimeout(scrollTimer);
            scrollTimer = setTimeout(() => this._syncIndexFromScroll(), 120);
        };
        this.stage.addEventListener('scroll', onScroll, { passive: true });
        if ('onscrollend' in window) {
            this.stage.addEventListener('scrollend', () => this._syncIndexFromScroll());
        }

        // Two-finger trackpad swipe in either vertical direction → dismiss.
        // Horizontal wheel still scrolls the gallery natively.
        let wheelAccum = 0;
        let wheelResetTimer = null;
        this.stage.addEventListener('wheel', (e) => {
            // Only treat dominant-vertical gestures as dismiss intent
            if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) * 1.2) return;
            e.preventDefault();
            e.stopPropagation();
            wheelAccum += e.deltaY;
            if (Math.abs(wheelAccum) > 150) {
                wheelAccum = 0;
                this._setDismissDrag(0);
                this.close();
                return;
            }
            this._setDismissDrag(wheelAccum);
            clearTimeout(wheelResetTimer);
            wheelResetTimer = setTimeout(() => {
                wheelAccum = 0;
                this._setDismissDrag(0);
            }, 200);
        }, { passive: false });

        // Prevent the document from scrolling behind the dialog. The stage's own
        // wheel handler already manages wheel inside the gallery; for any other
        // area inside the dialog (toolbar, counter, caption, thumbs, padding),
        // swallow the event so it doesn't bubble to documentElement scroll.
        const stopOutsideStage = (e) => {
            if (e.target.closest('.lightbox__stage')) return;
            e.preventDefault();
        };
        this.dialog.addEventListener('wheel', stopOutsideStage, { passive: false });
        this.dialog.addEventListener('touchmove', stopOutsideStage, { passive: false });

        // Sync cinema state with the OS fullscreen state — if the user hits ESC
        // to leave fullscreen, also drop the is-cinema class.
        const onFsChange = () => {
            const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
            if (!fsEl && this.dialog.classList.contains('is-cinema')) {
                this.dialog.classList.remove('is-cinema');
                this.btnFull.classList.remove('is-active');
            }
        };
        document.addEventListener('fullscreenchange', onFsChange);
        document.addEventListener('webkitfullscreenchange', onFsChange);
    }

    setItems(items, startIndex = 0) {
        this.items = items;
        this.index = startIndex;
    }

    open(index = 0) {
        if (!this.items.length) return;
        this.index = Math.max(0, Math.min(index, this.items.length - 1));

        const multiple = this.items.length > 1;
        this.btnPrev.hidden = !(multiple && this.nav);
        this.btnNext.hidden = !(multiple && this.nav);
        this.btnThumbs.hidden = !(multiple && this.thumbs);
        this.btnPlay.hidden = !(multiple && this.slideshow);
        this.btnFull.hidden = !this.fullscreen;
        this.counterEl.hidden = !multiple;

        lockBody();
        this._buildThumbs();
        this._renderPanels();
        this._renderMeta();

        this.dialog.showModal();
        requestAnimationFrame(() => {
            this.dialog.classList.add('is-open');
            // Jump (no animation) to the starting panel
            this._scrollToIndex(this.index, 'instant');
        });

        // Beacon the backend so the stats card can show which videos were
        // actually opened. Images aren't beaconed — pageviews already cover
        // image-gallery interest.
        const item = this.items[this.index];
        if (item && item.type === 'iframe') {
            try { sendVideoPixel(item.href); } catch (_) {}
        }
    }

    close() {
        if (!this.dialog.open) return;
        this.dialog.classList.remove('is-open');
        this._stopSlideshow();
        // Drive the backdrop blur back to zero via the existing --dismiss-progress transition
        this.dialog.style.setProperty('--dismiss-progress', '1');

        // Eat wheel/touch events for a brief window so the tail of a flick gesture
        // doesn't scroll the page after we close.
        const block = (e) => { e.preventDefault(); e.stopPropagation(); };
        window.addEventListener('wheel', block, { passive: false, capture: true });
        window.addEventListener('touchmove', block, { passive: false, capture: true });
        setTimeout(() => {
            window.removeEventListener('wheel', block, { capture: true });
            window.removeEventListener('touchmove', block, { capture: true });
        }, 450);

        setTimeout(() => {
            this.dialog.close();
            this.dialog.style.setProperty('--dismiss-progress', '0');
        }, 360);
    }

    _cleanup() {
        unlockBody();
        this.stage.innerHTML = '';
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        if (this.onClose) this.onClose();
    }

    next() {
        if (this.items.length < 2) return;
        if (this._looping && this.index === this.items.length - 1) {
            // Smooth-scroll to the clone-first panel; scrollend handler hops to real first
            const cloneFirst = this.stage.children[this.items.length + 1];
            this.stage.scrollTo({ left: cloneFirst.offsetLeft, behavior: 'smooth' });
            return;
        }
        let i = this.index + 1;
        if (i >= this.items.length) i = this.loop ? 0 : this.items.length - 1;
        if (i === this.index) return;
        this.index = i;
        this._scrollToIndex(i, 'smooth');
        this._renderMeta();
    }

    prev() {
        if (this.items.length < 2) return;
        if (this._looping && this.index === 0) {
            const cloneLast = this.stage.children[0];
            this.stage.scrollTo({ left: cloneLast.offsetLeft, behavior: 'smooth' });
            return;
        }
        let i = this.index - 1;
        if (i < 0) i = this.loop ? this.items.length - 1 : 0;
        if (i === this.index) return;
        this.index = i;
        this._scrollToIndex(i, 'smooth');
        this._renderMeta();
    }

    // Render every item up-front as side-by-side panels. With loop enabled and
    // multiple items, clone the last item before the first and vice versa so the
    // user can scroll infinitely. The cloned panels are visually identical;
    // _syncIndexFromScroll silently jumps to the real panel when we land on a clone.
    _renderPanels() {
        this.stage.innerHTML = '';
        this._looping = this.loop && this.items.length > 1 && this.items.every(it => it.type === 'image');
        const renderOne = (item, idxAttr, isClone) => {
            const panel = document.createElement('div');
            panel.className = 'lightbox__panel';
            panel.dataset.index = idxAttr;
            if (isClone) panel.dataset.clone = '1';
            if (item.type === 'image') {
                const img = document.createElement('img');
                img.className = 'lightbox__image';
                img.src = item.href;
                img.alt = item.alt || '';
                img.decoding = 'async';
                img.loading = 'lazy';
                img.draggable = false;
                panel.appendChild(img);
            } else {
                const wrap = document.createElement('div');
                wrap.className = 'lightbox__iframe-wrap';
                const w = item.width || 1600;
                const h = item.height || 900;
                wrap.style.aspectRatio = `${w} / ${h}`;
                const parsed = parseVideoUrl(item.href);
                if (parsed) {
                    const poster = parsed.provider === 'youtube' ? item.thumb : null;
                    wrap.innerHTML = buildPlayerMarkup({ ...parsed, poster, autoplay: !!item.autoplay });
                    panel.appendChild(wrap);
                    mountPlayer(wrap.querySelector('.up'));
                } else {
                    // Fallback: raw iframe (legacy/unknown video host).
                    const iframe = document.createElement('iframe');
                    iframe.className = 'lightbox__iframe';
                    iframe.setAttribute('src', enhanceVideoSrc(item.href));
                    iframe.setAttribute('title', 'Video player');
                    iframe.setAttribute('frameborder', '0');
                    iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
                    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
                    iframe.setAttribute('allowfullscreen', '');
                    wrap.appendChild(iframe);
                    panel.appendChild(wrap);
                }
            }
            this.stage.appendChild(panel);
        };
        if (this._looping) renderOne(this.items[this.items.length - 1], 'clone-last', true);
        this.items.forEach((item, i) => renderOne(item, String(i), false));
        if (this._looping) renderOne(this.items[0], 'clone-first', true);
    }

    // Convert logical item index (0..N-1) to DOM panel index, accounting for clones.
    _panelIndexFor(itemIndex) {
        return this._looping ? itemIndex + 1 : itemIndex;
    }

    _renderMeta() {
        const item = this.items[this.index];
        const caption = this.captionFn(item) || '';
        this.captionEl.innerHTML = caption;
        this.captionEl.hidden = !caption;
        // Caption-without-frame mode when content is just a button (video lightboxes)
        const onlyButton = this.captionEl.children.length === 1
            && this.captionEl.firstElementChild?.classList?.contains('external-button');
        this.captionEl.classList.toggle('lightbox__caption--bare', onlyButton);
        if (this.items.length > 1) {
            this.counterEl.textContent = `${this.index + 1} / ${this.items.length}`;
        }
        this._updateThumbsSelection();
    }

    _scrollToIndex(i, behavior = 'smooth') {
        const panel = this.stage.children[this._panelIndexFor(i)];
        if (!panel) return;
        this.stage.scrollTo({ left: panel.offsetLeft, behavior: behavior === 'instant' ? 'instant' : 'smooth' });
    }

    _domToItemIndex(domIdx) {
        if (!this._looping) return domIdx;
        const N = this.items.length;
        if (domIdx === 0) return N - 1;
        if (domIdx === N + 1) return 0;
        return domIdx - 1;
    }

    _nearestPanelDomIndex() {
        const center = this.stage.scrollLeft + this.stage.clientWidth / 2;
        let nearest = 0, nearestDist = Infinity;
        Array.from(this.stage.children).forEach((panel, i) => {
            const c = panel.offsetLeft + panel.offsetWidth / 2;
            const d = Math.abs(c - center);
            if (d < nearestDist) { nearestDist = d; nearest = i; }
        });
        return nearest;
    }

    _toggleZoomAt(img, clientX, clientY) {
        const panel = img.closest('.lightbox__panel');
        const willZoom = !panel.classList.contains('is-zoomed');
        this.stage.querySelectorAll('.lightbox__panel.is-zoomed').forEach(p => {
            p.classList.remove('is-zoomed');
            const i = p.querySelector('.lightbox__image');
            i.style.transformOrigin = '';
            i.style.transform = '';   // Reset any pan offset from a previous zoom.
        });
        if (willZoom) {
            const rect = img.getBoundingClientRect();
            const ox = ((clientX - rect.left) / rect.width) * 100;
            const oy = ((clientY - rect.top) / rect.height) * 100;
            img.style.transformOrigin = `${ox}% ${oy}%`;
            img.style.transform = '';   // Start fresh with no pan.
            panel.classList.add('is-zoomed');
        }
    }

    // Pan helpers — inline transform uses `translate(...) scale(2)` so that
    // the translate values match screen-pixel deltas 1:1 (translate applied
    // AFTER the scale in the matrix multiplication, per CSS spec).
    _getImageTranslate(img) {
        const t = img.style.transform || '';
        const m = t.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
        return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: 0, y: 0 };
    }
    _setImageTranslate(img, x, y) {
        img.style.transform = `translate(${x}px, ${y}px) scale(2)`;
    }

    _setDismissDrag(dy) {
        // The current panel's content (image or iframe wrap) translates with the drag;
        // everything else (toolbar, nav, counter, caption, thumbs, backdrop) fades via --dismiss-progress.
        const panel = this.stage.children[this._panelIndexFor(this.index)];
        const target = panel?.querySelector('.lightbox__image, .lightbox__iframe-wrap');
        if (dy !== 0) {
            const progress = Math.min(Math.abs(dy) / 400, 1);
            if (target) target.style.transform = `translateY(${dy}px) scale(${1 - progress * 0.08})`;
            this.dialog.style.setProperty('--dismiss-progress', progress.toFixed(3));
        } else {
            if (target) target.style.transform = '';
            this.dialog.style.setProperty('--dismiss-progress', '0');
        }
    }

    _snapToNearest() {
        if (this.items.length < 2) return;
        const domIdx = this._nearestPanelDomIndex();
        const itemIdx = this._domToItemIndex(domIdx);
        this.index = itemIdx;
        this._scrollToIndex(itemIdx, 'smooth');
        this._renderMeta();
    }

    _syncIndexFromScroll() {
        if (this.items.length < 2) return;
        const domIdx = this._nearestPanelDomIndex();
        const itemIdx = this._domToItemIndex(domIdx);
        if (itemIdx !== this.index) {
            this.index = itemIdx;
            this._renderMeta();
        }
        // If we landed on a clone, hop to the real panel without animation
        if (this._looping) {
            const N = this.items.length;
            if (domIdx === 0) {
                this.stage.scrollTo({ left: this.stage.children[N].offsetLeft, behavior: 'instant' });
            } else if (domIdx === N + 1) {
                this.stage.scrollTo({ left: this.stage.children[1].offsetLeft, behavior: 'instant' });
            }
        }
    }

    _buildThumbs() {
        if (!this.thumbs || this.items.length < 2) {
            this.thumbsEl.hidden = true;
            return;
        }
        this.thumbsEl.innerHTML = '';
        this.items.forEach((item, i) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'lightbox__thumb';
            btn.setAttribute('aria-label', `Go to item ${i + 1}`);
            if (item.type === 'image') {
                const img = document.createElement('img');
                img.src = item.thumb || item.href;
                img.alt = '';
                img.loading = 'lazy';
                btn.appendChild(img);
            } else {
                btn.textContent = String(i + 1);
            }
            btn.addEventListener('click', () => {
                this.index = i;
                this._scrollToIndex(i, 'smooth');
                this._renderMeta();
            });
            this.thumbsEl.appendChild(btn);
        });
    }

    _updateThumbsSelection() {
        if (!this.thumbsEl) return;
        this.thumbsEl.querySelectorAll('.lightbox__thumb').forEach((b, i) => {
            b.classList.toggle('is-active', i === this.index);
        });
    }

    toggleThumbs() {
        this.thumbsEl.hidden = !this.thumbsEl.hidden;
        this.btnThumbs.classList.toggle('is-active', !this.thumbsEl.hidden);
    }

    toggleSlideshow() {
        if (this.slideshowTimer) this._stopSlideshow();
        else this._startSlideshow();
    }
    _startSlideshow() {
        this.slideshowTimer = setInterval(() => this.next(), this.slideshowInterval);
        this.btnPlay.classList.add('is-playing');
    }
    _stopSlideshow() {
        if (this.slideshowTimer) clearInterval(this.slideshowTimer);
        this.slideshowTimer = null;
        this.btnPlay.classList.remove('is-playing');
    }

    toggleFullscreen() {
        const cinemaActive = this.dialog.classList.toggle('is-cinema');
        const fsEl = document.fullscreenElement || document.webkitFullscreenElement;

        if (cinemaActive) {
            // Fullscreen the dialog itself so it stays visible. Fullscreening
            // documentElement in Safari makes the top-layer dialog close. The
            // dialog approach also hides the browser chrome since the dialog
            // is the fullscreen element.
            const req = this.dialog.requestFullscreen || this.dialog.webkitRequestFullscreen;
            if (req) {
                try {
                    const r = req.call(this.dialog);
                    if (r?.catch) r.catch(() => {});
                } catch (_) {}
            }
        } else {
            if (fsEl) {
                const exit = document.exitFullscreen || document.webkitExitFullscreen;
                try {
                    const p = exit?.call(document);
                    if (p?.catch) p.catch(() => {});
                } catch (_) {}
            }
        }
        this.btnFull.classList.toggle('is-active', cinemaActive);
    }
}

// Auto-init for [data-lightbox] anchors.
// Groups: anchors sharing a non-empty data-lightbox value form a gallery.
// Empty/missing data-lightbox = single-item lightbox.
export function autoInitLightboxes(opts = {}) {
    // Includes legacy selectors: a.sixteen-by-nine, a[class*="-by-nine"] (typo'd class), .thumbnails.lightbox a
    const triggers = document.querySelectorAll(
        'a[data-lightbox], a[data-fancybox], a.sixteen-by-nine, a[class*="-by-nine"], a.stills-image, #reel-button a, .thumbnails.lightbox a'
    );
    const groups = new Map();

    triggers.forEach(el => {
        // Skip explicitly opted-out
        if (el.classList.contains('not-fancy')) return;

        const groupKey = el.dataset.lightbox || el.dataset.fancybox || (el.classList.contains('stills-image') ? 'stills' : '__single__' + Math.random());
        if (!groups.has(groupKey)) groups.set(groupKey, []);

        const href = el.getAttribute('href');
        groups.get(groupKey).push({
            el,
            href,
            type: detectType(href),
            caption: el.dataset.caption || '',
            width: parseInt(el.dataset.width) || null,
            height: parseInt(el.dataset.height) || null,
            thumb: el.querySelector('img')?.src || null,
            autoplay: el.dataset.autoplay === '1',
        });
    });

    for (const [, items] of groups) {
        const isImage = items[0].type === 'image';
        const isGallery = items.length > 1 && isImage;
        const lb = new Lightbox({
            nav: items.length > 1,
            slideshow: isGallery,
            thumbs: isGallery,
            fullscreen: false,
            caption: (item) => item.caption || '',
            ...opts,
        });
        lb.setItems(items);

        items.forEach((item, i) => {
            item.el.addEventListener('click', (e) => {
                e.preventDefault();
                // Preload the right video API so by the time the user clicks
                // play, the iframe can be created synchronously and the
                // browser's user-gesture autoplay grace period is still
                // valid. Suppresses the "click play to start" pause
                // indicator that YouTube otherwise shows.
                const p = parseVideoUrl(item.href);
                if (p && p.provider === 'youtube') loadYouTubeApi();
                else if (p && p.provider === 'vimeo') loadVimeoApi();
                lb.open(i);
            });
        });
    }
}
