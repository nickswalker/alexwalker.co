<?php
function saveEmailToDisk($name, $email, $message) {
    $date = new DateTime();
    $dateString = date($date::ATOM, time());
    $currentPath = realpath(".");
    $outFileName = $dateString.".txt";
    $outFilePath = join(DIRECTORY_SEPARATOR, array($currentPath, $outFileName));
    file_put_contents($outFilePath, $name."\n".$email."\n".$message);
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
if (isset($_POST['url']) && $_POST['url'] == ''){
    $error .= 'Unable to process input';
}

// Check email
if (!$email){
    $error .= 'Please enter an e-mail address.<br />';
}

// Check agains bot habit
if ($name && $email && $name == $email) {
    $error .= 'Name and email cannot be the same.<br />';
}
if ( preg_match( "/[\r\n]/", $name ) || preg_match( "/[\r\n]/", $email ) ) {
    $error .= 'Unexpected newlines in name or email';

}

// Check message (length)
if (!$message || strlen($message) < 10 || 15000 < strlen($message)){
    $error .= "Your message is either too long or too short.<br />";
}

if ($error == ""){
    $email = filter_var($emal, FILTER_SANITIZE_EMAIL);
    $message = filter_var($message, FILTER_SANITIZE_STRING);
    $name = filter_var($name, FILTER_SANITIZE_STRING);
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