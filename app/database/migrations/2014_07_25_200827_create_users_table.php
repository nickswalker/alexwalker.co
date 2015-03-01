<?php

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

class CreateUsersTable extends Migration {
  public function up()
  {
    Schema::create("users", function($table) {
      $table->increments("id");
      $table->string("username");
      $table->string("password");
      $table->string("email");
      $table->string("remember_token")->nullable();
      $table->timestamps();
    });
  }
  
  public function down()
  {
    Schema::drop("users");
  }
}
