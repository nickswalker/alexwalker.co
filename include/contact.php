<?php
function saveEmailToDisk($name, $email, $message) {
    $date = new DateTime();
    $dateString = date($date::ATOM, time());
    file_put_contents(realpath(".").$dateString.".txt", $name."\n".$email."\n".$message);
}

$post = (!empty($_POST)) ? true : false;
if (!$post) {
    return;
}
$name = stripslashes($_POST['name']);
$email = trim($_POST['email']);
$message = stripslashes($_POST['message']);
// Check name

$error = "";
if (!$name){
    $error .= 'Please enter your name.<br />';
}

// Check email
if (!$email){
    $error .= 'Please enter an e-mail address.<br />';
}

// Check agains bot habit
if ($name && $email && $name == $email) {
    $error .= 'Name and email cannot be the same.<br />';
}

// Check message (length)
if (!$message || strlen($message) < 10){
    $error .= "Please enter your message. It should have at least 10 characters.<br />";
}

if ($error == ""){
    $headers = "From: ".$name." <".$email.">\r\n"
    ."Reply-To: ".$email."\r\n"
    ."X-Mailer: PHP/" . phpversion();
    $mail = mail("alexanderiwalker@icloud.com", $name. ' Contacted You', $message, $headers);

    if ($mail) {
        saveEmailToDisk($name, $email, $message);
        echo 'sent';
    } else {
        echo 'failed';
    }

} else {
    echo $error;
}
?>