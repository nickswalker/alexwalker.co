<?php

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

class CreateNewsTable extends Migration {

	/**
	 * Run the migrations.
	 *
	 * @return void
	 */
	public function up()
{
    Schema::create('news', function($table)
    {
        $table->increments('id');
        $table->text('text');
        $table->timestamps();
    });
}

public function down()
{
    Schema::drop('news');
}

}
