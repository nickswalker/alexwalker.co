$(function () {
    const $htmlBody = $("html,body");
    const $toBlur = $('#slider-container');
    let wHeight  = $(window).height();

    $(window).on('resize', function(){
        wHeight = $(window).height();
    });

    function goToByScroll(element) {
        $htmlBody.animate({
            scrollTop: element.offset().top
        }, 400, 'easeInOutQuint');
    }

    function onScroll(e) {
        const target = $(e.target);
        $returnToTop.stop();
        if (target.scrollTop() >= wHeight * 1.5) {        // If page is scrolled more than 50px
            $returnToTop.fadeIn(400);    // Fade in the arrow
        } else {
            $returnToTop.fadeOut(400);   // Else fade out the arrow
        }
        $scrollDownIndicator.stop();
        if (target.scrollTop() >= wHeight * 0.5) {
            $scrollDownIndicator.fadeTo(200, 0.1);
            $scrollDownIndicator.css("pointer-events", "none");
        } else {
            $scrollDownIndicator.fadeTo(200, 0.5);
            $scrollDownIndicator.css("pointer-events", "all");
        }
    }

    function blurOnScroll() {
        const currentScrollY = this.latestKnownScrollY;
        this.ticking = false;
        const percentage = currentScrollY / wHeight;
        const opacity = percentage - 0.3;
        const blurRadius = Math.max((percentage - 0.3)  * 25, 0);
        $toBlur.css({
            'opacity' : 1.0 - opacity,
            '-webkit-filter' : 'blur('+ blurRadius + 'px)',
            'filter' : 'blur('+ blurRadius + 'px)'
        });
    }
    // Smooth scroll-to
    const links = $('.smooth-scroll');

	//Handle clicks on elements that send to other parts of the page
    links.click(function (e) {
        e.preventDefault();
        if (!e.currentTarget.hash) {
            return;
        }
        const element = $(e.currentTarget.hash);
        if (element) {
            goToByScroll(element);
        }
    });

    // Scroll down indicator
    const $scrollDownIndicator = $("#scroll-down-indicator");
    // Display none by default
    $scrollDownIndicator.show();

    // Scroll to top button
    const $returnToTop = $('#return-to-top');
    // Passive scroll handler
    window.addEventListener('scroll', onScroll.bind(this), {passive: true});

    //Setup contact ajax
    const contact = new Contact( $("#contact form"), $(".return-message"));

	$("body").on("click","#contact input[type='submit']", function(event){
		event.preventDefault();
		contact.sendEmail();
	});

	// Blur scrolling
	const blurScroller = new Scroller(blurOnScroll);

    // Keep the copyright up to date.
    document.getElementById("copyright-current-year").innerHTML = new Date().getFullYear().toString();

    // Carousel

    const $carouselContainer = $('#slider-container');

    // Initialize carousel
    $carouselContainer.carousel(
        // Don't pause on hover
        {"pause": null}
        );
    const slideTime = 5000;
    const $firstIndicator = $(".carousel-indicators > [data-slide-to='0']");
    $firstIndicator.animate({"opacity": 0.0}, slideTime, "linear");
    // Customize carousel

    $carouselContainer.on('slide.bs.carousel', function (event) {
        const paused = $carouselContainer.hasClass("paused");
        // New slide reached
        if (!paused) {
            const targetIndex = $(event.relatedTarget).data("index");
            const $allIndicators = $carouselContainer.find(".carousel-indicators > *");
            $allIndicators.each(function(index, element){
                $(element).stop();
                $(element).css({"opacity": 1.0});
            });
            const $currentIndicator = $carouselContainer.find(".carousel-indicators > [data-slide-to='" +targetIndex +"']");
            $currentIndicator.animate({"opacity": 0.0}, slideTime, "linear");

        }
    });


});