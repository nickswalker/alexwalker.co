<?php

class AdminController extends BaseController {
 public function __construct()
	{
		$this->beforeFilter('auth', array('except' => array('getLogin','postLogin') ));

		//$this->beforeFilter('csrf', array('on' => 'post'));
		
	}

	public function getLogin(){
		return View::make("admin.login");
	}
	public function postLogin(){
		 $validator = $this->getLoginValidator();
		if ($validator->passes()) {
			$credentials = array("username"=>Input::get("username"), "password"=>Input::get("password"));
	
			if (Auth::attempt($credentials, true) ) {
				return Redirect::to('admin');
			}
			else{
				return Redirect::to('admin/login');
			}
		}
		else {
			return Redirect::to("admin/login");
		}
	}
	protected function getLoginValidator(){
		return Validator::make(Input::all(), array(
			"username" => "required",
			"password" => "required"
		));
	}
	
	public function getIndex()
	{
		if(Auth::check()){
		
		$data['newsitems'] = NewsItem::orderBy('created_at', 'desc')->get();
			return View::make('admin.overview', $data);
		}
		else return Redirect::to("admin/login");
	}
	
	public function getEdit(){
		return View::make('admin.edit');
	}
	public function getLogout(){
		Auth::logout();
		return Redirect::to("admin");
	}


}