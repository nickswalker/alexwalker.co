<div class="container">
	<ul class="stills">
	@foreach ($stills as $still)

		<li>
			{{-- Gotta lose the whitespace or the elements won't be marginless!--}}
			<a href="/img/stills/{{ $still['basename'] }}" class="stills-image" rel="stills">

			<?php
				$thumbnailPath = 'img/stills-thumbs/'.$still["basename"];
				$thumbnailURL = '/img/stills-thumbs/'.$still["basename"];
				$thumbnailSuperURL = '/img/stills-thumbs-super/'.$still["basename"];
if ( file_exists( realpath($thumbnailPath) ) ){
	echo ('<img src="'.$thumbnailURL.'" srcset="'.$thumbnailURL.' 1x, '. $thumbnailSuperURL .' 2x " />');}
else {echo ('<img src="/img/stills/'.$still["basename"].'"/>');}?></a>
		</li>

	@endforeach
	</ul>

</div>
