<div class="container">
	<div class="return-message" href="#contact"></div>
	{{ Form::open(array("action"=>"HomeController@postContact")) }}
		{{ Form::text('name', null, array('required' => '', 'placeholder' => 'Your Name')) }}
		{{ Form::email("email", null , array('required' => '', 'placeholder' => 'Your Email Address')) }}
		{{ Form::textarea('message', null, array('required' => '', 'placeholder' => 'Your Message')) }}
		{{ Form::submit('Send Message');}}
	{{Form::close()}}
	<div class="text">
		<div class="representation">
			<h3>Representation</h3>
			<p><a href="http://therighteye.com/">The Right Eye Agency</a><br />
			41 Union Square West, Suite 1004<br />
			New York, NY 10003<br />
			212.924.8505</p>
		</div>
		<ul class="social">
			<li><a href="http://twitter.com/awalker47"><i class="ion-social-twitter"></i></a></li>
			<li><a href="https://fb.me/alexwalkerfilmmaker"><i class="ion-social-facebook"></i></a></li>
			<li><a href="http://instagram.com/alex_walker47"><i class="ion-social-instagram"></i></a></li>
			<li><a href="http://linkedin.com/in/alexanderiwalker"><i class="ion-social-linkedin"></i></a></li>
			<li><a href="https://vimeo.com/awalkerstudios"><i class="ion-social-vimeo"></i></a></li>
			<li><a href="https://www.youtube.com/user/WalkerStudios"><i class="ion-social-youtube"></i></a></li>
			<li><a href="https://plus.google.com/+AlexWalker"><i class="ion-social-googleplus"></i></a></li>
		</ul>
		<img class="representation-logo" src="/img/right-eye.png" />
	</div>
</div>
<div class="copyright">&copy; Alex Walker 2005-<?php echo date("Y"); ?></div>