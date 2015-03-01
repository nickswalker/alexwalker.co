<a href="{{ URL::to('AdminController@getLogout')}}">Logout</a>
<ul>
@foreach ($newsitems as $newsitem)
<li>
	<time>{{$newsitem->created_at}}</time>
	<p>{{ $newsitem->text}}</p>
	<button><a href="{{ URL::to('AdminController@getEditNewsItem' )}}">Edit</a></button>
</li>
@endforeach