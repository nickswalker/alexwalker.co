// Uniform video player UI — wraps YouTube and Vimeo iframes with the same
// custom controls, lazy-loads each provider's JS API on first use, and
// keeps the iframe out of the DOM until the user actually presses play
// (so the provider's default thumbnail never replaces our custom poster).
//
// Usage: build a `.up` element with `data-provider`, `data-id`, optional
// `data-hash` (Vimeo) and `data-poster`. Then call `mountPlayer(rootEl)`.
//
// Public API:
//   buildPlayerMarkup({ provider, id, hash, poster }) → string of HTML
//   mountPlayer(rootEl) → wires up the controls + adapter
//   loadYouTubeApi() / loadVimeoApi() → preload the APIs (optional)

const YT_API_SRC = 'https://www.youtube.com/iframe_api';
const VIMEO_API_SRC = 'https://player.vimeo.com/api/player.js';

let ytReady = null;
let vimeoReady = null;

export function loadYouTubeApi() {
    if (ytReady) return ytReady;
    ytReady = new Promise((resolve) => {
        if (window.YT && window.YT.Player) { resolve(); return; }
        // YouTube's API calls this global when ready.
        const prev = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
            if (typeof prev === 'function') prev();
            resolve();
        };
        const s = document.createElement('script');
        s.src = YT_API_SRC;
        s.async = true;
        document.head.appendChild(s);
    });
    return ytReady;
}

export function loadVimeoApi() {
    if (vimeoReady) return vimeoReady;
    vimeoReady = new Promise((resolve) => {
        if (window.Vimeo && window.Vimeo.Player) { resolve(); return; }
        const s = document.createElement('script');
        s.src = VIMEO_API_SRC;
        s.async = true;
        s.onload = () => resolve();
        document.head.appendChild(s);
    });
    return vimeoReady;
}

