<!DOCTYPE html>
<html>
<head>
	 <meta property="og:url" content="https://alexwalker.co/resume/">
    <meta property="og:image" content="https://alexwalker.co/img/ogimage3.jpg">
    <meta property="og:title" content="Alex Walker's Cinematography Résumé">
    <meta property="og:description" content="">
	<meta charset="utf-8" />
	<meta name="format-detection" content="telephone=no">
	<title><?php echo $bio['name'];?> | <?php echo $bio['email'];?></title>
	<meta name="description" content="<?php echo $bio['name'];?>'s resume." />
	<link rel="stylesheet"  href="<?php echo $this->getThemeURL();?>resume.css" media="all" />
	<link href='http://fonts.googleapis.com/css?family=Open+Sans:300,300italic,400,600,700' rel='stylesheet|Merriweather:400,400italic,700,700italic' type='text/css'>
	<link rel="stylesheet" href="//cdnjs.cloudflare.com/ajax/libs/fancybox/2.1.5/jquery.fancybox.css">
	<?php
	if( file_exists( $this->themePathFromRoot.'/custom-style.css') ){
		echo ('<link rel="stylesheet" href="'.$this->getThemeURL() .'custom-style.css">');
	}?>
	<script src="//ajax.googleapis.com/ajax/libs/jquery/2.1.1/jquery.min.js"></script>
	<script src="//cdnjs.cloudflare.com/ajax/libs/fancybox/2.1.5/jquery.fancybox.min.js"></script>
	<script>
		$(document).ready(function() {
			$('.ion-image').fancybox({
				padding : 0,
				openEffect: 'fade',
				closeEffect: 'fade',
				prevEffect: 'fade',
				nextEffect: 'fade',
				loop: false,
				closeBtn: false,
				helpers : {
	   	title : null
	}
			});

		});
	</script>
</head>
<body>
	<div id="container">
		<header itemscope itemtype="http://schema.org/Person">
				<div class="plate">
					<h1 itemprop="name"><?php echo $bio['name'];?></h1>
					<h2 itemprop="jobTitle"><?php echo $bio['job-title'];?></h2>
				</div>
				
					<div class="right-plate">
					<div class="contact-info">
						<img src="/img/TRE_Logo_transparent.png"/>
					</div><ul id="social">
						<?php
							foreach ( $social[0] as $name=>$value ){
								if( $value != '' ){
									echo '<li><a href="'.$value.'" class="ion-social-'.$name.'"></a></li>';
								}
							}
?>
					</ul>
				
		</header>

		<?php $this->showSections();?>
		<section>
			<div class="representation">
				<b><h2>Representation:</h2></b>
					<b> The Right Eye Inc.
                    <br/><a href="http://therighteye.com/">www.therighteye.com</a>
 <br/>Thomas Turley | turley@therighteye.com
    <br/>office 212.924.8505
 <br/>cell 917.209.5445
                
                    <br/> New York, NY
            </div>
			<div class="right-plate">
					<div class="contact-info">
						<h3 id="print"><button onClick="window.print()">Print</button></h3>
						<h3><a itemprop="email" href="mailto:<?php echo $bio['email'];?>"><?php echo $bio['email'];?></a></h3>
						<h3><a itemprop="url" href="http://<?php echo $bio['site'];?>"><?php echo $bio['site'];?></a></h3>
						<h3 itemprop="telephone"><?php echo $this->issetor($bio['phone-number']);?></h3>
						<h4 itemprop="address" class="address"><?php echo $this->issetor($bio['street-address']);?></h4>
					</div>
			
		</section>

		<footer>
			<p>Last Updated: 11.09.21</p>
		</footer>

	</div>
			<!-- Default Statcounter code for Portfolio Website
http://alexwalker.co -->
<script type="text/javascript">
var sc_project=12435982; 
var sc_invisible=1; 
var sc_security="dcc5fdba"; 
</script>
<script type="text/javascript"
src="https://www.statcounter.com/counter/counter.js"
async></script>
<noscript><div class="statcounter"><a title="Web Analytics
Made Easy - StatCounter" href="https://statcounter.com/"
target="_blank"><img class="statcounter"
src="https://c.statcounter.com/12435982/0/dcc5fdba/1/"
alt="Web Analytics Made Easy -
StatCounter"></a></div></noscript>
<!-- End of Statcounter Code -->
</body>
</html>
