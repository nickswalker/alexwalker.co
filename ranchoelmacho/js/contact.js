{\rtf1\ansi\ansicpg1252\cocoartf2638
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\pard\tx720\tx1440\tx2160\tx2880\tx3600\tx4320\tx5040\tx5760\tx6480\tx7200\tx7920\tx8640\pardirnatural\partightenfactor0

\f0\fs24 \cf0 function Contact(form, returnMessage) \{\
	this.$form = form,\
	this.$returnMessage = returnMessage;\
\}\
\
Contact.prototype.handleReturn = function (returnedObject)\{\
		var self = this;\
		this.$form.fadeOut(200, function()\{\
		switch(returnedObject)\{\
			case 'sent':\
			self.$returnMessage.append('<span class="icon-ok"></span><span class="message">Message sent. I\\'ll be in touch.</span>');\
				break;\
			case 'failed':\
				self.$returnMessage.append('<span class="icon-remove"></span><span class="message">Sorry, the message can\\'t seem to get through. Try contacting me through a social network instead.</span>');\
				break;\
			default :\
				self.$returnMessage.append('<span class="icon-remove"></span><span class="message">'+returnedObject+'</span>');\
			break;\
	\}\
		self.$returnMessage.fadeIn(200);\
		\});\
\
		this.$returnMessage.on('click', function()\{\
			$(this).fadeOut(200, function()\{\
			$(this).children().remove();\
						self.$form.fadeIn(200);\
			\});\
\
		\});\
\}\
Contact.prototype.sendEmail =	function ()\{\
	var self = this;\
	var emailid = this.$form.children('input[name="email"]').val();\
	var tempname = this.$form.children('input[name="name"]').val();\
	var tempmessage = this.$form.children('textarea[name="message"]').val();\
	 data = \{ email: emailid,\
			name : tempname,\
			message : tempmessage\
	\};\
		$.ajax(\{\
	type: "POST",\
	url: this.$form.attr('action'),\
	data: data,\
	dataType: "text",\
	success: function(returnedObject)\{\
		self.handleReturn(returnedObject);\
	\}\
	\});\
\}}