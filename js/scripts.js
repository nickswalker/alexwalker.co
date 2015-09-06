function goToByScroll(dataslide) {
    htmlbody = $('html,body');
    htmlbody.animate({
        scrollTop: $('section[data-slide="' + dataslide + '"]').offset().top
    }, 400, 'easeInOutQuint');
}

jQuery(document).ready(function ($) {
	//Setup slider
	var slider = new Slider ( $('#slider-container') );

	//Toggle dark mode on the header for the news section
	var header = $("header");
	var sliderElement = $("#slider");
	sliderElement.waypoint({
	handler: function(event, direction){
		if (direction === "down"){
			slider.pause();
		} else {
			slider.start();
		}
	},
	offset: "-10%"
	});

    var links = $('a[data-slide]');

	//Handle clicks on elements that send to other parts of the page
    links.click(function (e) {
        e.preventDefault();
        dataslide = $(this).attr('data-slide');
        goToByScroll(dataslide);
    });


    //Setup contact ajax
    var contact = new Contact( $("#contact form"), $(".return-message"));

	$("body").on("click","#contact input[type='submit']", function(event){
		event.preventDefault();
		contact.sendEmail();
	});

});