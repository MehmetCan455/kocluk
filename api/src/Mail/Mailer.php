<?php

declare(strict_types=1);

namespace Kocluk\Api\Mail;

/**
 * Outbound transactional e-mail (spec §7.4).
 *
 * The API only needs plain HTML messages; the interface stays tiny so tests
 * can substitute FakeMailer and production can use the vendored PHPMailer
 * transport without Composer on the shared host.
 */
interface Mailer
{
    public function send(string $to, string $subject, string $html): void;
}
