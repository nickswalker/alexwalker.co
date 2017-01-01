class Scroller {

    /**
     * Initialize
     */
    constructor(doOnScroll) {
        window.addEventListener('scroll', this.onScroll.bind(this), {passive: true});
        this.latestKnownScrollY = 0;
        this.ticking = false;
        this.doOnScroll = doOnScroll;
    }

    onScroll() {
        this.latestKnownScrollY = window.scrollY;
        this.requestTick();
    }

    requestTick() {
        if( !this.ticking ) {
            window.requestAnimationFrame(this.doOnScroll.bind(this));
        }
        this.ticking = true;
    }

}