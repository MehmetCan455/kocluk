<?php

declare(strict_types=1);

namespace Kocluk\Api\Tests\Unit;

use Kocluk\Api\Mail\DeferredMailer;
use Kocluk\Api\Mail\FakeMailer;
use Kocluk\Api\Mail\Mailer;
use Kocluk\Api\Tests\Support\ThrowingMailer;
use PHPUnit\Framework\TestCase;
use RuntimeException;
use Throwable;

/**
 * Deferred delivery seam: requests queue mail, tests flush explicitly, and a
 * failed queued message cannot stop the ones behind it or escape after the
 * response.
 */
final class DeferredMailerTest extends TestCase
{
    public function test_messages_wait_in_the_queue_until_flush(): void
    {
        $fake = new FakeMailer();
        $deferred = new DeferredMailer($fake);

        $deferred->send('ayse@example.com', 'Konu', '<p>Gövde</p>');

        self::assertSame(0, $fake->count());
        self::assertSame(1, $deferred->pending());

        $deferred->flush();

        self::assertSame(1, $fake->count());
        self::assertSame(0, $deferred->pending());

        $mail = $fake->last();

        self::assertIsArray($mail);
        self::assertSame('ayse@example.com', $mail['to']);
    }

    public function test_immediate_mode_sends_without_flush(): void
    {
        $fake = new FakeMailer();
        $deferred = new DeferredMailer($fake, true);

        $deferred->send('ayse@example.com', 'Konu', '<p>Gövde</p>');

        self::assertSame(1, $fake->count());
        self::assertSame(0, $deferred->pending());
    }

    public function test_a_failure_callback_runs_and_the_next_message_is_still_sent(): void
    {
        $inner = new class implements Mailer {
            /** @var list<string> */
            public array $sent = [];

            public function send(string $to, string $subject, string $html): void
            {
                if ($to === 'fail@example.com') {
                    throw new RuntimeException('boom');
                }

                $this->sent[] = $to;
            }
        };

        $deferred = new DeferredMailer($inner);
        $failures = [];

        $deferred->queue(
            'fail@example.com',
            'Konu',
            '<p>Gövde</p>',
            static function (Throwable $error) use (&$failures): void {
                $failures[] = $error->getMessage();
            },
        );
        $deferred->queue('ok@example.com', 'Konu', '<p>Gövde</p>');

        $deferred->flush();

        self::assertSame(['boom'], $failures);
        self::assertSame(['ok@example.com'], $inner->sent);
        self::assertSame(0, $deferred->pending());
    }

    public function test_immediate_mode_runs_the_callback_instead_of_throwing(): void
    {
        $deferred = new DeferredMailer(new ThrowingMailer(), true);
        $failures = [];

        $deferred->queue(
            'ayse@example.com',
            'Konu',
            '<p>Gövde</p>',
            static function (Throwable $error) use (&$failures): void {
                $failures[] = $error::class;
            },
        );

        self::assertCount(1, $failures);
        self::assertSame(0, $deferred->pending());
    }

    public function test_immediate_mode_rethrows_without_a_callback(): void
    {
        $deferred = new DeferredMailer(new ThrowingMailer(), true);

        $this->expectException(RuntimeException::class);

        $deferred->send('ayse@example.com', 'Konu', '<p>Gövde</p>');
    }
}
