<?php

declare(strict_types=1);

namespace Kocluk\Api\Tests\Unit;

use Kocluk\Api\Support\ConfigFile;
use PHPUnit\Framework\TestCase;

/**
 * The web front controller and the migration CLI must resolve configuration in
 * exactly the same order: KOCLUK_CONFIG, then the staging marker (which allows
 * only the staging config), then the production file outside public_html and
 * the in-tree api/config.php development fallback.
 */
final class ConfigTest extends TestCase
{
    private string $root;

    private string|false $envBackup;

    protected function setUp(): void
    {
        $this->envBackup = getenv('KOCLUK_CONFIG');
        putenv('KOCLUK_CONFIG');

        $this->root = sys_get_temp_dir() . '/kocluk-config-' . bin2hex(random_bytes(8));
        self::assertTrue(mkdir($this->root));
    }

    protected function tearDown(): void
    {
        if ($this->envBackup === false) {
            putenv('KOCLUK_CONFIG');
        } else {
            putenv('KOCLUK_CONFIG=' . $this->envBackup);
        }

        $entries = array_merge(
            glob($this->root . '/*') ?: [],
            glob($this->root . '/.*') ?: [],
        );

        foreach ($entries as $file) {
            if (basename($file) === '.' || basename($file) === '..') {
                continue;
            }

            if (is_dir($file)) {
                @rmdir($file);
            } else {
                @unlink($file);
            }
        }

        @rmdir($this->root);
    }

    public function test_external_config_is_tried_before_the_in_tree_fallback(): void
    {
        $external = $this->root . '/home-config.php';

        self::assertSame(
            [$external, $this->root . '/config.php'],
            ConfigFile::candidates($this->root, $external),
        );
    }

    public function test_env_override_replaces_the_candidate_list(): void
    {
        $external = $this->root . '/staging.php';
        putenv('KOCLUK_CONFIG=' . $external);

        self::assertSame([$external], ConfigFile::candidates($this->root));
    }

    public function test_path_prefers_the_external_file_over_the_in_tree_file(): void
    {
        $external = $this->root . '/home-config.php';
        $inTree = $this->root . '/config.php';

        self::assertNotFalse(file_put_contents($external, '<?php return [];'));
        self::assertNotFalse(file_put_contents($inTree, '<?php return [];'));

        self::assertSame($external, ConfigFile::path($this->root, $external));
    }

    public function test_path_falls_back_to_the_in_tree_file(): void
    {
        $inTree = $this->root . '/config.php';
        self::assertNotFalse(file_put_contents($inTree, '<?php return [];'));

        self::assertSame($inTree, ConfigFile::path($this->root, $this->root . '/missing.php'));
    }

    public function test_path_returns_null_when_no_candidate_exists(): void
    {
        self::assertNull(ConfigFile::path($this->root, $this->root . '/missing.php'));
    }

    public function test_env_override_does_not_silently_fall_back(): void
    {
        $inTree = $this->root . '/config.php';
        self::assertNotFalse(file_put_contents($inTree, '<?php return [];'));

        putenv('KOCLUK_CONFIG=' . $this->root . '/typo.php');

        self::assertNull(ConfigFile::path($this->root, $this->root . '/home-config.php'));
    }

    public function test_example_config_defaults_to_a_secure_production_cookie(): void
    {
        $config = $this->exampleConfig();

        self::assertSame('production', $config['app']['env']);
        self::assertTrue($config['session']['secure']);
        self::assertSame('__Host-kocluk_session', $config['session']['cookie_name']);
    }

    public function test_staging_marker_selects_only_the_staging_config(): void
    {
        $marker = $this->root . '/.kocluk-staging';
        $staging = $this->root . '/staging.php';
        $production = $this->root . '/production.php';

        self::assertNotFalse(file_put_contents($marker, "staging\n"));
        self::assertNotFalse(file_put_contents($staging, '<?php return [];'));
        self::assertNotFalse(file_put_contents($production, '<?php return [];'));

        self::assertTrue(ConfigFile::isStagingRoot($this->root, $marker));
        self::assertSame(
            [$staging],
            ConfigFile::candidates($this->root, $production, $staging, $marker),
        );
        self::assertSame(
            $staging,
            ConfigFile::path($this->root, $production, $staging, $marker),
        );
    }

    public function test_staging_marker_without_config_fails_closed(): void
    {
        $marker = $this->root . '/.kocluk-staging';
        $production = $this->root . '/production.php';

        self::assertNotFalse(file_put_contents($marker, "staging\n"));
        self::assertNotFalse(file_put_contents($production, '<?php return [];'));

        self::assertNull(ConfigFile::path(
            $this->root,
            $production,
            $this->root . '/missing-staging.php',
            $marker,
        ));
    }

    public function test_staging_marker_is_detected_next_to_the_api_root(): void
    {
        $api = $this->root . '/api';
        self::assertTrue(mkdir($api));
        self::assertFalse(ConfigFile::isStagingRoot($api));

        self::assertNotFalse(file_put_contents($this->root . '/.kocluk-staging', 'staging'));

        self::assertTrue(ConfigFile::isStagingRoot($api));
    }

    public function test_example_config_uses_a_plain_cookie_in_development(): void
    {
        $config = $this->exampleConfig(['APP_ENV' => 'development']);

        self::assertSame('development', $config['app']['env']);
        self::assertFalse($config['session']['secure']);
        self::assertSame('kocluk_session', $config['session']['cookie_name']);
    }

    /**
     * Loads api/config.example.php with a controlled environment, restoring
     * every variable afterwards.
     *
     * @param array<string, string> $env
     * @return array<string, mixed>
     */
    private function exampleConfig(array $env = []): array
    {
        $names = ['APP_ENV', 'SESSION_COOKIE_NAME', 'SESSION_SECURE'];
        $saved = [];

        foreach ($names as $name) {
            $saved[$name] = getenv($name);
            putenv($name);
        }

        foreach ($env as $name => $value) {
            putenv($name . '=' . $value);
        }

        try {
            $config = require dirname(__DIR__, 2) . '/config.example.php';
        } finally {
            foreach ($saved as $name => $value) {
                if ($value === false) {
                    putenv($name);
                } else {
                    putenv($name . '=' . $value);
                }
            }
        }

        self::assertIsArray($config);

        /** @var array<string, mixed> $config */
        return $config;
    }
}
