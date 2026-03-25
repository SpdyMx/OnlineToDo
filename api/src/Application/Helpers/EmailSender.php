<?php

namespace App\Application\Helpers;

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

class EmailSender
{
    public static function send(string $toEmail, string $subject, string $bodyHtml, string $bodyPlain = ''): bool
    {
        $mail = new PHPMailer(true);

        try {
            $host = getenv('SMTP_HOST') ?: 'smtp.gmail.com';
            $port = getenv('SMTP_PORT') ?: 465;
            $user = getenv('SMTP_USER') ?: '';
            $pass = getenv('SMTP_PASS') ?: '';
            $fromName = getenv('SMTP_FROM_NAME') ?: 'Online ToDo App';

            if (empty($user) || empty($pass)) {
                // Cannot send if credentials are not configured, fallback to log
                error_log("Email to $toEmail: $subject. (Set SMTP_USER/PASS in .env to actually send)");
                return false;
            }

            // Server settings
            $mail->isSMTP();
            $mail->Host = $host;
            $mail->SMTPAuth = true;
            $mail->Username = $user;
            $mail->Password = $pass;
            $mail->SMTPSecure = $port == 465 ?PHPMailer::ENCRYPTION_SMTPS : PHPMailer::ENCRYPTION_STARTTLS;
            $mail->Port = $port;
            $mail->CharSet = 'UTF-8';

            // Recipients
            $mail->setFrom($user, $fromName);
            $mail->addAddress($toEmail);

            // Content
            $mail->isHTML(true);
            $mail->Subject = $subject;
            $mail->Body = $bodyHtml;
            $mail->AltBody = $bodyPlain ?: strip_tags($bodyHtml);

            $mail->send();
            return true;
        }
        catch (Exception $e) {
            error_log("Message could not be sent. Mailer Error: {$mail->ErrorInfo}");
            return false;
        }
    }
}
