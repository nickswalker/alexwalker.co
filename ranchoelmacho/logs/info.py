#!/usr/bin/python

#
# This CGI script gives you the location of your Python interpreter,
# your path to Sendmail, your environment variables and a list of the
# Python modules that are installed on your web server.
#

import glob, os, re, string, sys, traceback
from stat import *

lang2css = {
    '0': '''
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
    '''
    }


installedmodules = {}

def is_executable(path):
    return (os.stat(path)[ST_MODE] & (S_IXUSR | S_IXGRP | S_IXOTH)) != 0

def listmodules(dirname, names):
    has_init_py = '__init__.py' in names
    if has_init_py:
        for p in sys_path:
            if dirname[:len(p)] == p:
                dirname = dirname[len(p):]
                break
        if dirname[:1] == '/':
            dirname = dirname[1:]
        if dirname[:4] == 'test':
            return
        dirname = dirname.replace("/", ".")
        if dirname != '':
            installedmodules[dirname] = None
        
    for mod in names:
        if (mod[0] != "_") and (mod[:4] != 'test'):
            ext = mod[-3:]
            if ext == '.py':
                mod = mod[:-3]
            elif ext == '.so':
                if mod[-9:-3] == 'module':
                    mod = mod[:-9]
                else:
                    mod = mod[:-3]
            else:
                continue
            if has_init_py and (dirname != ''):
                mod = dirname + "." + mod
            installedmodules[mod] = None


print("Content-Type: text/html; charset=ISO-8859-1\n")

try:
    lang = '0'
    dbentry = os.getenv('DBENTRY')
    if dbentry:
        m = re.search(r'#LANG (\d+)', dbentry)
        if m:
            lang = m.group(1)

    try:
        css = lang2css[lang]
    except KeyError:
        css = lang2css['0']


    print('''<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">
<html>
<head>
<title>Python Configuration</title>
<style type="text/css">
<!--
''')

    print(css)

    print('''
-->
</style>
</head>

<body bgcolor="#ffffff">
<h1 style="text-align: center">Python Configuration</h1>
''')

    sys_path = sys.path[1:]
    sys_path.sort(key=lambda a: len(a))

    for i in list(sys.builtin_module_names):
        installedmodules[i] = None

    libdirs = sys.path
    libdirs.sort()
    for dir in libdirs:
        for root, dirs, files in os.walk(dir):
            listmodules(root, files)

    installedmodules = list(installedmodules.keys())
    installedmodules.sort()
    for i in range(len(installedmodules) % 3):
        installedmodules.append('')

    py = {}
    py["version"] = sys.version.split()[0]
    py["platform"]= sys.platform

    location = sorted(filter(lambda x: x[0]=='/', os.popen("whereis python", "r").read().split()))
    for i in range(len(location)):
        if os.path.islink(location[i]):
            location[i] = location[i] + " -> " + os.readlink(location[i])

    py["location"] = "<br>\n".join(location)

    location = sorted(filter(lambda x: x[0]=='/', os.popen("whereis sendmail", "r").read().split()))
    location = list(filter(is_executable, location))
    for i in range(len(location)):
        if os.path.islink(location[i]):
            location[i] = location[i] + " -> " + os.readlink(location[i])
    
    py["sendmail"] = "<br>\n".join(location)

    libdirs = sys.path
    if libdirs[0] == '':
        libdirs[0] = './'

    py["libdirs"] = "<br>\n".join(libdirs)

    print('<table width="100%">')
    print('''
    <tr><th colspan="2">Program Paths</th></tr>
    <tr><td class="leftcol"><b>Python version</b></td><td class="rightcol">%(version)s</td></tr>
    <tr><td class="leftcol"><b>Python OS platform</b></td><td class="rightcol">%(platform)s</td></tr>
    <tr><td class="leftcol"><b>Location of Python</b></td><td class="rightcol">%(location)s</td></tr>
    <tr><td class="leftcol"><b>Location of Sendmail</b></td><td class="rightcol">%(sendmail)s</td></tr>
    <tr><td class="leftcol"><b>Directories searched for Python modules</b></td><td class="rightcol">%(libdirs)s</td></tr>
    ''' % py)
    print("</table>")

    print('''<table width="100%">
    <tr><th colspan="2">Environment Variables</th></tr>
    ''')

    envvars = list(os.environ.keys())
    envvars.sort()
    for envvar in envvars:
        value = os.environ[envvar]
        print('<tr><td class="leftcol"><b>%s</b></td><td class="rightcol">%s<td></tr>' % (envvar, value))
    print("</table>")

    print('''<table width="100%">
    <tr><th>Installed Modules</th></tr>
    <tr><td><pre>''')

    rows = len(installedmodules) // 3
    mods = [ [], [], [] ]
    maxlen = max(list(map(len, installedmodules)))

    for i in range(rows):
        s = "%%-%ds %%-%ds %%s" % (maxlen, maxlen)
        print(s % (installedmodules[i], installedmodules[rows + i], installedmodules[2*rows + i]))

    print("</pre></td></tr></table></body></html>")

except:
    tb = traceback.format_exception(sys.exc_info()[0], sys.exc_info()[1], sys.exc_info()[2])
    tb = "".join(tb)
    print('<pre>%s</pre></body></html>' % tb)
