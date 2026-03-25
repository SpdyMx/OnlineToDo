<?php

namespace App\Infrastructure;

use PDO;
use Exception;

class Database
{
    private static $mainDb = null;
    private static $userDbs = [];

    public static function getMainDb(): PDO
    {
        if (self::$mainDb === null) {
            $path = __DIR__ . '/../../var/main.sqlite';
            $isNew = !file_exists($path);
            if (!file_exists(__DIR__ . '/../../var')) {
                mkdir(__DIR__ . '/../../var', 0777, true);
            }
            $pdo = new PDO('sqlite:' . $path);
            $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

            if ($isNew) {
                $pdo->exec('CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    primary_mail TEXT NOT NULL UNIQUE,
                    normalized_mail TEXT NOT NULL UNIQUE,
                    recovery_mail TEXT,
                    password_hash TEXT NOT NULL,
                    two_factor_secret TEXT,
                    db_file TEXT NOT NULL,
                    db_key TEXT NOT NULL,
                    is_verified INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )');
            }
            else {
                // Ensure new columns exist
                try {
                    $pdo->exec('ALTER TABLE users ADD COLUMN normalized_mail TEXT');
                }
                catch (Exception $e) {
                }
                try {
                    $pdo->exec('ALTER TABLE users ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 0');
                }
                catch (Exception $e) {
                }
                try {
                    $pdo->exec('ALTER TABLE users ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
                }
                catch (Exception $e) {
                }
                try {
                    $pdo->exec('UPDATE users SET normalized_mail = primary_mail WHERE normalized_mail IS NULL');
                }
                catch (Exception $e) {
                }
                try {
                    $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_normalized_mail ON users(normalized_mail)');
                }
                catch (Exception $e) {
                }
            }

            $pdo->exec('CREATE TABLE IF NOT EXISTS email_verifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                email TEXT NOT NULL,
                code TEXT NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )');

            $pdo->exec('CREATE TABLE IF NOT EXISTS password_resets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                token TEXT NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )');

            self::$mainDb = $pdo;
        }
        return self::$mainDb;
    }

    public static function getUserDb(string $dbFile): PDO
    {
        if (isset(self::$userDbs[$dbFile])) {
            return self::$userDbs[$dbFile];
        }

        $path = __DIR__ . '/../../var/' . $dbFile . '.sqlite';
        $isNew = !file_exists($path);

        $pdo = new PDO('sqlite:' . $path);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

        if ($isNew) {
            $pdo->exec('CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                color TEXT NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT 0,
                deleted_at INTEGER NOT NULL DEFAULT 0
            )');

            $pdo->exec('CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                due_date TEXT,
                tag_id INTEGER NOT NULL,
                state TEXT NOT NULL DEFAULT "new",
                updated_at INTEGER NOT NULL DEFAULT 0,
                deleted_at INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY(tag_id) REFERENCES tags(id)
            )');

            $pdo->exec('CREATE TABLE IF NOT EXISTS task_comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                comment TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(task_id) REFERENCES tasks(id)
            )');

            $pdo->exec('CREATE TABLE IF NOT EXISTS states (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                state TEXT NOT NULL UNIQUE
            )');

            $time = time();
            // Default tags
            $stmt = $pdo->prepare('INSERT INTO tags (title, color, updated_at) VALUES (?, ?, ?)');
            $stmt->execute(['work', '#0ea5e9', $time]);
            $stmt->execute(['personal', '#10b981', $time]);

            // Default states
            $stmt = $pdo->prepare('INSERT INTO states (state) VALUES (?)');
            $stmt->execute(['new']);
            $stmt->execute(['started']);
            $stmt->execute(['finished']);
        }
        else {
            // Upgrade existing DBs dynamically if needed
            try {
                $pdo->exec('ALTER TABLE tags ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0');
            }
            catch (Exception $e) {
            }
            try {
                $pdo->exec('ALTER TABLE tags ADD COLUMN deleted_at INTEGER NOT NULL DEFAULT 0');
            }
            catch (Exception $e) {
            }
            try {
                $pdo->exec('ALTER TABLE tasks ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0');
            }
            catch (Exception $e) {
            }
            try {
                $pdo->exec('ALTER TABLE tasks ADD COLUMN deleted_at INTEGER NOT NULL DEFAULT 0');
            }
            catch (Exception $e) {
            }
        }

        self::$userDbs[$dbFile] = $pdo;
        return $pdo;
    }

    // A helper to encrypt content
    public static function encrypt(string $data, string $key): string
    {
        $iv = openssl_random_pseudo_bytes(openssl_cipher_iv_length('aes-256-cbc'));
        $encrypted = openssl_encrypt($data, 'aes-256-cbc', hash('sha256', $key, true), 0, $iv);
        return base64_encode($encrypted . '::' . $iv);
    }

    public static function decrypt(string $data, string $key): string
    {
        list($encrypted_data, $iv) = explode('::', base64_decode($data), 2);
        return openssl_decrypt($encrypted_data, 'aes-256-cbc', hash('sha256', $key, true), 0, $iv);
    }
}
