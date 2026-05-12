// Fade carousel with indicator clicks, auto-advance, and indicator progress bars.
// Pauses while the tab is hidden.

export class Carousel {
    constructor(root, options = {}) {
        this.root = typeof root === 'string' ? document.querySelector(root) : root;
        if (!this.root) return;

        this.items = Array.from(this.root.querySelectorAll('.carousel-inner > .item'));
        this.indicators = Array.from(this.root.querySelectorAll('.carousel-indicators > *'));
        if (!this.items.length) return;

        this.interval = options.interval || 5000;
        this.pauseOnHover = options.pauseOnHover !== false;
        this.indicatorProgress = options.indicatorProgress !== false;

        this.index = Math.max(0, this.items.findIndex(el => el.classList.contains('active')));
        // Sync indicator .active to the active item so CSS progress-bar shows on the right one
        this.items.forEach((it, i) => it.classList.toggle('active', i === this.index));
        this.indicators.forEach((ind, i) => ind.classList.toggle('active', i === this.index));

        this.timer = null;
        this.advanceStart = 0;

        this._setupProgressBars();
        this._bindEvents();
        this.start();
    }

    _setupProgressBars() {
        if (!this.indicatorProgress) return;
        this.indicators.forEach(ind => {
            if (!ind.querySelector('.progress-bar')) {
                const bar = document.createElement('div');
                bar.className = 'progress-bar';
                ind.appendChild(bar);
            }
        });
        this._resetProgressBars();
    }

    _resetProgressBars() {
        if (!this.indicatorProgress) return;
        this.indicators.forEach((ind, i) => {
            const bar = ind.querySelector('.progress-bar');
            if (!bar) return;
            bar.style.transition = 'none';
            bar.style.width = '0';
        });
        const activeBar = this.indicators[this.index]?.querySelector('.progress-bar');
        if (activeBar) {
            // Force reflow so the next transition takes effect
            void activeBar.offsetWidth;
            activeBar.style.transition = `width ${this.interval}ms linear`;
            activeBar.style.width = '100%';
        }
    }

    _bindEvents() {
        this.indicators.forEach((ind, i) => {
            ind.addEventListener('click', () => { this.goTo(i); });
        });

        document.addEventListener('visibilitychange', () => {
            document.hidden ? this.stop() : this.start();
        });

        if (this.pauseOnHover) {
            this.root.addEventListener('pointerenter', () => this.stop());
            this.root.addEventListener('pointerleave', () => this.start());
        }
    }

    goTo(idx) {
        idx = ((idx % this.items.length) + this.items.length) % this.items.length;
        if (idx === this.index) return;
        this.items[this.index].classList.remove('active');
        this.indicators[this.index]?.classList.remove('active');
        this.items[idx].classList.add('active');
        this.indicators[idx]?.classList.add('active');
        this.index = idx;
        this._resetProgressBars();
        this._scheduleNext();
    }

    next() { this.goTo(this.index + 1); }
    prev() { this.goTo(this.index - 1); }

    _scheduleNext() {
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        this.timer = setTimeout(() => this.next(), this.interval);
    }

    start() {
        if (this.timer) return;
        this._resetProgressBars();
        this._scheduleNext();
    }
    stop() {
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    }
}

// Randomize the carousel image order at load time.
// Looks for picture > source/source/img and swaps srcsets matching imageBase.
export function shuffleCarouselImages(root, imageBase = '/img/slider/', count = 5) {
    const inner = root.querySelector('.carousel-inner');
    if (!inner) return;
    const items = inner.children;
    const indices = Array.from({ length: count }, (_, i) => i + 1);
    // Fisher-Yates
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    Array.from(items).forEach((item, i) => {
        if (i >= indices.length) return;
        const n = indices[i];
        const picture = item.querySelector('picture');
        if (!picture) return;
        const sources = picture.querySelectorAll('source');
        const img = picture.querySelector('img');
        if (sources[0]) sources[0].srcset = `${imageBase}${n}-wide.jpg 3840w`;
        if (sources[1]) sources[1].srcset = `${imageBase}${n}.jpg 1920w, ${imageBase}${n}-super.jpg 3840w`;
        if (img) img.src = `${imageBase}${n}.jpg`;
    });
}
