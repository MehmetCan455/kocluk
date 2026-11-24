<?php

declare(strict_types=1);

namespace Kocluk\Api\Mail;

use RuntimeException;
use Throwable;

/**
 * Turkish transactional e-mail bodies (spec §7.4).
 *
 * Links put the token in the URL fragment, so the browser never sends it in a
 * Referer header to the API or any third party. The base URL comes from
 * config.app_url (falling back to app.base_url in App).
 */
final class Templates
{
    private const DEFAULT_APP_URL = 'https://zirveacademy.com';

    private const RESET_PATH = 'sifre-sifirla';

    private const VERIFY_PATH = 'eposta-dogrula';

    private readonly string $appUrl;

    public function __construct(string $appUrl)
    {
        $trimmed = rtrim(trim($appUrl), '/');

        $this->appUrl = $trimmed === '' ? self::DEFAULT_APP_URL : $trimmed;
    }

    /**
     * @return array{subject: string, html: string}
     */
    public function reset(string $displayName, string $token): array
    {
        return [
            'subject' => 'Zirve Academy şifre sıfırlama bağlantınız',
            'html' => $this->render('reset', [
                'displayName' => $displayName,
                'url' => $this->resetLink($token),
            ]),
        ];
    }

    /**
     * @return array{subject: string, html: string}
     */
    public function verify(string $displayName, string $token): array
    {
        return [
            'subject' => 'Zirve Academy e-posta adresinizi doğrulayın',
            'html' => $this->render('verify', [
                'displayName' => $displayName,
                'url' => $this->verifyLink($token),
            ]),
        ];
    }

    public function resetLink(string $token): string
    {
        return $this->link(self::RESET_PATH, $token);
    }

    public function verifyLink(string $token): string
    {
        return $this->link(self::VERIFY_PATH, $token);
    }

    private function link(string $path, string $token): string
    {
        return $this->appUrl . '/#/' . $path . '?token=' . rawurlencode($token);
    }

    /**
     * @param array<string, string> $variables
     */
    private function render(string $template, array $variables): string
    {
        $path = dirname(__DIR__, 2) . '/templates/email/' . $template . '.php';

        if (!is_file($path)) {
            throw new RuntimeException('E-posta şablonu bulunamadı: ' . $template);
        }

        $render = static function (string $file, array $data): string {
            /**
             * @var array<string, string> $data
             * @var string $displayName
             * @var string $url
             */
            extract($data, EXTR_SKIP);

            ob_start();

            try {
                require $file;

                return (string) ob_get_clean();
            } catch (Throwable $error) {
                ob_end_clean();

                throw $error;
            }
        };

        return $render($path, $variables);
    }
}
