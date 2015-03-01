<?php

$sectionFormat = '
<section class="{{Type}} {{Title}}">
	<h2>{{Title}}</h2>
	{{SectionContent}}
</section>
';
$listItemFormat = '
<li >{{Text}}</li>
';
$detailListItemFormat = '
<article >
		<h2>{{Title}}</h2>
		<h3>{{SubTitle}}</h3>
		<span class="description">{{Text}}</span>
</article>
';

return array(
	'theme' => array(
		'sectionFormat' => $sectionFormat,
		'listItemFormat' => $listItemFormat,
		'detailListItemFormat' => $detailListItemFormat,
		'highlightListItemFormat' => $highlightListItemFormat
	),
	'advanced' => array(
		'debug' => false
	)
);