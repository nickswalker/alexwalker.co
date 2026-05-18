import { sendVideoPixel, sendVideoDuration } from './visit-log.js';
import { buildPlayerMarkup, mountPlayer, parseVideoUrl, loadYouTubeApi, loadVimeoApi } from './uniform-player.js';

// Per-rich-item configuration. Keyed by the `data-rich` value on the trigger
// anchor. Each entry supplies the assets that the custom rich-lightbox panel
// pulls in (poster, watch-full destination, four still frames). Frame entries
// may be `null` for "placeholder pending real asset" — those render as
// non-interactive placeholder tiles. Real URLs become clickable and open the
// nested image gallery.
export const RICH_CONFIG = {
    hoa: {
        title: 'House of Abraham',
        poster: '/img/posters/HOAposter.jpg',
        frames: [
            '/img/hoa/frame1.jpg',
            '/img/hoa/frame2.jpg',
            '/img/hoa/frame3.jpg',
            '/img/hoa/frame4.jpg',
        ],
    },
    tch: {
        title: 'Texas Cult House',
        poster: '/img/posters/TCH.jpg',
        frames: [
            '/img/tch/frame1.jpg',
            '/img/tch/frame2.jpg',
            '/img/tch/frame3.jpg',
            '/img/tch/frame4.jpg',
        ],
    },
    acinh: {
        title: 'A Christmas In New Hope',
        poster: '/img/posters/ACINHPoster2.jpg',
        frameAspect: '16 / 9',
        frames: [
            '/img/acinh/frame1.jpg',
            '/img/acinh/frame2.jpg',
            '/img/acinh/frame3.jpg',
            '/img/acinh/frame4.jpg',
        ],
    },
    myth: {
        title: 'Myth',
        // No poster — player fills the top row.
        frames: [
            '/img/myth/frame1.jpg',
            '/img/myth/frame2.jpg',
            '/img/myth/frame3.jpg',
            '/img/myth/frame4.jpg',
        ],
    },
    mythbts: {
        title: 'Myth — Behind the Scenes',
        frames: [
            '/img/mythbts/frame1.jpg',
            '/img/mythbts/frame2.jpg',
            '/img/mythbts/frame3.jpg',
            '/img/mythbts/frame4.jpg',
        ],
    },
    amorsui: {
        title: 'Amor Sui',
        frames: [
            '/img/amorsui/frame1.jpg',
            '/img/amorsui/frame2.jpg',
            '/img/amorsui/frame3.jpg',
            '/img/amorsui/frame4.jpg',
        ],
    },
    attad: {
        title: 'A Thousand Times A Day',
        poster: '/img/posters/ATTADposter.jpg',
        frameAspect: '2 / 1',
        frames: [
            '/img/attad/frame1.jpg',
            '/img/attad/frame2.jpg',
            '/img/attad/frame3.jpg',
            '/img/attad/frame4.jpg',
        ],
    },
    alit: {
        title: 'A Life In Technicolor',
        poster: '/img/posters/alitposter.jpg',
        // Per-frame aspect — the film mixes formats inside a 1.9:1 master,
        // so each still is trimmed of its bars individually and the cell
        // adopts that frame's true content aspect.
        frames: [
            { src: '/img/alit/frame1.jpg', aspect: '1600 / 670'  },
            { src: '/img/alit/frame2.jpg', aspect: '1600 / 1198' },
            { src: '/img/alit/frame3.jpg', aspect: '1600 / 1195' },
            { src: '/img/alit/frame4.jpg', aspect: '1600 / 1199' },
        ],
    },
    jr: {
        title: 'Javelina Run',
        poster: '/img/posters/JR.jpg',
        frames: [
            '/img/jr/frame1.jpg',
            '/img/jr/frame2.jpg',
            '/img/jr/frame3.jpg',
            '/img/jr/frame4.jpg',
        ],
    },
    goh: {
        title: 'Guest of Honor',
        poster: '/img/posters/goh.jpg',
        frameAspect: '1600 / 670',
        frames: [
            '/img/goh/frame1.jpg',
            '/img/goh/frame2.jpg',
            '/img/goh/frame3.jpg',
            '/img/goh/frame4.jpg',
        ],
    },
    hc: {
        title: 'Hub City',
        framesOnly: true,
        frames: [
            '/img/hc/frame1.jpg',
            '/img/hc/frame2.jpg',
            '/img/hc/frame3.jpg',
            '/img/hc/frame4.jpg',
            '/img/hc/frame5.jpg',
            '/img/hc/frame6.jpg',
            '/img/hc/frame7.jpg',
            '/img/hc/frame8.jpg',
        ],
    },
    tll: {
        title: 'Texas Legacy in Lights',
        framesOnly: true,
        // 8 real stills — grid is full, no placeholders. (The 5th still
        // doubles as the narrative thumbnail.)
        frames: [
            '/img/tll/frame1.jpg',
            '/img/tll/frame2.jpg',
            '/img/tll/frame3.jpg',
            '/img/tll/frame4.jpg',
            '/img/tll/frame5.jpg',
            '/img/tll/frame6.jpg',
            '/img/tll/frame7.jpg',
            '/img/tll/frame8.jpg',
        ],
    },

    // Commercial & Documentary — frames restored for the 8 spots where
    // we have clean, non-text content. The other three (ford, bostin,
    // viceguide) stay player-only.
    comm_everydaydose: {
        title: 'Everyday Dose',
        frameAspect: '16 / 9',
        frames: [
            '/img/comm_everydaydose/frame1.jpg',
            '/img/comm_everydaydose/frame2.jpg',
            '/img/comm_everydaydose/frame3.jpg',
            '/img/comm_everydaydose/frame4.jpg',
        ],
    },
    comm_ford: { title: 'Ford Bronco TV Ad' },
    comm_wls: {
        title: 'Gold Best Cinematography Award',
        frameAspect: '1600 / 669',
        frames: [
            '/img/comm_wls/frame1.jpg',
            '/img/comm_wls/frame2.jpg',
            '/img/comm_wls/frame3.jpg',
            '/img/comm_wls/frame4.jpg',
        ],
    },
    comm_cwb: {
        title: 'Cowboys Without Borders',
        frameAspect: '1600 / 669',
        frames: [
            '/img/comm_cwb/frame1.jpg',
            '/img/comm_cwb/frame2.jpg',
            '/img/comm_cwb/frame3.jpg',
            '/img/comm_cwb/frame4.jpg',
        ],
    },
    comm_bostin: { title: 'Bostin Westin LED Wall' },
    comm_viceguide: { title: 'Vice Guide To Film' },
    comm_applovin: {
        title: 'AppLovin Halloween Ad',
        frameAspect: '16 / 9',
        frames: [
            '/img/comm_applovin/frame1.jpg',
            '/img/comm_applovin/frame2.jpg',
            '/img/comm_applovin/frame3.jpg',
            '/img/comm_applovin/frame4.jpg',
        ],
    },
    comm_josey: {
        title: 'Josey Records Ad #3',
        frameAspect: '16 / 9',
        frames: [
            '/img/comm_josey/frame1.jpg',
            '/img/comm_josey/frame2.jpg',
            '/img/comm_josey/frame3.jpg',
            '/img/comm_josey/frame4.jpg',
        ],
    },
    comm_goody: {
        title: 'Goody Goody TV Ad',
        frameAspect: '16 / 9',
        frames: [
            '/img/comm_goody/frame1.jpg',
            '/img/comm_goody/frame2.jpg',
            '/img/comm_goody/frame3.jpg',
            '/img/comm_goody/frame4.jpg',
        ],
    },
    comm_earthspeed: { title: 'Earth Speed' },
    comm_targetcool: {
        title: 'TargetCool Customer Journey',
        frameAspect: '16 / 9',
        frames: [
            '/img/comm_targetcool/frame1.jpg',
            '/img/comm_targetcool/frame2.jpg',
            '/img/comm_targetcool/frame3.jpg',
            '/img/comm_targetcool/frame4.jpg',
        ],
    },
    comm_samplereel: { title: 'Sample Work Playlist' },
};

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

