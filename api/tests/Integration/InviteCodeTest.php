<?php

declare(strict_types=1);

namespace Kocluk\Api\Tests\Integration;

use Kocluk\Api\Tests\Support\ApiTestCase;

/**
 * Closed-beta invite code (spec §7.5).
 *
 * When config.invite_code is non-empty registration requires an exact match
 * compared with hash_equals; an empty value disables the gate.
 */
final class InviteCodeTest extends ApiTestCase
{
    private const INVITE_CODE = 'beta-davet-2026';

    public function test_registration_requires_an_invite_code_when_configured(): void
    {
        $app = $this->app(['invite_code' => self::INVITE_CODE]);

        $response = $this->register([], ['Origin' => self::ORIGIN], $app);

        self::assertSame(422, $response->status());
        self::assertSame('validation_failed', $this->payload($response)['error']['code']);
        self::assertNull($response->header('Set-Cookie'));
        self::assertSame(0, $this->countRows('users'));
        self::assertSame(0, $this->mailer->count());
    }

    public function test_a_wrong_invite_code_is_rejected(): void
    {
        $app = $this->app(['invite_code' => self::INVITE_CODE]);

        $wrong = $this->register(
            ['inviteCode' => 'yanlis-davet-kodu'],
            ['Origin' => self::ORIGIN],
            $app,
        );

        self::assertSame(422, $wrong->status());
        self::assertSame('validation_failed', $this->payload($wrong)['error']['code']);
        self::assertSame(0, $this->countRows('users'));

        $prefix = $this->register(
            ['inviteCode' => 'beta-davet-202'],
            ['Origin' => self::ORIGIN],
            $app,
        );

        self::assertSame(422, $prefix->status());
        self::assertSame(0, $this->countRows('users'));
    }

    public function test_a_correct_invite_code_registers_the_account(): void
    {
        $app = $this->app(['invite_code' => self::INVITE_CODE]);

        $response = $this->register(
            ['inviteCode' => self::INVITE_CODE],
            ['Origin' => self::ORIGIN],
            $app,
        );

        self::assertSame(201, $response->status());
        self::assertSame(self::EMAIL, $this->payload($response)['user']['email']);
        self::assertSame(1, $this->countRows('users'));
        self::assertSame(1, $this->mailer->count());
    }

    public function test_an_empty_invite_code_keeps_registration_open(): void
    {
        $app = $this->app(['invite_code' => '']);

        $response = $this->register([], ['Origin' => self::ORIGIN], $app);

        self::assertSame(201, $response->status());
        self::assertSame(1, $this->countRows('users'));
    }

    public function test_an_empty_invite_code_ignores_a_supplied_code(): void
    {
        $app = $this->app(['invite_code' => '']);

        $response = $this->register(
            ['inviteCode' => 'herhangi-bir-sey'],
            ['Origin' => self::ORIGIN],
            $app,
        );

        self::assertSame(201, $response->status());
        self::assertSame(1, $this->countRows('users'));
    }

    public function test_the_invite_code_is_trimmed_from_the_configuration(): void
    {
        $app = $this->app(['invite_code' => '  ' . self::INVITE_CODE . '  ']);

        self::assertSame(
            201,
            $this->register(
                ['inviteCode' => self::INVITE_CODE],
                ['Origin' => self::ORIGIN],
                $app,
            )->status(),
        );
    }
}
