<?php

declare(strict_types=1);

namespace Kocluk\Api\Mail;

use Throwable;

/**
 * Queues transactional e-mail until after the HTTP response is sent.
 *
 * Password-reset and registration requests must not block on SMTP: a known
 * address and an unknown address would otherwise take different amounts of
 * time, leaking account existence, and a slow mail server would delay the
 * response. DeferredMailer keeps Mailer's synchronous interface for callers
 * that do not care, adds queue() with an optional failure callback for token
 * cleanup, and flushes from a shutdown callback registered on first queue.
 *
 * In production api/index.php closes the connection first (FastCGI or
 * LiteSpeed) and the shutdown callback then talks to SMTP. Tests use flush()
 * explicitly or construct the wrapper with $immediate = true so existing
 * assertions keep seeing mail synchronously.
 */
final class DeferredMailer implements Mailer
{
    /** @var list<array{to: string, subject: string, html: string, onFailure: (callable(Throwable): void)|null}> */
    private array $queue = [];

    private bool $shutdownRegistered = false;

    public function __construct(
        private readonly Mailer $inner,
        private readonly bool $immediate = false,
    ) {
    }

    public function send(string $to, string $subject, string $html): void
    {
        $this->queue($to, $subject, $html);
    }

    /**
     * @param (callable(Throwable): void)|null $onFailure
     */
    public function queue(string $to, string $subject, string $html, ?callable $onFailure = null): void
    {
        if ($this->immediate) {
            $this->deliver($to, $subject, $html, $onFailure, true);

            return;
        }

        $this->queue[] = [
            'to' => $to,
            'subject' => $subject,
            'html' => $html,
            'onFailure' => $onFailure,
        ];

        $this->registerShutdownFlush();
    }

    /**
     * Sends every queued message. Each failure is isolated: the callback (if
     * any) runs, otherwise the failure is logged, and the next message is
     * still attempted. Never throws; this runs after the response.
     */
    public function flush(): void
    {
        $jobs = $this->queue;
        $this->queue = [];

        foreach ($jobs as $job) {
            $this->deliver($job['to'], $job['subject'], $job['html'], $job['onFailure'], false);
        }
    }

    public function pending(): int
    {
        return count($this->queue);
    }

    /**
     * @param (callable(Throwable): void)|null $onFailure
     */
    private function deliver(
        string $to,
        string $subject,
        string $html,
        ?callable $onFailure,
        bool $rethrow,
    ): void {
        try {
            $this->inner->send($to, $subject, $html);
        } catch (Throwable $error) {
            if ($onFailure !== null) {
                try {
                    $onFailure($error);
                } catch (Throwable $cleanupError) {
                    self::log($cleanupError);
                }

                return;
            }

            if ($rethrow) {
                throw $error;
            }

            self::log($error);
        }
    }

    private function registerShutdownFlush(): void
    {
        if ($this->shutdownRegistered) {
            return;
        }

        $this->shutdownRegistered = true;

        register_shutdown_function(function (): void {
            $this->flush();
        });
    }

    private static function log(Throwable $error): void
    {
        // The concrete transport logs its sanitized cause; this line only
        // records that an unhandled deferred message failed.
        error_log(sprintf(
            'kocluk-api deferred mail failed: %s: %s',
            $error::class,
            mb_substr($error->getMessage(), 0, 200),
        ));
    }
}
