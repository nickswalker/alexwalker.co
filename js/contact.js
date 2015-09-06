function Contact(form, returnMessage) {
	this.$form = form,
	this.$returnMessage = returnMessage;
}

Contact.prototype.handleReturn = function (returnedObject){
		var self = this;
		this.$form.fadeOut(200, function(){
		switch(returnedObject){
			case 'sent':
			self.$returnMessage.append('<span class="icon-ok"></span><span class="message">Message sent. I\'ll be in touch.</span>');
				break;
			case 'failed':
				self.$returnMessage.append('<span class="icon-remove"></span><span class="message">Sorry, the message can\'t seem to get through. Try contacting me through a social network instead.</span>');
				break;
			default :
				self.$returnMessage.append('<span class="icon-remove"></span><span class="message">'+returnedObject+'</span>');
			break;
	}
		self.$returnMessage.fadeIn(200);
		});

		this.$returnMessage.on('click', function(){
			$(this).fadeOut(200, function(){
			$(this).children().remove();
						self.$form.fadeIn(200);
			});

		});
}
Contact.prototype.sendEmail =	function (){
	var self = this;
	var emailid = this.$form.children('input[name="email"]').val();
	var tempname = this.$form.children('input[name="name"]').val();
	var tempmessage = this.$form.children('textarea[name="message"]').val();
	 data = { email: emailid,
			name : tempname,
			message : tempmessage
	};
		$.ajax({
	type: "POST",
	url: this.$form.attr('action'),
	data: data,
	dataType: "text",
	success: function(returnedObject){
		self.handleReturn(returnedObject);
	}
	});
}
