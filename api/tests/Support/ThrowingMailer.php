<?php

declare(strict_types=1);

namespace Kocluk\Api\Tests\Support;

use Kocluk\Api\Mail\Mailer;
use RuntimeException;

/**
 * Mailer double that simulates an unreachable SMTP server. Registration and
 * password-reset requests must survive it; only the e-mail is lost.
 */
final class ThrowingMailer implements Mailer
{
    public function send(string $to, string $subject, string $html): void
    {
        throw new RuntimeException('SMTP sunucusuna ulaşılamadı.');
    }
}
