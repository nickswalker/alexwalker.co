<?php

class DatabaseSeeder extends Seeder {

	/**
	 * Run the database seeds.
	 *
	 * @return void
	 */
	public function run()
	{
		Eloquent::unguard();

		$this->call('NewsTableSeeder');
		$this->call('UserTableSeeder');
	}

}

class NewsTableSeeder extends Seeder {

    public function run()
    {
        DB::table('news')->delete();
        
        $news = [
					["text" => "Lorem ipsum" ],
					["text" => "dolor sit amet!"]
				];
		foreach ($news as $newsitem){
	        NewsItem::create($newsitem);
        }
    }

}
 
class UserTableSeeder extends Seeder {
  public function run(){
  	DB::table('users')->delete();
    $users = [
      [
        "username" => "alexwalker",
        "password" => Hash::make("password"),
        "email"    => "alexanderiwalker@me.com"
      ]
    ];
  
    foreach ($users as $user) {
      User::create($user);
    }
  }
}