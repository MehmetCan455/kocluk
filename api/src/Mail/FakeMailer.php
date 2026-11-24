<?php

declare(strict_types=1);

namespace Kocluk\Api\Mail;

/**
 * In-memory mailer for tests and local previews.
 *
 * Nothing leaves the process; tests read the captured messages to recover the
 * raw token from the e-mail link, exactly as a user would.
 */
final class FakeMailer implements Mailer
{
    /** @var list<array{to: string, subject: string, html: string}> */
    private array $messages = [];

    public function send(string $to, string $subject, string $html): void
    {
        $this->messages[] = [
            'to' => $to,
            'subject' => $subject,
            'html' => $html,
        ];
    }

    /**
     * @return list<array{to: string, subject: string, html: string}>
     */
    public function messages(): array
    {
        return $this->messages;
    }

    /**
     * @return array{to: string, subject: string, html: string}|null
     */
    public function last(): ?array
    {
        if ($this->messages === []) {
            return null;
        }

        return $this->messages[array_key_last($this->messages)];
    }

    public function count(): int
    {
        return count($this->messages);
    }

    public function clear(): void
    {
        $this->messages = [];
    }
}
