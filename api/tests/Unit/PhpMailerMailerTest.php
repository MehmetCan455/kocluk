<?php

declare(strict_types=1);

namespace Kocluk\Api\Tests\Unit;

use Kocluk\Api\Mail\PhpMailerMailer;
use Kocluk\Api\Support\ApiException;
use PHPUnit\Framework\TestCase;
use RuntimeException;

/**
 * Transport-failure diagnostics: the log keeps the nested cause chain while
 * removing recipient addresses, the SMTP password and token-shaped strings.
 * Client-facing messages remain generic.
 */
final class PhpMailerMailerTest extends TestCase
{
    public function test_failure_description_includes_causes_and_redacts_secrets(): void
    {
        $token = str_repeat('a', 43);
        $root = new RuntimeException(
            'SMTP auth failed for ayse@example.com: password=hunter2 token=' . $token,
        );
        $middle = new RuntimeException('transport layer', 0, $root);
        $top = new RuntimeException('send failed', 0, $middle);

        $description = PhpMailerMailer::describeFailure($top, 'hunter2');

        self::assertStringContainsString('send failed', $description);
        self::assertStringContainsString('transport layer', $description);
        self::assertStringContainsString('SMTP auth failed', $description);
        self::assertStringContainsString('[adres]', $description);
        self::assertStringContainsString('[sifre]', $description);
        self::assertStringContainsString('[token]', $description);
        self::assertStringNotContainsString('ayse@example.com', $description);
        self::assertStringNotContainsString('hunter2', $description);
        self::assertStringNotContainsString($token, $description);
    }

    public function test_failure_description_stops_after_three_levels(): void
    {
        $fourth = new RuntimeException('cok-eski-kok-neden');
        $third = new RuntimeException('ucuncu', 0, $fourth);
        $second = new RuntimeException('ikinci', 0, $third);
        $first = new RuntimeException('birinci', 0, $second);

        $description = PhpMailerMailer::describeFailure($first);

        self::assertStringContainsString('birinci', $description);
        self::assertStringContainsString('ikinci', $description);
        self::assertStringContainsString('ucuncu', $description);
        self::assertStringNotContainsString('cok-eski-kok-neden', $description);
    }

    public function test_even_a_short_configured_secret_is_redacted(): void
    {
        $description = PhpMailerMailer::describeFailure(
            new RuntimeException('password=q failed'),
            'q',
        );

        self::assertStringNotContainsString('password=q', $description);
        self::assertStringContainsString('[sifre]', $description);
    }

    public function test_a_configuration_error_is_not_rewrapped_as_a_transport_failure(): void
    {
        $mailer = new PhpMailerMailer(['mail' => ['encryption' => 'bogus']]);

        try {
            $mailer->send('ayse@example.com', 'Konu', '<p>Gövde</p>');
            self::fail('Geçersiz şifreleme ayarı ApiException üretmeli.');
        } catch (ApiException $error) {
            self::assertSame('mail_failed', $error->errorCode);
            self::assertSame('E-posta şifreleme ayarı geçersiz.', $error->getMessage());
            self::assertNull($error->getPrevious());
        }
    }
}
