function adjustSliderSize(){

/*
	var sliderContainer = $("#slider-container");
	console.log("adjusting to "+ sliderContainer.children("div:first-child").css("height"));
    var viewportWidth = $(window).width();
    if (viewportWidth <= 900){
    	var targetHeight = sliderContainer.children("div:first-child").css("height");
	   sliderContainer.css("height", targetHeight);
    }
    else{
	    sliderContainer.css("height", "inherit");
    }
*/
}

function goToByScroll(dataslide) {
    htmlbody = $('html,body');
    htmlbody.animate({
        scrollTop: $('section[data-slide="' + dataslide + '"]').offset().top
    }, 400, 'easeInOutQuint');
}

jQuery(document).ready(function ($) {
	//Register resize listener
	window.onresize = adjustSliderSize;
	
	//Setup slider
	var slider = new Slider ( $('#slider-container') );


	//Toggle dark mode on the header for the news section
	var header = $("header");
	var news = $("#news");
	news.waypoint({
	handler: function(event, direction){
		if (direction === "down"){
			header.removeClass("dark")
			slider.pause();
		}
		else{
			header.addClass("dark")
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
	
    //Lazy loading
    /*
$("img.lazy").lazyload({
		effect : "fadeIn"
	});
*/
    
    //Setup contact ajax
    var contact = new Contact( $("#contact form"), $(".return-message"));
    
	$("body").on("click","#contact input[type='submit']", function(event){
		event.preventDefault();
		contact.sendEmail();
	});
	window.onload = adjustSliderSize;


});