// Scroll lock via overflow:hidden. The previous position:fixed + negative-top
// trick caused a one-frame paint shift on iOS when toggled off (the page
// briefly snapped to scroll=0 before window.scrollTo restored it), which
// looked like a flash plus a "page renders in a slightly different position"
// on every subsequent lightbox close. overflow:hidden preserves the scroll
// position natively so there's no restore step at all.
//
// The lightbox <dialog> itself eats touchmove/wheel inside its bounds
// (see addEventListener wiring further down), so background scroll-through
// from inside the dialog is still blocked.
function lockBody() {
    if (bodyLockCount++ > 0) return;
    // Only lock vertical scrolling — horizontal is already permanently
    // clipped via CSS (`html, body.cinematic { overflow-x: clip }`).
    // Touching `overflow` shorthand here would override the clip and
    // could leave horizontal scrolling enabled after unlock on browsers
    // that don't fully revert shorthand-set longhands.
    document.documentElement.style.overflowY = 'hidden';
    document.body.style.overflowY = 'hidden';
    // Compensate for the disappearing vertical scrollbar on desktop so the
    // page doesn't shift horizontally when locked.
    const sbw = window.innerWidth - document.documentElement.clientWidth;
    if (sbw > 0) document.body.style.paddingRight = `${sbw}px`;
    document.documentElement.classList.add('lightbox-open');
}
function unlockBody() {
    if (--bodyLockCount > 0) return;
    bodyLockCount = 0;
    document.documentElement.style.overflowY = '';
    document.body.style.overflowY = '';
    document.body.style.paddingRight = '';
    document.documentElement.classList.remove('lightbox-open');
    // Belt-and-braces: the close() block-handler suppresses our bubble-phase
    // horizontal-snap during the 450ms close window, and any momentum/smooth
    // scroll that crossed that boundary could leave scrollLeft non-zero. Snap
    // immediately, and again after the close transition completes.
    const snapX = () => {
        document.documentElement.scrollLeft = 0;
        if (document.body) document.body.scrollLeft = 0;
    };
    snapX();
    requestAnimationFrame(snapX);
    setTimeout(snapX, 500);
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
        this._videoOpen = null;
        // Tab-close survival: if the dialog is still open when the page
        // unloads, fire the duration beacon so we don't lose the data.
        window.addEventListener('pagehide', () => {
            if (this._videoOpen) {
                try {
                    const elapsed = performance.now() - this._videoOpen.t0;
                    sendVideoDuration(this._videoOpen.href, elapsed);
                } catch (_) {}
                this._videoOpen = null;
            }
        });
        this._buildDialog();
    }

    _buildDialog() {
        const dlg = document.createElement('dialog');
        dlg.className = 'lightbox';
        dlg.innerHTML = `
            <div class="lightbox__dim" aria-hidden="true"></div>
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
        // Backdrop blur layer — Safari can't transition properties on the
        // `::backdrop` pseudo-element reliably, but a regular DOM element
        // with `backdrop-filter` transitions cleanly. The element is a
        // popover so showPopover() promotes it into the top layer, which is
        // the only way to sit a blur element above a previously-opened
        // dialog (e.g. the still-frame zoom lightbox that opens FROM inside
        // the rich-panel lightbox — its blur layer needs to be above the
        // outer dialog, not just above the page). For the outer instance
        // this is still correct: popover top-layer sits below the dialog
        // that's opened immediately after, since top-layer ordering follows
        // insertion order.
        const blurLayer = document.createElement('div');
        blurLayer.className = 'lightbox__blur-layer';
        blurLayer.setAttribute('aria-hidden', 'true');
        blurLayer.setAttribute('popover', 'manual');
        document.body.appendChild(blurLayer);
        this.blurLayer = blurLayer;
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
        dlg.addEventListener('close', () => {
            // Fire the video-duration beacon HERE rather than only from
            // this.close(), so it runs on every dismiss path — close button,
            // backdrop click, Escape key, dismiss drag, programmatic close.
            // Without this, anything but a close-button click silently
            // dropped the duration (DB had 79 plays / 0 durations recorded).
            if (this._videoOpen) {
                try {
                    const elapsed = performance.now() - this._videoOpen.t0;
                    sendVideoDuration(this._videoOpen.href, elapsed);
                } catch (_) {}
                this._videoOpen = null;
            }
            // Belt-and-braces: ensure the blur layer fades out + leaves the
            // top layer on every dismiss path, including Escape and any
            // programmatic close that bypassed this.close(). this.close()
            // already removes the class up-front for the smooth out-fade
            // and schedules hidePopover() after the transition; this is
            // just a safety net for paths that bypass close().
            if (this.blurLayer) {
                const blur = this.blurLayer;
                blur.classList.remove('is-active');
                setTimeout(() => { try { blur.hidePopover(); } catch (_) {} }, 320);
            }
            this._cleanup();
        });
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
            // Same reason for rich-panel frame thumbnails: pointer-capture
            // would consume the click and the nested image lightbox never
            // opens on desktop (mobile uses touch, which we skip above).
            if (e.target.closest('.rich-frame[data-frame-index]')) return;
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

        // Promote the blur layer to the top layer FIRST, then open the
        // dialog. Top-layer ordering follows insertion: the blur layer
        // settles below the about-to-open dialog, and (importantly) above
        // any previously-open dialog — which is what makes the inner zoom
        // lightbox's blur layer correctly blur the outer rich-panel
        // lightbox.
        if (this.blurLayer) {
            try { this.blurLayer.showPopover(); } catch (_) {}
            this.blurLayer.classList.add('is-active');
        }
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
            this._videoOpen = { href: item.href, t0: performance.now() };
        } else {
            this._videoOpen = null;
        }
    }

    close() {
        if (!this.dialog.open) return;
        // Note: the video-duration beacon is fired from the dialog 'close'
        // event listener (in _buildDialog) rather than here, so it covers
        // EVERY dismiss path — close button, Escape, backdrop click,
        // programmatic dialog.close(), etc.
        this.dialog.classList.remove('is-open');
        if (this.blurLayer) this.blurLayer.classList.remove('is-active');
        this._stopSlideshow();
        // Tear the blur layer out of the top layer AFTER the fade-out
        // transition completes (280ms backdrop-filter + a small safety
        // margin). Doing this synchronously would snap the blur away
        // mid-fade. We coalesce with the existing close timeout so the
        // teardown happens together with dialog.close().
        const blur = this.blurLayer;
        if (blur) {
            setTimeout(() => {
                try { blur.hidePopover(); } catch (_) {}
            }, 320);
        }
        // Drive the backdrop blur back to zero via the existing --dismiss-progress transition
        this.dialog.style.setProperty('--dismiss-progress', '1');

        // Trackpad-momentum guard. Two layers:
        // - preventDefault on wheel/touchmove blocks discrete events from
        //   triggering scroll
        // - direct synchronous scrollTop snap-back catches anything that
        //   slips past preventDefault (Safari momentum-continuation events
        //   sometimes do). scrollTop assignment is synchronous and snaps
        //   before the next paint, so the user doesn't see a frame of bump
        //
        // We deliberately do NOT add overflow:hidden to html during this
        // window — that would break position: sticky on the header and
        // prevent its slide-back animation from playing.
        //
        // Lockout duration is touch-aware: on desktop the OS keeps
        // dispatching trackpad-momentum wheel events for ~600–1200ms after
        // fingers lift, so we hold for 1s. On touch devices, touchmoves
        // stop the instant the finger lifts — holding 1s there just makes
        // the page feel unresponsive ("can't scroll right after the
        // lightbox closes"), so we drop to a tight 280ms (just past the
        // 240ms close animation).
        const block = (e) => { e.preventDefault(); e.stopPropagation(); };
        window.addEventListener('wheel', block, { passive: false, capture: true });
        window.addEventListener('touchmove', block, { passive: false, capture: true });
        const lockedY = window.scrollY;
        const lockedX = window.scrollX;
        const snap = () => {
            if (window.scrollY !== lockedY) document.documentElement.scrollTop = lockedY;
            if (window.scrollX !== lockedX) document.documentElement.scrollLeft = lockedX;
        };
        window.addEventListener('scroll', snap, { passive: true, capture: true });
        const isTouch = matchMedia('(hover: none) and (pointer: coarse)').matches;
        setTimeout(() => {
            window.removeEventListener('wheel', block, { capture: true });
            window.removeEventListener('touchmove', block, { capture: true });
            window.removeEventListener('scroll', snap, { capture: true });
        }, isTouch ? 280 : 1000);

        // Matches the longest close-direction transition (panel opacity 220ms
        // + a small safety margin). Shorter than the legacy 360ms because the
        // close transitions were sped up to fix a Safari "dip to black" where
        // the dark dialog overlay lingered while the backdrop dim was still
        // clearing.
        setTimeout(() => {
            this.dialog.close();
            this.dialog.style.setProperty('--dismiss-progress', '0');
        }, 240);
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
            // Explicit rich config wins over the type-based path so titles
            // like Hub City (href="javascript:void(0)", which detectType
            // misclassifies as 'image') still render the rich frames-only
            // panel instead of a broken <img>.
            const hasExplicitRich = item.rich && RICH_CONFIG[item.rich];
            if (item.type === 'image' && !hasExplicitRich) {
                const img = document.createElement('img');
                img.className = 'lightbox__image';
                img.src = item.href;
                img.alt = item.alt || '';
                img.decoding = 'async';
                img.loading = 'lazy';
                img.draggable = false;
                panel.appendChild(img);
            } else if (item.type === 'iframe' || hasExplicitRich) {
                // Rich panel: trailer + (optional) poster + frame strip.
                // Every video lightbox in the site goes through this path so
                // we get consistent layout + placeholder frames across the
                // home page, narrative section, commercials, and every
                // secondary project page — even when no RICH_CONFIG entry
                // exists for the specific item.
                const cfg = (item.rich && RICH_CONFIG[item.rich]) || {};
                // Only render the still-frame strip when real frames are
                // configured. Titles without a RICH_CONFIG entry (e.g. the
                // Watch Reels playlist, every Colorist-section video) get
                // a player-only lightbox — no "Still N" placeholder tiles.
                const frames = Array.isArray(cfg.frames) ? cfg.frames : [];
                const parsed = parseVideoUrl(item.href);
                let playerHTML = '';
                if (parsed) {
                    playerHTML = buildPlayerMarkup({ ...parsed, poster: item.thumb, autoplay: !!item.autoplay });
                } else if (item.href && item.href !== 'javascript:void(0)' && !cfg.framesOnly) {
                    // Unparseable but real URL: fall back to a raw iframe
                    // inside the player slot so the rich layout still wraps
                    // it consistently.
                    playerHTML = `<iframe class="lightbox__iframe" src="${enhanceVideoSrc(item.href)}" title="Video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
                }
                // Omit the poster element entirely when none is configured —
                // the player then occupies the full top-row width. (Use an
                // explicit `poster: false`/missing key to indicate "no poster
                // for this title at all", not "poster pending".)
                const posterHTML = cfg.poster
                    ? `<img class="rich-poster" src="${cfg.poster}" alt="${(cfg.title || '') + ' poster'}">`
                    : '';
                // Each frame entry can be either a string (URL) or an object
                // `{ src, aspect }` for per-frame aspect overrides — used when
                // a film mixes aspect ratios within a single trailer and we
                // trim each still's letter/pillarbox individually.
                const framesHTML = frames.map((entry, i) => {
                    if (!entry) {
                        return `<li class="rich-frame rich-placeholder"><span>Still ${i + 1}</span></li>`;
                    }
                    const url = typeof entry === 'string' ? entry : entry.src;
                    const aspect = typeof entry === 'object' && entry.aspect ? entry.aspect : null;
                    const styleAttr = aspect ? ` style="aspect-ratio: ${aspect};"` : '';
                    return `<li class="rich-frame" data-frame-index="${i}"${styleAttr}><img src="${url}" alt="${(cfg.title || '') + ' still ' + (i + 1)}" loading="lazy"></li>`;
                }).join('');
                const richKey = item.rich || 'auto';
                panel.classList.add('lightbox__panel--rich', `rich-${richKey}`);
                // Per-movie frame aspect ratio. Default to the anamorphic
                // 1600/670 used by HoA + TCH; override per-config (e.g. 16/9
                // for ACINH) so each strip matches its source format and we
                // don't have to crop the stills.
                const frameAspect = cfg.frameAspect || '1600 / 670';
                // framesOnly: gallery-only panel (no top row, no player). Used
                // for titles without a trailer where the stills carry the
                // entire experience.
                const topHTML = cfg.framesOnly
                    ? ''
                    : `<div class="rich-top">
                           <div class="rich-player">${playerHTML}</div>
                           ${posterHTML}
                       </div>`;
                if (cfg.framesOnly) panel.classList.add('lightbox__panel--frames-only');
                const framesListHTML = frames.length
                    ? `<ul class="rich-frames" style="--frame-aspect: ${frameAspect};">${framesHTML}</ul>`
                    : '';
                if (!frames.length) panel.classList.add('lightbox__panel--no-frames');
                panel.innerHTML = `
                    <div class="rich-grid">
                        ${topHTML}
                        ${framesListHTML}
                    </div>`;
                this.stage.appendChild(panel);

                // Mobile-portrait layout helper for titles with too-tall a
                // right-column frame strip to share a row with the poster.
                // The LAST <li> is cloned into .rich-top (which becomes the
                // left column on mobile portrait via display: contents on
                // the parent). Cloning rather than moving keeps desktop /
                // tablet layout intact; CSS hides whichever copy isn't
                // relevant for the active breakpoint.
                if (['alit', 'acinh', 'attad'].includes(richKey) && frames.length > 0) {
                    const lastFrame = panel.querySelector('.rich-frames > li:last-child');
                    const framesUl = panel.querySelector('.rich-frames');
                    const richTop = panel.querySelector('.rich-top');
                    if (lastFrame && richTop) {
                        const moved = lastFrame.cloneNode(true);
                        moved.classList.add('rich-frame--moved');
                        // The original <li> reads its aspect-ratio from the
                        // parent UL's `--frame-aspect` CSS variable. Once
                        // cloned into .rich-top, that var is no longer in
                        // its inheritance chain, so set the aspect-ratio
                        // explicitly. Per-frame inline overrides (used by
                        // ALIT) are already on the cloned node — only set
                        // the fallback if there's no inline aspect already.
                        if (!moved.style.aspectRatio) {
                            const frameAspect = framesUl
                                ? framesUl.style.getPropertyValue('--frame-aspect').trim()
                                : '';
                            if (frameAspect) moved.style.aspectRatio = frameAspect;
                        }
                        richTop.appendChild(moved);
                    }
                }
                const upRoot = panel.querySelector('.up');
                if (upRoot) {
                    const adapter = mountPlayer(upRoot);
                    // Dim sibling elements (poster, button, frame strip) while
                    // the trailer is playing so the focus is on the video.
                    // Adapter emits play/pause/ended — toggle the panel class
                    // and let CSS handle the opacity transition.
                    if (adapter && adapter.on) {
                        adapter.on('play',  () => panel.classList.add('rich-playing'));
                        adapter.on('pause', () => panel.classList.remove('rich-playing'));
                        adapter.on('ended', () => panel.classList.remove('rich-playing'));
                    }
                }

                // Wire each real (non-placeholder) frame to open a nested
                // image-only lightbox showing the 4 stills as a gallery. The
                // outer rich lightbox stays mounted underneath; closing the
                // inner one returns the user to the trailer view.
                const realFrames = frames
                    .map((entry) => {
                        if (!entry) return null;
                        const href = typeof entry === 'string' ? entry : entry.src;
                        return { href, type: 'image', caption: '' };
                    })
                    .filter(Boolean);
                if (realFrames.length > 0) {
                    panel.querySelectorAll('.rich-frame[data-frame-index]').forEach((el) => {
                        el.style.cursor = 'zoom-in';
                    });
                    // Delegate on the panel rather than just `.rich-frames` —
                    // the mobile-portrait clone (`.rich-frame--moved` inside
                    // `.rich-top`) carries the same data-frame-index, but
                    // delegating on the UL would never catch its clicks. The
                    // panel scope catches both the original strip and the
                    // moved clone.
                    panel.addEventListener('click', (e) => {
                        const li = e.target.closest('.rich-frame[data-frame-index]');
                        if (!li || !panel.contains(li)) return;
                        e.preventDefault();
                        e.stopPropagation();
                        const frameIdx = parseInt(li.dataset.frameIndex, 10);
                        const entry = frames[frameIdx];
                        const url = typeof entry === 'string' ? entry : entry?.src;
                        const realIdx = realFrames.findIndex(f => f.href === url);
                        const inner = new Lightbox({ thumbs: false, fullscreen: false });
                        inner.setItems(realFrames);
                        inner.open(Math.max(0, realIdx));
                    });
                }
                return;
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
                    // mountPlayer (and therefore YT.Player / Vimeo.Player
                    // construction) is deferred until AFTER the panel is in
                    // the DOM — autoplay won't fire on iframes inserted
                    // detached and then attached, the user-activation window
                    // has already lapsed by the time the browser sees the
                    // iframe in the document.
                    this.stage.appendChild(panel);
                    mountPlayer(wrap.querySelector('.up'));
                    return;
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
        'a[data-lightbox], a[data-fancybox], a.sixteen-by-nine, a[class*="-by-nine"], a.stills-image, #reel-button a, #reel-glass-button, .thumbnails.lightbox a'
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
            rich: el.dataset.rich || null,
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
