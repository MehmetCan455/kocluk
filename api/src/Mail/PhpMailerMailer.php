<?php

declare(strict_types=1);

namespace Kocluk\Api\Mail;

use Kocluk\Api\Support\ApiException;
use PHPMailer\PHPMailer\PHPMailer;
use Throwable;

/**
 * SMTP transport backed by the vendored PHPMailer 6.x sources (spec §7.4).
 *
 * The cPanel host has no Composer, so api/lib/PHPMailer is committed and the
 * three class files are required here. Configuration comes from
 * config.mail (host, port, username, password, encryption, from_address,
 * from_name). Any transport failure becomes mail_failed / 502; the caller
 * decides whether that aborts the request (never for registration).
 */
final class PhpMailerMailer implements Mailer
{
    private const VENDOR_FILES = ['Exception.php', 'SMTP.php', 'PHPMailer.php'];

    private const DEFAULT_PORT = 587;

    private const TIMEOUT_SECONDS = 15;

    /** @var array<string, mixed> */
    private readonly array $mailConfig;

    /**
     * @param array<string, mixed> $config
     */
    public function __construct(array $config = [])
    {
        $mail = $config['mail'] ?? null;
        $this->mailConfig = is_array($mail) ? $mail : [];

        $this->loadVendor();
    }

    public function send(string $to, string $subject, string $html): void
    {
        try {
            $port = $this->port();
            $encryption = $this->encryption($port);
            $username = $this->text('username', '');

            $mailer = new PHPMailer(true);
            $mailer->isSMTP();
            $mailer->Host = $this->text('host', 'localhost');
            $mailer->Port = $port;
            $mailer->SMTPDebug = 0;
            $mailer->Timeout = self::TIMEOUT_SECONDS;
            $mailer->SMTPAuth = $username !== '';

            if ($mailer->SMTPAuth) {
                $mailer->Username = $username;
                $mailer->Password = $this->secret('password');
            }

            $mailer->SMTPSecure = $encryption;
            $mailer->SMTPAutoTLS = $encryption !== '';
            $mailer->CharSet = 'UTF-8';
            $mailer->Encoding = PHPMailer::ENCODING_BASE64;
            $mailer->isHTML(true);
            $mailer->setFrom(
                $this->text('from_address', 'no-reply@zirveacademy.com'),
                $this->text('from_name', 'Zirve Academy'),
            );
            $mailer->addAddress($to);
            $mailer->Subject = $subject;
            $mailer->Body = $html;
            $mailer->AltBody = self::plainText($html);
            $mailer->send();
        } catch (Throwable $error) {
            throw new ApiException(
                'mail_failed',
                'E-posta gönderilemedi.',
                502,
                [],
                $error,
            );
        }
    }

    private function loadVendor(): void
    {
        $directory = dirname(__DIR__, 2) . '/lib/PHPMailer';

        foreach (self::VENDOR_FILES as $file) {
            $path = $directory . '/' . $file;

            if (!is_file($path)) {
                throw new ApiException(
                    'mail_failed',
                    'E-posta gönderimi yapılandırılmamış.',
                    502,
                );
            }

            require_once $path;
        }
    }

    private function port(): int
    {
        $port = (int) ($this->mailConfig['port'] ?? self::DEFAULT_PORT);

        return $port >= 1 && $port <= 65535 ? $port : self::DEFAULT_PORT;
    }

    /**
     * STARTTLS for 587 (and anything else), implicit TLS for 465, or an
     * explicit mail.encryption value (tls/starttls, ssl/smtps, none/off).
     */
    private function encryption(int $port): string
    {
        $configured = strtolower($this->text('encryption', ''));

        return match ($configured) {
            '', 'auto' => $port === 465
                ? PHPMailer::ENCRYPTION_SMTPS
                : PHPMailer::ENCRYPTION_STARTTLS,
            'none', 'off', 'false' => '',
            'tls', 'starttls' => PHPMailer::ENCRYPTION_STARTTLS,
            'ssl', 'smtps' => PHPMailer::ENCRYPTION_SMTPS,
            default => throw new ApiException(
                'mail_failed',
                'E-posta şifreleme ayarı geçersiz.',
                502,
            ),
        };
    }

    private function text(string $key, string $default): string
    {
        $value = $this->mailConfig[$key] ?? null;

        if (!is_string($value)) {
            return $default;
        }

        $trimmed = trim($value);

        return $trimmed === '' ? $default : $trimmed;
    }

    /**
     * Secrets are passed through untouched; leading and trailing spaces are
     * valid password characters.
     */
    private function secret(string $key): string
    {
        $value = $this->mailConfig[$key] ?? null;

        return is_string($value) ? $value : '';
    }

    private static function plainText(string $html): string
    {
        $spaced = preg_replace('/<\/(?:p|h1|h2|div|tr)>|<br\s*\/?>/i', "\n", $html) ?? $html;
        $text = html_entity_decode(strip_tags($spaced), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = preg_replace('/[ \t]+/', ' ', $text) ?? $text;
        $text = preg_replace("/\n{3,}/", "\n\n", $text) ?? $text;

        return trim($text);
    }
}
