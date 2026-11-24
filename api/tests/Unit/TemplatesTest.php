<?php

declare(strict_types=1);

namespace Kocluk\Api\Tests\Unit;

use Kocluk\Api\Mail\Templates;
use PHPUnit\Framework\TestCase;

/**
 * E-mail link and escaping rules (spec §7.4): the token lives in the URL
 * fragment so it never reaches a server through Referer, and user-controlled
 * display names are HTML-escaped.
 */
final class TemplatesTest extends TestCase
{
    public function test_reset_link_keeps_the_token_in_the_url_fragment(): void
    {
        $templates = new Templates('https://zirveacademy.com/');
        $url = $templates->resetLink('abc_DEF-123');

        self::assertSame('https://zirveacademy.com/#/sifre-sifirla?token=abc_DEF-123', $url);

        $fragment = strpos($url, '#');
        $query = strpos($url, '?token=');

        self::assertIsInt($fragment);
        self::assertIsInt($query);
        self::assertLessThan($query, $fragment, 'Token, URL fragment içinde olmalı.');
    }

    public function test_verify_link_uses_the_configured_app_url(): void
    {
        $templates = new Templates('https://staging.zirveacademy.com');

        self::assertSame(
            'https://staging.zirveacademy.com/#/eposta-dogrula?token=token-123',
            $templates->verifyLink('token-123'),
        );
    }

    public function test_messages_escape_the_display_name(): void
    {
        $message = (new Templates('https://zirveacademy.com'))
            ->verify('<script>alert(1)</script>', 'token-123');

        self::assertArrayHasKey('subject', $message);
        self::assertArrayHasKey('html', $message);
        self::assertStringNotContainsString('<script>alert(1)</script>', $message['html']);
        self::assertStringContainsString('&lt;script&gt;alert(1)&lt;/script&gt;', $message['html']);
        self::assertStringContainsString('https://zirveacademy.com/#/eposta-dogrula?token=token-123', $message['html']);
    }
}
