<?php

namespace App\Application\Helpers;

class EmailHelper
{
    /**
     * Normalize email address based on provider rules
     * - Handle generic + alias
     * - Handle generic . dot aliases where applicable (e.g. gmail)
     */
    public static function normalize(string $email): string
    {
        $email = trim(strtolower($email));
        $parts = explode('@', $email);

        if (count($parts) !== 2) {
            return $email;
        }

        list($local, $domain) = $parts;

        // Providers that ignore everything after +
        // Google, Microsoft, Apple, Fastmail, ProtonMail etc support + aliases
        if (strpos($local, '+') !== false) {
            $local = explode('+', $local)[0];
        }

        // Providers that ignore dots in local part
        $providersIgnoringDots = ['gmail.com', 'googlemail.com'];
        if (in_array($domain, $providersIgnoringDots)) {
            $local = str_replace('.', '', $local);
        }

        return $local . '@' . $domain;
    }
}
