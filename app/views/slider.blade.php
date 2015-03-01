
<div id="slider-container" >
@foreach ($images as $image)
	<div style="background-image:url('/img/slider/{{ $image['basename'] }}'); background-image: -webkit-image-set(
	url('/img/slider/{{ $image['basename'] }}') 1x, 
	url('/img/slider-super/{{ $image['basename'] }}') 2x
	)"></div>
@endforeach
 </div>


