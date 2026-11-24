<?php

declare(strict_types=1);

namespace Kocluk\Api\Tests\Unit;

use Kocluk\Api\Support\ConfigFile;
use PHPUnit\Framework\TestCase;

/**
 * The web front controller and the migration CLI must resolve configuration in
 * exactly the same order: KOCLUK_CONFIG, then the file outside public_html,
 * then the in-tree api/config.php development fallback.
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

        foreach (glob($this->root . '/*') ?: [] as $file) {
            @unlink($file);
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
}
