<div id="news" class="container">
	<div class="ticker collapsed">
		<h2>News</h2>
		<div class="reveal"><a></a></div>
		<ul>
		@foreach ($newsitems as $newsitem)
		<li>
			{{ $newsitem->text}} <time pubdate="{{ $newsitem->date}}">{{ date("m.d.Y", strtotime($newsitem->created_at )); }}</time>
		</li>
		@endforeach
		</ul>
	</div>
	
</div>


