
<div id="slider-container" >
    <?php $horizontal_percentages = [20,30,20,20,100];
        $counter = 0; ?>
@foreach ($images as $image)
	<div style="background-image:url('/img/slider/{{ $image['basename'] }}'); background-image: -webkit-image-set(
	url('/img/slider/{{ $image['basename'] }}') 1x,
	url('/img/slider-super/{{ $image['basename'] }}') 2x
	);background-position-x: {{ $horizontal_percentages[$counter]}}%"></div>
	<?php $counter++ ?>
@endforeach
 </div>


