<?php
$publicFromRoot = public_path(); //Where is the directory that shows up when you go to the root of your site?
								 // http://example.com/  might be located at /home/public_html/ on the server.
									
$themePathFromRoot = realpath(public_path(). '/themes/work-summary'); //Where is your theme?
												 //Note that the theme MUST be in a publicly accesible directory!
												 //Otherwise your CSS won't load :(

$neueresume = new \Nickswalker\NeueResume\NeueResume($publicFromRoot, $themePathFromRoot);
$neueresume->resumePathFromRoot = realpath(public_path() . '/resume.xml');

$neueresume->display();