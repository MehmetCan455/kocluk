<?php

declare(strict_types=1);

namespace Kocluk\Api\Db;

use InvalidArgumentException;
use PDO;
use RuntimeException;
use Throwable;

/**
 * Thin PDO wrapper shared by the API and the migration runner.
 *
 * The connection is pinned to utf8mb4/utf8mb4_unicode_ci and UTC so that
 * client DATETIME(6) values, NOW(6) and the generated active_* columns all
 * agree. Prepared statements use native MySQL prepares (no emulation).
 */
final class Database
{
    private function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * @param array{
     *     host?: string,
     *     port?: int|string,
     *     database?: string,
     *     username?: string,
     *     password?: string
     * } $config
     */
    public static function connect(array $config): self
    {
        $database = (string) ($config['database'] ?? '');

        if ($database === '') {
            throw new InvalidArgumentException('Veritabanı adı (db.database) zorunlu.');
        }

        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
            (string) ($config['host'] ?? '127.0.0.1'),
            (int) ($config['port'] ?? 3306),
            $database,
        );

        $pdo = new PDO(
            $dsn,
            (string) ($config['username'] ?? ''),
            (string) ($config['password'] ?? ''),
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
                PDO::ATTR_STRINGIFY_FETCHES => false,
            ],
        );

        $pdo->exec('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci');
        $pdo->exec("SET time_zone = '+00:00'");

        return new self($pdo);
    }

    /**
     * Runs the callback in a transaction and returns its result.
     *
     * A nested call reuses the outer transaction. MySQL commits DDL
     * implicitly, so the commit is skipped when the server already ended the
     * transaction (migration DDL); the caller's migration files are written
     * to be re-runnable for exactly that case.
     */
    public function transaction(callable $fn): mixed
    {
        if ($this->pdo->inTransaction()) {
            return $fn($this);
        }

        $this->pdo->beginTransaction();

        try {
            $result = $fn($this);

            if ($this->pdo->inTransaction()) {
                $this->pdo->commit();
            }

            return $result;
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }

            throw $error;
        }
    }

    /**
     * @param list<mixed>|array<string, mixed> $params
     * @return array<string, mixed>|null
     */
    public function fetchOne(string $sql, array $params = []): ?array
    {
        $statement = $this->pdo->prepare($sql);
        $statement->execute($params);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        $statement->closeCursor();

        return $row === false ? null : $row;
    }

    /**
     * @param list<mixed>|array<string, mixed> $params
     * @return list<array<string, mixed>>
     */
    public function fetchAll(string $sql, array $params = []): array
    {
        $statement = $this->pdo->prepare($sql);
        $statement->execute($params);

        /** @var list<array<string, mixed>> $rows */
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

        return $rows;
    }

    /**
     * @param list<mixed>|array<string, mixed> $params
     */
    public function execute(string $sql, array $params = []): int
    {
        $statement = $this->pdo->prepare($sql);
        $statement->execute($params);

        return $statement->rowCount();
    }

    /**
     * Streams rows from an unbuffered MySQL result so a backup does not hold a
     * whole table in PHP or in the PDO client buffer.
     *
     * The caller must not run another query on this connection until the
     * generator is exhausted (or destroyed); closeCursor() releases the
     * server-side result in the finally block.
     *
     * @return iterable<int, array<string, mixed>>
     */
    public function iterate(string $sql): iterable
    {
        // PDO MySQL defaults to buffered results; switch this connection to
        // unbuffered while the generator is alive, then restore the default.
        // No other query may run on this connection until iteration finishes.
        $this->pdo->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, false);
        $statement = null;

        try {
            $statement = $this->pdo->query($sql);

            if ($statement === false) {
                throw new RuntimeException('Sorgu çalıştırılamadı.');
            }

            while (($row = $statement->fetch(PDO::FETCH_ASSOC)) !== false) {
                yield $row;
            }
        } finally {
            if ($statement !== null && $statement !== false) {
                $statement->closeCursor();
            }

            $this->pdo->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, true);
        }
    }

    /**
     * Quotes a string literal for the PDO MySQL driver.
     *
     * Only the backup CLI uses this; application queries stay prepared.
     */
    public function quote(string $value): string
    {
        $quoted = $this->pdo->quote($value);

        if ($quoted === false) {
            throw new RuntimeException('Değer SQL için kaçırılamadı.');
        }

        return $quoted;
    }

    /**
     * Runs a raw statement that cannot be prepared (DDL, SET, SHOW).
     */
    public function exec(string $sql): int
    {
        $affected = $this->pdo->exec($sql);

        return $affected === false ? 0 : $affected;
    }
}
