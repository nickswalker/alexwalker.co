
<div id="slider-container" >

@for ($i = 0; $i < count($images); $i++)
    <?php $image = $images[$i] ?>
	<div style="background-image:url('/img/slider/{{ $image['basename'] }}'); background-image: -webkit-image-set(
	url('/img/slider/{{ $image['basename'] }}') 1x,
	url('/img/slider-super/{{ $image['basename'] }}') 2x
	);" class="image-{{1+$i}}"></div>
@endfor
 </div>


