#!/usr/bin/perl

use strict;
use File::Find;

my @foundmods;
my %found;
my (@mod1, @mod2);

print "Content-type:  text/html\n\n";

my $perl_version = sprintf("%vd", $^V);  # human readable version of $]

print qq~ <html><head>
<style type="text/css">
<!--
th        {font:bold 16px Arial,"Lucida Grande","Lucida Sans Unicode","Bitstream Vera Sans",Verdana,Futura,Helvetica,sans-serif; color:#fff; background-color:#0A328C; padding:5px 0; }
td        {font:12px Arial,"Lucida Grande","Lucida Sans Unicode","Bitstream Vera Sans",Verdana,Futura,Helvetica,sans-serif; line-height:1.5em; vertical-align:top;}
.leftcol  {width:35%; background-color:#E9F0FA; padding-left:5px;}
.rightcol {width:65% }
a:link    {font:12px Arial,"Lucida Grande","Lucida Sans Unicode","Bitstream Vera Sans",Verdana,Futura,Helvetica,sans-serif; color:#002276; text-decoration: none;}
a:visited {font:12px Arial,"Lucida Grande","Lucida Sans Unicode","Bitstream Vera Sans",Verdana,Futura,Helvetica,sans-serif; color:#002276; text-decoration: none;}
a:active  {font:12px Arial,"Lucida Grande","Lucida Sans Unicode","Bitstream Vera Sans",Verdana,Futura,Helvetica,sans-serif; color:#000; text-decoration: underline;}
a:hover   {font:12px Arial,"Lucida Grande","Lucida Sans Unicode","Bitstream Vera Sans",Verdana,Futura,Helvetica,sans-serif; color:#000; text-decoration: underline;}
h1        {font:bold 24px Arial,"Lucida Grande","Lucida Sans Unicode","Bitstream Vera Sans",Verdana,Futura,Helvetica,sans-serif; margin:10px 0 4px;}
table     {margin:30px 0 0;}
-->
</style>

<title>Perl Configuration</title>
</head>

<body>
<h1 style="text-align: center">Perl Configuration</h1>

<table width="100%">
<tr><th colspan="2">Program Paths</th></tr>
<tr><td class="leftcol"><b>Perl Version</b></td><td class="rightcol">$perl_version</td></tr>
<tr><td class="leftcol"><b>Perl Executable</b></td><td class="rightcol">$^X</td></tr>
<tr><td class="leftcol"><b>PERL compile version OS</b></td><td class="rightcol">$^O</td></tr>

<tr><td class="leftcol"><b>Location of Perl</b></td><td class="rightcol">~;

foreach my $location (split ' ', `whereis perl`) {
	print "$location<br>\n";
}

print qq~
</td></tr>
<tr><td class="leftcol"><b>Location of Sendmail</b></td><td class="rightcol">~;

foreach my $location (split ' ', `whereis sendmail`) {
	print "$location<br>\n";
}

print qq~
</td></tr>
<tr><td class="leftcol"><b>Directory locations searched for perl executables</b></td><td class="rightcol">~;

foreach my $location (@INC) {
	print "$location <br>\n";
}

print qq~
</td></tr>
</table>

<table>
<tr><th colspan="2">Environment Variables</th></tr>~;

foreach my $var (keys %ENV) {
	print qq~ <tr><td class="leftcol"><b>$var</b></td><td class="rightcol">$ENV{$var}</td></tr>~;
}

print qq~
</table>

<table width="100%">
<tr><th colspan="3">Installed Perl Modules</th></tr>~;

find({wanted=>\&wanted,follow=>1,follow_skip=>2},@INC);
my $modcount = 0;
foreach my $line (@foundmods){
	my $match = lc $line;
	if ($found{$line}[0] > 0) {
		$found{$line} = [$found{$line}[0]+1, $match];
	} else {
		$found{$line} = [1, $match];
		$modcount++;
	}
}
@foundmods = sort count keys(%found);

my $third = $modcount/3;
my $count=0;
print qq~ <tr><td width="33%" valign="top"><table>~;
foreach my $mod (@foundmods){
	chomp $mod;
	$count++;
	if ($count <= $third){
		print qq~ <tr><td class="rightcol">$mod</td></tr>~;
	} else {
		push (@mod1,$mod)
	}
}

print qq~ </table></td><td width="33%" valign="top"><table>~;
$count = 0;
foreach my $mod1 (@mod1){
	chomp $mod1;
	$count++;
	if ($count <= $third){
		print qq~ <tr><td class="rightcol">$mod1</td></tr>~;
	} else {
		push (@mod2,$mod1)
	}
}
print qq~ </table></td><td width="33%" valign="top"><table>~;
$count = 0;
foreach my $mod2 (@mod2){
	chomp $mod2;
	$count++;
	if ($count <= $third){
		print qq~ <tr><td class="rightcol">$mod2</td></tr>~;
	}
}

print qq~
</table></tr>
</table>
</body>
</html>~;

exit;

sub count {
	return $found{$a}[1] cmp $found{$b}[1];
}

sub wanted {
	if ($File::Find::name =~ /\.pm$/){
		open(my $MODFILE, '<', $File::Find::name) || return;
		while (<$MODFILE>){
			if (/^ *package +(\S+);/){
				push (@foundmods, $1);
				last;
			}
		}
	}
}
