<?php

class HomeController extends BaseController {

	/*
	|--------------------------------------------------------------------------
	| Default Home Controller
	|--------------------------------------------------------------------------
	|
	| You may wish to use controllers instead of, or in addition to, Closure
	| based routes. That's great! Here is an example controller method to
	| get you started. To route to this controller, just add the route:
	|
	|	Route::get('/', 'HomeController@showWelcome');
	|
	*/

	public function getIndex()
	{
		$stillsData = Lib\Filehelper::get_dir_file_info('img/stills');
		$data['stills'] = array_reverse($stillsData);
		$data['newsitems'] = NewsItem::orderBy('created_at', 'desc')->get();
		$data['images'] = array_reverse(Lib\Filehelper::get_dir_file_info('img/slider'));

		return View::make('layout.base', $data);
	}

	public function postContact()
	{
		$data["name"] = Input::get('name');
		$data["email"] = Input::get('email');
		$data["content"] = Input::get('message');
		$validator = Validator::make(Input::all(), array(
			"name" => "required",
			"email" => "required|email|different:name",
			"message" => "required|min:10"
		));
		if ($validator->fails()){
			return 'failed';
		}
		Mail::send('email.contact', $data, function($message) use ($data){
			$message->from($data['email'], $data['name']);
			$message->to("alexanderiwalker@icloud.com", 'Alex Walker')->subject($data['name'] . " Contacted You");
		});

		return 'sent';

	}

}