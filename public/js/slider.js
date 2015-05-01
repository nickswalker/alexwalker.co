//Get width of Slider Container and set li width to this on every window resize if possible (at load is fine too)
function Slider ( container) {
	this.current = 0,
	this.$slider = container,
	this.$sliderList = container.children("div"),
	this.maxIndex = this.$sliderList.length-1,
	this.timerIsRunning = false,
	this.timer;
	this.animationTime = 5000; //Doesn't work when passed in the right place for some reason

	this.start();


	//Initialize to random slide
	this.shift( Math.round(Math.random()* this.maxIndex) )
}

Slider.prototype.shift = function(target)	{
	if (target < 0){
		target = 0;
	}
	if (target > this.maxIndex){
		target = 0;
	}

	this.$sliderList.removeClass("current");
	$target = $(this.$sliderList.get(target))
	$target.addClass("current");

	this.current = target;
};


Slider.prototype.timerCallback = function ()	{
	this.shift(this.current+1);
}
Slider.prototype.pause = function(){
	clearInterval(this.timer);
	this.timerIsRunning=false;
}
Slider.prototype.start = function ()	{
	var self = this;
	clearInterval(this.timer);
	this.timer = setInterval( function (){
		self.timerCallback.call(self);
	}, 4000 );

	this.timerIsRunning=true;
}