// Parse an embed URL into {provider, id, list, hash}. Returns null if the
// URL isn't a recognised YouTube or Vimeo embed.
export function parseVideoUrl(href) {
    if (!href) return null;
    try {
        const u = new URL(href, window.location.origin);
        const host = u.hostname.toLowerCase();
        if (/youtu\.be$/.test(host)) {
            const id = u.pathname.replace(/^\//, '').split('/')[0];
            return id ? { provider: 'youtube', id } : null;
        }
        if (/youtube\.com$/.test(host)) {
            // Playlist embed: /embed/videoseries?list=PLxxx
            if (/\/embed\/videoseries/.test(u.pathname)) {
                const list = u.searchParams.get('list');
                return list ? { provider: 'youtube', list } : null;
            }
            // /embed/<id>?list=<id>  (single video that initiates a playlist)
            const embedMatch = u.pathname.match(/\/embed\/([^/?#]+)/);
            if (embedMatch) {
                const id = embedMatch[1];
                const list = u.searchParams.get('list');
                return list ? { provider: 'youtube', id, list } : { provider: 'youtube', id };
            }
            // /watch?v=<id>
            const v = u.searchParams.get('v');
            if (v) return { provider: 'youtube', id: v, list: u.searchParams.get('list') || undefined };
        }
        if (/vimeo\.com$/.test(host) || /player\.vimeo\.com$/.test(host)) {
            const m = u.pathname.match(/\/video\/(\d+)/) || u.pathname.match(/^\/(\d+)/);
            if (m) {
                return {
                    provider: 'vimeo',
                    id: m[1],
                    hash: u.searchParams.get('h') || undefined,
                };
            }
        }
    } catch (_) {}
    return null;
}

function fmt(sec) {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

// iOS Safari detection (also catches iPadOS reporting as MacIntel-with-touch).
const IS_IOS = typeof navigator !== 'undefined' && (
    /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
);

class YouTubeAdapter {
    constructor(container, { id, list }) {
        this.container = container;
        this.videoId = id;
        this.playlistId = list;
        this.listeners = {};
        this.player = null;
        this._ready = new Promise((resolve) => { this._resolveReady = resolve; });
    }
    _ensureIframe() {
        if (this.player) return;
        const slot = document.createElement('div');
        this.container.appendChild(slot);
        loadYouTubeApi().then(() => {
            const playerVars = {
                // On iOS we surface YouTube's own controls — their fullscreen
                // button is the only path to true native iOS FS for an iframe
                // embed. Desktop/Android keep our uniform custom chrome.
                controls: IS_IOS ? 1 : 0,
                modestbranding: 1, rel: 0,
                iv_load_policy: 3, disablekb: 1, playsinline: 1,
                fs: IS_IOS ? 1 : 0, autoplay: 1,
                // Muted-autoplay is universally allowed by browsers. We
                // load muted so the video starts INSTANTLY (no "click to
                // play" overlay), then unmute the moment the first 'play'
                // state fires. Audible playback resumes within ~50ms,
                // imperceptible to the user, and the YouTube pause overlay
                // never gets a chance to render.
                mute: 1,
                origin: window.location.origin,
            };
            const config = {
                playerVars,
                events: {
                    onReady: () => { this._resolveReady(); this._startTick(); },
                    onStateChange: (e) => {
                        if (e.data === YT.PlayerState.PLAYING) {
                            // Auto-unmute the first time we hit PLAYING.
                            if (this._startMuted) {
                                this._startMuted = false;
                                try { this.player.unMute(); } catch (_) {}
                            }
                            this._emit('play');
                        }
                        else if (e.data === YT.PlayerState.PAUSED) this._emit('pause');
                        else if (e.data === YT.PlayerState.ENDED) this._emit('ended');
                    },
                },
            };
            this._startMuted = true;
            if (this.playlistId) {
                playerVars.listType = 'playlist';
                playerVars.list = this.playlistId;
            } else if (this.videoId) {
                config.videoId = this.videoId;
            }
            this.player = new YT.Player(slot, config);
        });
    }
    _startTick() {
        const tick = () => {
            if (!this.player) return;
            this._emit('timeupdate', {
                currentTime: this.player.getCurrentTime ? this.player.getCurrentTime() : 0,
                duration:    this.player.getDuration ? this.player.getDuration() : 0,
                buffered:    this.player.getVideoLoadedFraction ? this.player.getVideoLoadedFraction() : 0,
            });
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }
    on(event, fn) { (this.listeners[event] ||= []).push(fn); }
    _emit(event, data) { (this.listeners[event] || []).forEach(fn => fn(data)); }
    async play()      { this._ensureIframe(); await this._ready; this.player.playVideo(); }
    async pause()     { await this._ready; this.player.pauseVideo(); }
    async seek(sec)   { await this._ready; this.player.seekTo(sec, true); }
    async setMuted(b) { await this._ready; b ? this.player.mute() : this.player.unMute(); }
    async getMuted()  { await this._ready; return this.player.isMuted(); }
    getDuration()     { return this.player ? this.player.getDuration() : 0; }
    // iOS fullscreen for YouTube — no native path exists (YouTube IFrame API
    // doesn't expose fullscreen, and rebuilding the iframe sans playsinline
    // either fails autoplay restrictions or surfaces YouTube's own controls
    // on top of ours). Caller (mountPlayer) handles iOS YouTube via a CSS
    // pseudo-fullscreen on the .up root — the player fills the viewport with
    // our custom chrome intact, no provider UI collisions.
    iosFullscreen() { return false; }
    teardown() {
        try { this.player && this.player.destroy && this.player.destroy(); } catch (_) {}
        this.player = null;
    }
}

class VimeoAdapter {
    constructor(container, videoId, hash, { eager = false } = {}) {
        this.container = container;
        this.videoId = videoId;
        this.hash = hash;
        this.eager = eager;            // load the iframe immediately so the
                                       // platform's thumbnail is visible
                                       // without waiting for a click
        this.listeners = {};
        this._duration = 0;
        this.player = null;
        this._ready = new Promise((resolve) => { this._resolveReady = resolve; });
        if (eager) this._ensureIframe();
    }
    _ensureIframe() {
        if (this.player) return;
        const slot = document.createElement('div');
        this.container.appendChild(slot);
        loadVimeoApi().then(() => {
            this.player = new Vimeo.Player(slot, {
                id: this.videoId,
                h: this.hash || undefined,
                // iOS uses Vimeo's own UI — only path to native iOS FS for
                // an iframe embed is the provider's internal fullscreen call
                // (Vimeo's FS button triggers webkitEnterFullscreen on the
                // underlying <video>, which is the actual fullscreen iOS
                // hides the URL bar for). Desktop/Android keep our custom
                // uniform chrome via controls: false.
                controls: IS_IOS, title: false, byline: false, portrait: false,
                playsinline: true, dnt: true, responsive: true,
                autoplay: !this.eager,
            });
            this.player.ready().then(() => this._resolveReady());
            this.player.on('play',  () => this._emit('play'));
            this.player.on('pause', () => this._emit('pause'));
            this.player.on('ended', () => this._emit('ended'));
            this.player.on('timeupdate', (e) => {
                this._duration = e.duration;
                this._emit('timeupdate', {
                    currentTime: e.seconds,
                    duration: e.duration,
                    buffered: e.percent,
                });
            });
            this.player.getDuration().then(d => { this._duration = d; });
        });
    }
    on(event, fn) { (this.listeners[event] ||= []).push(fn); }
    _emit(event, data) { (this.listeners[event] || []).forEach(fn => fn(data)); }
    async play()      { this._ensureIframe(); await this._ready; this.player.play(); }
    async pause()     { await this._ready; this.player.pause(); }
    async seek(sec)   { await this._ready; this.player.setCurrentTime(sec); }
    async setMuted(b) { await this._ready; this.player.setMuted(b); }
    async getMuted()  { await this._ready; return this.player.getMuted(); }
    getDuration()     { return this._duration; }
    // Vimeo's Player.js implements requestFullscreen() with an iOS path that
    // calls webkitEnterFullscreen on the underlying <video>. Must be called
    // SYNCHRONOUSLY from the gesture handler so user activation survives.
    // Returns true to signal the click handler that the FS request was
    // dispatched and no further fallback is needed.
    iosFullscreen() {
        this._ensureIframe();
        if (this.player && typeof this.player.requestFullscreen === 'function') {
            try { this.player.requestFullscreen(); } catch (_) {}
        } else {
            this._ready.then(() => {
                try { this.player.requestFullscreen(); } catch (_) {}
            });
        }
        return true;
    }
    teardown() {
        try { this.player && this.player.destroy && this.player.destroy(); } catch (_) {}
        this.player = null;
    }
}

const PLAY_SVG  = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE_SVG = '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
const VOL_SVG   = '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>';
const MUTE_SVG  = '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm14 .7L15.3 8 13 10.3 10.7 8 9 9.7 11.3 12 9 14.3 10.7 16 13 13.7 15.3 16 17 14.3 14.7 12z"/></svg>';
const FS_SVG    = '<svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>';

export function buildPlayerMarkup({ provider, id, list, hash, poster, autoplay }) {
    const posterAttr = poster ? ` data-poster="${poster}"` : '';
    const hashAttr = hash ? ` data-hash="${hash}"` : '';
    const listAttr = list ? ` data-list="${list}"` : '';
    const idAttr = id ? ` data-id="${id}"` : '';
    const autoplayAttr = autoplay ? ' data-autoplay="1"' : '';
    const posterImg = poster
        ? `<img class="up__poster" src="${poster}" alt="" aria-hidden="true">`
        : '';
    return `
<div class="up" data-provider="${provider}"${idAttr}${listAttr}${hashAttr}${posterAttr}${autoplayAttr} data-state="paused">
  ${posterImg}
  <div class="up__embed"></div>
  <div class="up__hit" aria-hidden="true"></div>
  <div class="up__big-play" aria-hidden="true">${PLAY_SVG}</div>
  <div class="up__spinner" aria-hidden="true"></div>
  <div class="up__chrome">
    <div class="up__scrub" role="slider" aria-label="Seek">
      <div class="up__scrub-buffer"></div>
      <div class="up__scrub-progress"></div>
      <div class="up__scrub-knob"></div>
    </div>
    <div class="up__toolbar">
      <button class="up__btn up__btn--playpause" aria-label="Play/pause">
        <span class="icon-play">${PLAY_SVG}</span>
        <span class="icon-pause" style="display:none">${PAUSE_SVG}</span>
      </button>
      <button class="up__btn up__btn--mute" aria-label="Mute">
        <span class="icon-vol">${VOL_SVG}</span>
        <span class="icon-muted" style="display:none">${MUTE_SVG}</span>
      </button>
      <span class="up__time"><span class="up__cur">0:00</span> / <span class="up__dur">0:00</span></span>
      <span class="up__spacer"></span>
      <button class="up__btn up__btn--fs" aria-label="Fullscreen">${FS_SVG}</button>
    </div>
  </div>
</div>`.trim();
}

export function mountPlayer(root) {
    if (root.dataset.upMounted === '1') return null;
    root.dataset.upMounted = '1';

    const provider = root.dataset.provider;
    const id = root.dataset.id;
    const list = root.dataset.list;
    const hash = root.dataset.hash;
    const embedHost = root.querySelector('.up__embed');
    const hit = root.querySelector('.up__hit');
    const scrub = root.querySelector('.up__scrub');
    const scrubProgress = root.querySelector('.up__scrub-progress');
    const scrubBuffer = root.querySelector('.up__scrub-buffer');
    const scrubKnob = root.querySelector('.up__scrub-knob');
    const playBtn = root.querySelector('.up__btn--playpause');
    const muteBtn = root.querySelector('.up__btn--mute');
    const fsBtn = root.querySelector('.up__btn--fs');
    const chromeEl = root.querySelector('.up__chrome');
    const isIOS = IS_IOS;
    // iOS YouTube: YouTube's native controls (controls=1) carry the only path
    // to true iOS fullscreen. Hide our chrome so we don't double-up UIs, and
    // let the iframe receive taps so the user can reach YouTube's controls.
    // Pre-playback our poster + big-play still cover the iframe (lazy load),
    // so the "hidden until playback" pre-roll look is preserved.
    // iOS for either provider: the provider's own controls are the only path
    // to true native iOS fullscreen, so we surface them and stand down our
    // custom chrome to avoid double UIs. Pre-playback our poster + big-play
    // still cover the iframe (lazy YT load, or eager Vimeo with poster atop).
    if (isIOS && (provider === 'youtube' || provider === 'vimeo')) {
        if (chromeEl) chromeEl.hidden = true;
        if (fsBtn) fsBtn.hidden = true;
        root.classList.add('up--ios-native-controls');
    }
    const curEl = root.querySelector('.up__cur');
    const durEl = root.querySelector('.up__dur');
    const iconPlay = playBtn.querySelector('.icon-play');
    const iconPause = playBtn.querySelector('.icon-pause');
    const iconVol = muteBtn.querySelector('.icon-vol');
    const iconMuted = muteBtn.querySelector('.icon-muted');

    // For Vimeo without a local poster, eager-load the iframe so the user
    // sees Vimeo's own thumbnail immediately. YouTube always lazy-loads.
    const hasPoster = !!root.querySelector('.up__poster');
    const adapter = provider === 'youtube'
        ? new YouTubeAdapter(embedHost, { id, list })
        : new VimeoAdapter(embedHost, id, hash, { eager: !hasPoster });

    let lastDuration = 0;
    const setState = (s) => { root.dataset.state = s; };
    const setPlaying = (p) => {
        iconPlay.style.display = p ? 'none' : '';
        iconPause.style.display = p ? '' : 'none';
        setState(p ? 'playing' : 'paused');
    };
    const setMutedUI = (m) => {
        iconVol.style.display = m ? 'none' : '';
        iconMuted.style.display = m ? '' : 'none';
    };

    adapter.on('play', () => {
        setPlaying(true);
        root.classList.add('is-loaded');
    });
    adapter.on('pause', () => setPlaying(false));
    adapter.on('ended', () => { setPlaying(false); setState('ended'); });
    adapter.on('timeupdate', ({ currentTime, duration, buffered }) => {
        if (duration && duration !== lastDuration) {
            lastDuration = duration;
            durEl.textContent = fmt(duration);
        }
        const pct = duration ? (currentTime / duration) * 100 : 0;
        scrubProgress.style.width = pct + '%';
        scrubKnob.style.left = pct + '%';
        scrubBuffer.style.width = ((buffered || 0) * 100) + '%';
        curEl.textContent = fmt(currentTime);
    });

    const requestPlay = () => {
        // Only show OUR spinner when there's no iframe yet (lazy-load gap).
        // If the iframe already exists (e.g. eager-loaded Vimeo), the
        // provider's own loading visual handles the gap and our spinner
        // would just overlap their UI.
        const iframeAlreadyMounted = !!embedHost.querySelector('iframe');
        if (root.dataset.state !== 'playing' && !iframeAlreadyMounted) setState('loading');
        adapter.play();
    };
    const togglePlay = (e) => {
        if (e) e.stopPropagation();
        if (root.dataset.state === 'playing') adapter.pause();
        else requestPlay();
    };

    hit.addEventListener('click', () => togglePlay());
    playBtn.addEventListener('click', togglePlay);
    muteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const m = await adapter.getMuted();
        adapter.setMuted(!m);
        setMutedUI(!m);
    });
    fsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (root.classList.contains('is-pseudo-fs')) {
            root.classList.remove('is-pseudo-fs');
            document.documentElement.classList.remove('lightbox-up-pseudo-fs');
            return;
        }
        if (document.fullscreenElement) {
            document.exitFullscreen();
            return;
        }
        if (isIOS) {
            // Vimeo iOS: CSS pseudo-fullscreen — fullscreening the iframe via
            // Vimeo's player.requestFullscreen hid our chrome (controls:false
            // gives Vimeo nothing to show either). Pseudo-FS keeps our chrome.
            // YouTube iOS: this code path doesn't run (button is hidden — user
            // hits YouTube's own fullscreen button inside their native chrome).
            root.classList.add('is-pseudo-fs');
            document.documentElement.classList.add('lightbox-up-pseudo-fs');
            return;
        }
        if (root.requestFullscreen) root.requestFullscreen();
        else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
    });
    scrub.addEventListener('click', (e) => {
        const r = scrub.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        const d = adapter.getDuration() || lastDuration;
        if (d) adapter.seek(pct * d);
    });
    root.addEventListener('touchstart', () => {
        root.classList.add('is-touching');
        clearTimeout(root._touchTimer);
        root._touchTimer = setTimeout(() => root.classList.remove('is-touching'), 2500);
    }, { passive: true });

    // Opt-in autoplay (data-autoplay="1"). Used by the Watch Reels button
    // where the user has already signalled "play this" by clicking the
    // top-level CTA — having to click again on the lightbox is redundant.
    if (root.dataset.autoplay === '1') {
        requestPlay();
    }

    return adapter;
}
