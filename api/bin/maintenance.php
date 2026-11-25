<?php

declare(strict_types=1);

/**
 * Retention / cleanup CLI (design §6.4, §7.3).
 *
 * Usage:
 *   php api/bin/maintenance.php [--dry-run]
 *                               [--change-log-days=90]
 *                               [--rate-limit-hours=24]
 *
 * Removes sync_changes older than the 90-day retention window, used/expired
 * password-reset and e-mail-verification tokens, revoked/expired sessions and
 * rate-limit rows outside every window. It never touches user data.
 *
 * Cron (04:00 server time, one hour after the backup):
 *   0 4 * * * KOCLUK_CONFIG=/home/u2964068/kocluk-config.php \
 *     /usr/local/bin/php /home/u2964068/public_html/api/bin/maintenance.php \
 *     >> /home/u2964068/kocluk-backups/maintenance.log 2>&1
 *
 * The log file stays outside public_html and contains only aggregate counts.
 */

use Kocluk\Api\Db\Database;
use Kocluk\Api\Maintenance\MaintenanceService;
use Kocluk\Api\Support\ConfigFile;
use Kocluk\Api\Support\ConfigGuard;

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit(1);
}

require dirname(__DIR__) . '/src/bootstrap.php';

function maintenanceUsage(): string
{
    return <<<'TEXT'
Kullanım: php api/bin/maintenance.php [seçenekler]

  --dry-run                Yalnızca silinecek satır sayılarını yazdır.
  --change-log-days=N      sync_changes saklama süresi, 90-365 (varsayılan 90).
  --rate-limit-hours=N     rate_limits saklama süresi, 1-168 (varsayılan 24).
  -h, --help               Bu metni göster.

Çıkış kodları: 0 başarılı, 1 çalışma hatası, 2 kullanım hatası.

TEXT;
}

/**
 * @param list<string> $argv
 * @return array{change_log_days: ?int, rate_limit_hours: ?int, dry_run: bool, help: bool}
 */
function maintenanceParseOptions(array $argv): array
{
    $options = [
        'change_log_days' => null,
        'rate_limit_hours' => null,
        'dry_run' => false,
        'help' => false,
    ];

    foreach (array_slice($argv, 1) as $argument) {
        if ($argument === '--help' || $argument === '-h') {
            $options['help'] = true;
            continue;
        }

        if ($argument === '--dry-run') {
            $options['dry_run'] = true;
            continue;
        }

        if (str_starts_with($argument, '--change-log-days=')) {
            $value = substr($argument, strlen('--change-log-days='));

            if ($value === '' || !ctype_digit($value)) {
                throw new InvalidArgumentException('--change-log-days pozitif bir tam sayı olmalı.');
            }

            $options['change_log_days'] = (int) $value;
            continue;
        }

        if (str_starts_with($argument, '--rate-limit-hours=')) {
            $value = substr($argument, strlen('--rate-limit-hours='));

            if ($value === '' || !ctype_digit($value)) {
                throw new InvalidArgumentException('--rate-limit-hours pozitif bir tam sayı olmalı.');
            }

            $options['rate_limit_hours'] = (int) $value;
            continue;
        }

        throw new InvalidArgumentException('Bilinmeyen seçenek: ' . $argument);
    }

    return $options;
}

try {
    $options = maintenanceParseOptions($argv);
} catch (InvalidArgumentException $error) {
    fwrite(STDERR, 'HATA: ' . $error->getMessage() . "\n\n" . maintenanceUsage());
    exit(2);
}

if ($options['help']) {
    fwrite(STDOUT, maintenanceUsage());
    exit(0);
}

$configPath = ConfigFile::path(dirname(__DIR__));

if ($configPath === null) {
    fwrite(STDERR, "HATA: config.php bulunamadı. KOCLUK_CONFIG ortam değişkenini ayarlayın.\n");
    exit(1);
}

$config = require $configPath;

if (!is_array($config)) {
    fwrite(STDERR, 'HATA: Yapılandırma bir dizi döndürmeli: ' . $configPath . "\n");
    exit(1);
}

try {
    ConfigGuard::assertSafe(
        $config,
        ConfigFile::isStagingContext(dirname(__DIR__)),
        $configPath,
    );

    $maintenanceConfig = is_array($config['maintenance'] ?? null) ? $config['maintenance'] : [];
    $days = $options['change_log_days'] ?? $maintenanceConfig['change_log_days']
        ?? MaintenanceService::DEFAULT_CHANGE_LOG_DAYS;
    $hours = $options['rate_limit_hours'] ?? $maintenanceConfig['rate_limit_hours']
        ?? MaintenanceService::DEFAULT_RATE_LIMIT_HOURS;

    if (is_string($days) && ctype_digit($days)) {
        $days = (int) $days;
    }
    if (is_string($hours) && ctype_digit($hours)) {
        $hours = (int) $hours;
    }

    $database = Database::connect(
        is_array($config['db'] ?? null) ? $config['db'] : [],
    );

    $result = (new MaintenanceService($database))->run([
        'change_log_days' => $days,
        'rate_limit_hours' => $hours,
        'dry_run' => $options['dry_run'],
    ]);
} catch (Throwable $error) {
    fwrite(STDERR, 'HATA: Temizlik çalıştırılamadı: ' . $error->getMessage() . "\n");
    exit(1);
}

$prefix = $result['dryRun'] ? 'Silinecek' : 'Silindi';

fwrite(STDOUT, 'Temizlik ' . ($result['dryRun'] ? '(dry-run) ' : '') . "tamam.\n");
fwrite(STDOUT, $prefix . ': sync_changes=' . $result['syncChanges']
    . ', password_resets=' . $result['passwordResets']
    . ', email_verifications=' . $result['emailVerifications']
    . ', sessions=' . $result['sessions']
    . ', rate_limits=' . $result['rateLimits'] . "\n");

exit(0);
