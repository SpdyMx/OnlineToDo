<?php

namespace App\Application\Helpers;

class E2EEncryption
{
    private static $platformKey = 'P@1atf0rmK3y_OOnl1neT0Do!';

    public static function encrypt(string $data, string $userSalt, string $sessionPepper): string
    {
        $sessionKeyString = self::$platformKey . $userSalt . $sessionPepper;
        $keyHash = hash('sha256', $sessionKeyString, true);
        $iv = openssl_random_pseudo_bytes(16);
        $encrypted = openssl_encrypt($data, 'aes-256-cbc', $keyHash, 0, $iv); // Returns base64
        return base64_encode($encrypted . '::' . base64_encode($iv));
    }

    public static function decrypt(string $payload, string $userSalt, string $sessionPepper): string
    {
        $sessionKeyString = self::$platformKey . $userSalt . $sessionPepper;
        $keyHash = hash('sha256', $sessionKeyString, true);

        $decoded = base64_decode($payload);
        $parts = explode('::', $decoded, 2);
        if (count($parts) !== 2)
            return '';

        $encryptedB64 = $parts[0];
        $ivB64 = $parts[1];
        $iv = base64_decode($ivB64);

        $decrypted = openssl_decrypt($encryptedB64, 'aes-256-cbc', $keyHash, 0, $iv);
        return $decrypted !== false ? $decrypted : '';
    }
}
