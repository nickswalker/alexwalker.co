<!doctype html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, user-scalable=no">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">

	<meta name="author" content="Alex Walker">
	<meta name="description" content="Professional Director of Photography. See some of my work and hire me here."
	<meta name="keywords" content="Cinematographer,Director,Photography,Vision,Camera,Experienced,Professional">

	<link rel="shortcut icon" href="/favicon.png" />
	<link rel="apple-touch-icon-precomposed" href="/touch-icon.png" />
	<title>Alex Walker</title>

	{{ HTML::style('css/style.css') }}
	{{ HTML::style('packages/fancybox/jquery.fancybox.css') }}
	<script src="//ajax.googleapis.com/ajax/libs/jquery/2.1.1/jquery.min.js"></script>
	<link href='http://fonts.googleapis.com/css?family=Open+Sans:300,300italic,400,600,700' rel='stylesheet' type='text/css'>
	<script src="//cdnjs.cloudflare.com/ajax/libs/jquery-easing/1.3/jquery.easing.min.js"></script>
	<script src="//cdnjs.cloudflare.com/ajax/libs/fancybox/2.1.5/jquery.fancybox.min.js"></script>
	<script src="//cdnjs.cloudflare.com/ajax/libs/fancybox/2.1.5/helpers/jquery.fancybox-media.js"></script>

	{{ HTML::script('js/viewport-units-buggyfill.js') }}
	<script>window.viewportUnitsBuggyfill.init();</script>
	{{ HTML::script('js/waypoints.min.js') }}
	{{ HTML::script('js/slider.js') }}
	{{ HTML::script('js/contact.js') }}
	{{ HTML::script('js/scripts.js') }}

</head>
<body>
	@include('layout.slide', array('wrap'=>'slider', 'number'=>'1'))
	@include('header')
	@include('news')
	@include('layout.slide', array('wrap'=>'about', 'number'=>'2'))
	@include('layout.slide', array('wrap'=>'stills', 'number'=>'3'))
	@include('layout.slide', array('wrap'=>'cinematographer', 'number'=>'4'))
	@include('layout.slide', array('wrap'=>'colorist', 'number'=>'5'))
	@include('layout.slide', array('wrap'=>'tutorials', 'number'=>'6'))
	@include('layout.slide', array('wrap'=>'contact', 'number'=>'7'))
	<script type="text/javascript">
		$('.ticker li').addClass("hidden");
	 	jQuery(document).ready(function ($) {

			$(window).load(function() {
				$('.ticker li').each(function(i) {

					setTimeout(function (li) {
			            li.removeClass("hidden");
			        }, 500 * i, $(this));

				});

				$('.stills-image').fancybox({
					padding : 0,
					helpers : {
			            title : null
			        }
				});
				$('header .reveal').click(function(){
					$header = $("header");
					if($header.hasClass("collapsed")){
						$header.removeClass("collapsed");
					}
					else{
						$('header').addClass("collapsed");
					}
				});
				$('#news .reveal').click(function(){
					$ticker = $(".ticker");
					if($ticker.hasClass("collapsed")){
						$ticker.removeClass("collapsed");
					}
					else{
						$ticker.addClass("collapsed");
					}
				});
				$('#cinematographer ul li a').fancybox({
						autoSize: true,
						width: 1300,
						height: 550,
						padding: 0,
						aspectRatio : true,
						helpers : {
							media : {}
						},
						iframe : {
							preload: false
						}
					});
				$('#cinematographer ul li a.sixteen-by-nine, #tutorials ul .sixteen-by-nine').fancybox({
					autoSize: true,
					width: 1600,
					height: 900,
					padding: 0,
					aspectRatio : true,
					helpers : {
						media : {}
					}
				});
				$('#colorist a.sixteen-by-nine').fancybox({
					autoSize: true,
					width: 1600,
					height: 900,
					padding: 0,
					helpers : {
						media : {}
					},
					iframe : {
							preload: false
						}
				});
			});
		});
</script>
<script>
  (function(i,s,o,g,r,a,m){i['GoogleAnalyticsObject']=r;i[r]=i[r]||function(){
  (i[r].q=i[r].q||[]).push(arguments)},i[r].l=1*new Date();a=s.createElement(o),
  m=s.getElementsByTagName(o)[0];a.async=1;a.src=g;m.parentNode.insertBefore(a,m)
  })(window,document,'script','//www.google-analytics.com/analytics.js','ga');

  ga('create', 'UA-32836069-1', 'auto');
  ga('send', 'pageview');

</script>
</body>
</html>
