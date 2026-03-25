<?php

declare(strict_types = 1)
;

use App\Application\Middleware\AuthMiddleware;
use App\Application\Middleware\CorsMiddleware;
use App\Infrastructure\Database;
use Firebase\JWT\JWT;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\App;
use Slim\Routing\RouteCollectorProxy;
use PragmaRX\Google2FA\Google2FA;

return function (App $app) {

    // Global CORS
    $app->add(CorsMiddleware::class);

    // Options
    $app->options('/{routes:.*}', function (Request $request, Response $response) {
            return $response;
        }
        );

        $jwtSecret = 'b21ef45d8b8a0dd3e2a9e22dbb3db48e';

        $app->post('/api/register', function (Request $request, Response $response) {
            $body = $request->getParsedBody();
            $name = $body['name'] ?? null;
            $displayName = $body['displayName'] ?? null;
            $primaryMail = $body['primaryMail'] ?? null;
            $password = $body['password'] ?? null;

            if (!$name || !$displayName || !$primaryMail || !$password) {
                $response->getBody()->write(json_encode(['error' => 'Missing fields']));
                return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
            }

            $db = Database::getMainDb();
            $normalizedMail = \App\Application\Helpers\EmailHelper::normalize($primaryMail);

            $stmt = $db->prepare('SELECT id FROM users WHERE normalized_mail = ?');
            $stmt->execute([$normalizedMail]);
            if ($stmt->fetch()) {
                $response->getBody()->write(json_encode(['error' => 'this mail account is use on an existing account']));
                return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
            }

            $hash = password_hash($password, PASSWORD_DEFAULT);
            $dbFile = bin2hex(random_bytes(16)); // 32 chars a-f0-9
            $dbKey = bin2hex(random_bytes(32));

            $stmt = $db->prepare('INSERT INTO users (name, display_name, primary_mail, normalized_mail, password_hash, db_file, db_key) VALUES (?, ?, ?, ?, ?, ?, ?)');
            $stmt->execute([$name, $displayName, $primaryMail, $normalizedMail, $hash, $dbFile, $dbKey]);
            $userId = $db->lastInsertId();

            // Generate 6 digit code
            $code = sprintf("%06d", mt_rand(1, 999999));
            $expiresAt = date('Y-m-d H:i:s', time() + 3600); // 1 hour validity for code
            $stmt = $db->prepare('INSERT INTO email_verifications (user_id, email, code, expires_at) VALUES (?, ?, ?, ?)');
            $stmt->execute([$userId, $primaryMail, $code, $expiresAt]);

            // Send Email
            \App\Application\Helpers\EmailSender::send($primaryMail, "Your Verification Code", "Your verification code is <b>$code</b>. It is valid for 1 hour.", "Your verification code is $code. It is valid for 1 hour.");

            // initialize user db
            Database::getUserDb($dbFile);

            $response->getBody()->write(json_encode(['success' => true, 'requiresVerification' => true]));
            return $response->withHeader('Content-Type', 'application/json');
        }
        );

        $app->post('/api/login', function (Request $request, Response $response) use ($jwtSecret) {
            $db = Database::getMainDb();
            try {
                $db->exec("DELETE FROM users WHERE is_verified = 0 AND created_at < datetime('now', '-7 days')");
            }
            catch (\Exception $e) {
            }

            $body = $request->getParsedBody();
            $primaryMail = $body['primaryMail'] ?? null;
            $password = $body['password'] ?? null;
            $twoFactorCode = $body['twoFactorCode'] ?? null;

            if (!$primaryMail || !$password) {
                $response->getBody()->write(json_encode(['error' => 'Missing fields']));
                return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
            }

            $db = Database::getMainDb();
            $stmt = $db->prepare('SELECT id, password_hash, two_factor_secret, db_file, db_key FROM users WHERE primary_mail = ?');
            $stmt->execute([$primaryMail]);
            $user = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!$user || !password_verify($password, $user['password_hash'])) {
                $response->getBody()->write(json_encode(['error' => 'Invalid credentials']));
                return $response->withStatus(401)->withHeader('Content-Type', 'application/json');
            }

            if ($user['two_factor_secret']) {
                if (!$twoFactorCode) {
                    // Must provide 2FA
                    $response->getBody()->write(json_encode(['error' => '2FA required', 'require2FA' => true]));
                    return $response->withStatus(401)->withHeader('Content-Type', 'application/json');
                }
                $google2fa = new Google2FA();
                $valid = $google2fa->verifyKey($user['two_factor_secret'], $twoFactorCode);
                if (!$valid) {
                    $response->getBody()->write(json_encode(['error' => 'Invalid 2FA code']));
                    return $response->withStatus(401)->withHeader('Content-Type', 'application/json');
                }
            }

            $sessionPepper = bin2hex(random_bytes(16));
            $payload = [
                'iat' => time(),
                'exp' => time() + 86400,
                'data' => [
                    'userId' => $user['id'],
                    'dbFile' => $user['db_file'],
                    'dbKey' => $user['db_key'],
                    'sessionPepper' => $sessionPepper
                ]
            ];

            $token = JWT::encode($payload, $jwtSecret, 'HS256');

            $response->getBody()->write(json_encode(['token' => $token, 'userSalt' => $user['db_key'], 'sessionPepper' => $sessionPepper]));
            return $response->withHeader('Content-Type', 'application/json');
        }
        );

        $app->post('/api/verify-email', function (Request $request, Response $response) {
            $body = $request->getParsedBody();
            $email = $body['email'] ?? null;
            $code = $body['code'] ?? null;

            if (!$email || !$code) {
                $response->getBody()->write(json_encode(['error' => 'Missing fields']));
                return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
            }

            $db = Database::getMainDb();
            $stmt = $db->prepare('SELECT * FROM email_verifications WHERE email = ? AND code = ? AND expires_at > datetime("now") ORDER BY id DESC LIMIT 1');
            $stmt->execute([$email, $code]);
            $verification = $stmt->fetch();

            if (!$verification) {
                $response->getBody()->write(json_encode(['error' => 'Invalid or expired code']));
                return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
            }

            $stmt = $db->prepare('UPDATE users SET is_verified = 1 WHERE id = ?');
            $stmt->execute([$verification['user_id']]);

            $stmt = $db->prepare('DELETE FROM email_verifications WHERE user_id = ?');
            $stmt->execute([$verification['user_id']]);

            $response->getBody()->write(json_encode(['success' => true]));
            return $response->withHeader('Content-Type', 'application/json');
        }
        );

        $app->post('/api/forgot-password', function (Request $request, Response $response) {
            $body = $request->getParsedBody();
            $email = $body['email'] ?? null;

            if (!$email)
                return $response->withStatus(400);

            $db = Database::getMainDb();
            $normalizedMail = \App\Application\Helpers\EmailHelper::normalize($email);
            $stmt = $db->prepare('SELECT id FROM users WHERE normalized_mail = ?');
            $stmt->execute([$normalizedMail]);
            $user = $stmt->fetch();

            if ($user) {
                $stmt = $db->prepare('SELECT COUNT(*) as cnt FROM password_resets WHERE user_id = ? AND created_at > datetime("now", "-1 day")');
                $stmt->execute([$user['id']]);
                if ($stmt->fetch()['cnt'] < 5) {
                    $token = bin2hex(random_bytes(32));
                    $expiresAt = date('Y-m-d H:i:s', time() + 3600);
                    $stmt = $db->prepare('INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)');
                    $stmt->execute([$user['id'], $token, $expiresAt]);

                    $uri = $request->getUri();
                    $base = $uri->getScheme() . "://" . $uri->getHost() . ($uri->getPort() ? ":" . $uri->getPort() : "");
                    $url = $base . "/reset-password?token=" . $token;
                    \App\Application\Helpers\EmailSender::send($email, "Password Reset Request", "Click here to reset your password: <a href='$url'>$url</a> (Valid for 1 hour.)", "Go to this URL to reset your password: $url (Valid for 1 hour.)");
                }
            }
            $response->getBody()->write(json_encode(['success' => true]));
            return $response->withHeader('Content-Type', 'application/json');
        }
        );

        $app->post('/api/reset-password', function (Request $request, Response $response) {
            $body = $request->getParsedBody();
            $token = $body['token'] ?? null;
            $password = $body['password'] ?? null;
            if (!$token || !$password)
                return $response->withStatus(400);

            $db = Database::getMainDb();
            $stmt = $db->prepare('SELECT * FROM password_resets WHERE token = ? AND expires_at > datetime("now")');
            $stmt->execute([$token]);
            $reset = $stmt->fetch();

            if (!$reset) {
                $response->getBody()->write(json_encode(['error' => 'Invalid or expired token']));
                return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
            }

            $hash = password_hash($password, PASSWORD_DEFAULT);
            $stmt = $db->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
            $stmt->execute([$hash, $reset['user_id']]);

            $stmt = $db->prepare('DELETE FROM password_resets WHERE user_id = ?');
            $stmt->execute([$reset['user_id']]);

            $response->getBody()->write(json_encode(['success' => true]));
            return $response->withHeader('Content-Type', 'application/json');
        }
        );

        // Authenticated group
        $app->group('/api', function (RouteCollectorProxy $group) use ($jwtSecret) {

            $group->get('/me', function (Request $request, Response $response) {
                    $userAttr = $request->getAttribute('user');
                    $db = Database::getMainDb();
                    $stmt = $db->prepare('SELECT name, display_name, primary_mail, recovery_mail, two_factor_secret, is_verified FROM users WHERE id = ?');
                    $stmt->execute([$userAttr['userId']]);
                    $user = $stmt->fetch(PDO::FETCH_ASSOC);
                    $user['2fa_enabled'] = !empty($user['two_factor_secret']);
                    $user['is_verified'] = (bool)$user['is_verified'];
                    unset($user['two_factor_secret']);
                    $response->getBody()->write(json_encode($user));
                    return $response->withHeader('Content-Type', 'application/json');
                }
                );

                // Generate 2FA Secret
                $group->post('/me/2fa/generate', function (Request $request, Response $response) {
                    $userAttr = $request->getAttribute('user');
                    $google2fa = new Google2FA();
                    $secret = $google2fa->generateSecretKey();
                    $response->getBody()->write(json_encode(['secret' => $secret]));
                    return $response->withHeader('Content-Type', 'application/json');
                }
                );

                // Validate 2FA Secret
                $group->post('/me/2fa/activate', function (Request $request, Response $response) {
                    $userAttr = $request->getAttribute('user');
                    $body = $request->getParsedBody();
                    $secret = $body['secret'] ?? null;
                    $code = $body['code'] ?? null;
                    if (!$secret || !$code) {
                        $response->getBody()->write(json_encode(['error' => 'Missing fields']));
                        return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
                    }
                    $google2fa = new Google2FA();
                    $valid = $google2fa->verifyKey($secret, $code);
                    if (!$valid) {
                        $response->getBody()->write(json_encode(['error' => 'Invalid code']));
                        return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
                    }
                    $db = Database::getMainDb();
                    $stmt = $db->prepare('UPDATE users SET two_factor_secret = ? WHERE id = ?');
                    $stmt->execute([$secret, $userAttr['userId']]);
                    $response->getBody()->write(json_encode(['success' => true]));
                    return $response->withHeader('Content-Type', 'application/json');
                }
                );

                // Remove 2FA
                $group->post('/me/2fa/remove', function (Request $request, Response $response) {
                    $userAttr = $request->getAttribute('user');
                    $body = $request->getParsedBody();
                    $code = $body['code'] ?? null;
                    $db = Database::getMainDb();
                    $stmt = $db->prepare('SELECT two_factor_secret FROM users WHERE id = ?');
                    $stmt->execute([$userAttr['userId']]);
                    $res = $stmt->fetch();
                    $secret = $res['two_factor_secret'] ?? null;
                    if ($secret) {
                        $google2fa = new Google2FA();
                        if (!$code || !$google2fa->verifyKey($secret, $code)) {
                            $response->getBody()->write(json_encode(['error' => 'Invalid code']));
                            return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
                        }
                    }
                    $stmt = $db->prepare('UPDATE users SET two_factor_secret = NULL WHERE id = ?');
                    $stmt->execute([$userAttr['userId']]);
                    $response->getBody()->write(json_encode(['success' => true]));
                    return $response->withHeader('Content-Type', 'application/json');
                }
                );

                // Sync Data
                $group->post('/sync', function (Request $request, Response $response) {
                    $userAttr = $request->getAttribute('user');
                    $db = Database::getUserDb($userAttr['dbFile']);
                    $dbKey = $userAttr['dbKey'];
                    $body = $request->getParsedBody();
                    $lastSync = isset($body['lastSync']) ? (int)$body['lastSync'] : 0;
                    $mutations = $body['mutations'] ?? [];
                    $idMap = [];

                    foreach ($mutations as $mut) {
                        if (!isset($mut['type']) || !isset($mut['timestamp']))
                            continue;
                        $time = (int)$mut['timestamp'];

                        if ($mut['type'] === 'task_update') {
                            $stmt = $db->prepare('SELECT id, updated_at FROM tasks WHERE id = ?');
                            $stmt->execute([(int)$mut['id']]);
                            $task = $stmt->fetch();
                            if ($task && $task['updated_at'] <= $time) {
                                $data = $mut['data'];
                                $title = isset($data['title']) ?Database::encrypt($data['title'], $dbKey) : null;
                                $desc = isset($data['description']) ?Database::encrypt($data['description'], $dbKey) : null;
                                $dueDate = isset($data['dueDate']) ?Database::encrypt($data['dueDate'], $dbKey) : null;
                                
                                $tagId = $data['tagId'] ?? null;
                                if (is_string($tagId) && isset($idMap[$tagId])) {
                                    $tagId = $idMap[$tagId];
                                } else {
                                    $tagId = (int)$tagId;
                                }

                                $state = $data['state'] ?? 'new';
                                $stmt = $db->prepare('UPDATE tasks SET title = ?, description = ?, due_date = ?, tag_id = ?, state = ?, updated_at = ? WHERE id = ?');
                                $stmt->execute([$title, $desc, $dueDate, $tagId, $state, $time, (int)$mut['id']]);
                            }
                        }
                        elseif ($mut['type'] === 'task_delete') {
                            $stmt = $db->prepare('SELECT id, updated_at FROM tasks WHERE id = ?');
                            $stmt->execute([(int)$mut['id']]);
                            $task = $stmt->fetch();
                            if ($task && $task['updated_at'] <= $time) {
                                $stmt = $db->prepare('UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?');
                                $stmt->execute([$time, $time, (int)$mut['id']]);
                            }
                        }
                        elseif ($mut['type'] === 'task_create') {
                            $data = $mut['data'];
                            $title = isset($data['title']) ?Database::encrypt($data['title'], $dbKey) : '';
                            $desc = isset($data['description']) ?Database::encrypt($data['description'], $dbKey) : null;
                            $dueDate = isset($data['dueDate']) ?Database::encrypt($data['dueDate'], $dbKey) : null;
                            
                            $tagId = $data['tagId'] ?? 0;
                            if (is_string($tagId) && isset($idMap[$tagId])) {
                                $tagId = $idMap[$tagId];
                            } else {
                                $tagId = (int)$tagId;
                            }

                            $state = $data['state'] ?? 'new';
                            $stmt = $db->prepare('INSERT INTO tasks (title, description, due_date, tag_id, state, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
                            $stmt->execute([$title, $desc, $dueDate, $tagId, $state, $time]);
                            if (isset($mut['local_id'])) {
                                $idMap[$mut['local_id']] = $db->lastInsertId();
                            }
                        }
                        elseif ($mut['type'] === 'tag_create') {
                            $data = $mut['data'];
                            $title = $data['title'] ?? 'New Tag';
                            $color = $data['color'] ?? '#0ea5e9';
                            $stmt = $db->prepare('INSERT INTO tags (title, color, updated_at) VALUES (?, ?, ?)');
                            $stmt->execute([$title, $color, $time]);
                            if (isset($mut['local_id'])) {
                                $idMap[$mut['local_id']] = $db->lastInsertId();
                            }
                        }
                        elseif ($mut['type'] === 'tag_delete') {
                            $stmt = $db->prepare('SELECT id, updated_at FROM tags WHERE id = ?');
                            $stmt->execute([(int)$mut['id']]);
                            $tag = $stmt->fetch();
                            if ($tag && $tag['updated_at'] <= $time) {
                                $stmt = $db->prepare('UPDATE tags SET deleted_at = ?, updated_at = ? WHERE id = ?');
                                $stmt->execute([$time, $time, (int)$mut['id']]);
                            }
                        }
                    }

                    $stmt = $db->prepare('SELECT * FROM tags WHERE updated_at > ?');
                    $stmt->execute([$lastSync]);
                    $tags = $stmt->fetchAll(PDO::FETCH_ASSOC);

                    $stmt = $db->prepare('SELECT t.*, g.title as tag_title, g.color as tag_color FROM tasks t LEFT JOIN tags g ON t.tag_id = g.id WHERE t.updated_at > ?');
                    $stmt->execute([$lastSync]);
                    $tasksDb = $stmt->fetchAll(PDO::FETCH_ASSOC);
                    $tasksReturn = [];
                    foreach ($tasksDb as $t) {
                        try {
                            $t['title'] = Database::decrypt($t['title'], $dbKey);
                            $t['description'] = $t['description'] ?Database::decrypt($t['description'], $dbKey) : null;
                            $t['due_date'] = $t['due_date'] ?Database::decrypt($t['due_date'], $dbKey) : null;
                        }
                        catch (\Exception $e) {
                        }
                        $tasksReturn[] = $t;
                    }

                    $response->getBody()->write(json_encode([
                        'success' => true,
                        'serverTime' => time(),
                        'tags' => $tags,
                        'tasks' => $tasksReturn
                    ]));
                    return $response->withHeader('Content-Type', 'application/json');
                }
                );

                // Update profile
                $group->post('/me/update', function (Request $request, Response $response) {
                    $userAttr = $request->getAttribute('user');
                    $body = $request->getParsedBody();
                    $db = Database::getMainDb();

                    if (isset($body['password']) && !empty($body['password'])) {
                        $hash = password_hash($body['password'], PASSWORD_DEFAULT);
                        $stmt = $db->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
                        $stmt->execute([$hash, $userAttr['userId']]);
                    }

                    if (isset($body['primaryMail']) && !empty($body['primaryMail'])) {
                        $newMail = trim($body['primaryMail']);
                        $normalizedMail = \App\Application\Helpers\EmailHelper::normalize($newMail);

                        // Check if it's actually changing
                        $stmt = $db->prepare('SELECT primary_mail FROM users WHERE id = ?');
                        $stmt->execute([$userAttr['userId']]);
                        $oldMail = $stmt->fetchColumn();

                        if ($oldMail !== $newMail) {
                            // Check uniqueness
                            $stmt = $db->prepare('SELECT id FROM users WHERE normalized_mail = ? AND id != ?');
                            $stmt->execute([$normalizedMail, $userAttr['userId']]);
                            if ($stmt->fetchColumn()) {
                                $response->getBody()->write(json_encode(['error' => 'this mail account is use on an existing account']));
                                return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
                            }

                            $stmt = $db->prepare('UPDATE users SET primary_mail = ?, normalized_mail = ?, is_verified = 0 WHERE id = ?');
                            $stmt->execute([$newMail, $normalizedMail, $userAttr['userId']]);

                            // Generate new code
                            $code = sprintf("%06d", mt_rand(1, 999999));
                            $expiresAt = date('Y-m-d H:i:s', time() + 3600);
                            $stmt = $db->prepare('INSERT INTO email_verifications (user_id, email, code, expires_at) VALUES (?, ?, ?, ?)');
                            $stmt->execute([$userAttr['userId'], $newMail, $code, $expiresAt]);

                            \App\Application\Helpers\EmailSender::send($newMail, "Verify Your New Email", "Your verification code is <b>$code</b>. It is valid for 1 hour.", "Your verification code is $code. It is valid for 1 hour.");
                        }
                    }

                    if (isset($body['displayName'])) {
                        $stmt = $db->prepare('UPDATE users SET display_name = ?, recovery_mail = ?, name = ? WHERE id = ?');
                        $stmt->execute([$body['displayName'], $body['recoveryMail'] ?? null, $body['name'] ?? '', $userAttr['userId']]);
                    }

                    $response->getBody()->write(json_encode(['success' => true]));
                    return $response->withHeader('Content-Type', 'application/json');
                }
                );

                // TASKS CRUD
                $group->get('/tasks', function (Request $request, Response $response) {
                    $userAttr = $request->getAttribute('user');
                    $db = Database::getUserDb($userAttr['dbFile']);
                    $dbKey = $userAttr['dbKey'];

                    $stmt = $db->query('SELECT t.id, t.title, t.description, t.due_date, t.state, t.tag_id, g.title as tag_title, g.color as tag_color FROM tasks t JOIN tags g ON t.tag_id = g.id WHERE t.deleted_at = 0 ORDER BY t.id DESC');
                    $tasks = $stmt->fetchAll(PDO::FETCH_ASSOC);

                    foreach ($tasks as &$task) {
                        $task['title'] = Database::decrypt($task['title'], $dbKey);
                        if ($task['description']) {
                            $task['description'] = Database::decrypt($task['description'], $dbKey);
                        }
                        if ($task['due_date']) {
                            $task['due_date'] = Database::decrypt($task['due_date'], $dbKey);
                        }
                    }

                    $response->getBody()->write(json_encode(['tasks' => $tasks]));
                    return $response->withHeader('Content-Type', 'application/json');
                }
                );

                $group->post('/tasks', function (Request $request, Response $response) {
                    $userAttr = $request->getAttribute('user');
                    $mainDb = Database::getMainDb();
                    $stmt = $mainDb->prepare('SELECT is_verified FROM users WHERE id = ?');
                    $stmt->execute([$userAttr['userId']]);
                    if (!$stmt->fetchColumn()) {
                        $response->getBody()->write(json_encode(['error' => 'Account not verified. Check your email.']));
                        return $response->withStatus(403)->withHeader('Content-Type', 'application/json');
                    }

                    $db = Database::getUserDb($userAttr['dbFile']);
                    $dbKey = $userAttr['dbKey'];
                    $body = $request->getParsedBody();

                    if (!isset($body['title']) || !isset($body['tagId'])) {
                        $response->getBody()->write(json_encode(['error' => 'Missing fields']));
                        return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
                    }

                    $title = Database::encrypt($body['title'], $dbKey);
                    $desc = !empty($body['description']) ?Database::encrypt($body['description'], $dbKey) : null;
                    $dueDate = !empty($body['dueDate']) ?Database::encrypt($body['dueDate'], $dbKey) : null;
                    $state = $body['state'] ?? 'new';

                    $stmt = $db->prepare('INSERT INTO tasks (title, description, due_date, tag_id, state, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
                    $stmt->execute([$title, $desc, $dueDate, (int)$body['tagId'], $state, time()]);

                    $response->getBody()->write(json_encode(['success' => true, 'id' => $db->lastInsertId()]));
                    return $response->withHeader('Content-Type', 'application/json');
                }
                );

                $group->put('/tasks/{id}', function (Request $request, Response $response, array $args) {
                    $userAttr = $request->getAttribute('user');
                    $db = Database::getUserDb($userAttr['dbFile']);
                    $dbKey = $userAttr['dbKey'];
                    $body = $request->getParsedBody();
                    $id = (int)$args['id'];

                    $title = Database::encrypt($body['title'], $dbKey);
                    $desc = !empty($body['description']) ?Database::encrypt($body['description'], $dbKey) : null;
                    $dueDate = !empty($body['dueDate']) ?Database::encrypt($body['dueDate'], $dbKey) : null;
                    $state = $body['state'] ?? 'new';
                    $tagId = (int)$body['tagId'];

                    $stmt = $db->prepare('UPDATE tasks SET title = ?, description = ?, due_date = ?, tag_id = ?, state = ?, updated_at = ? WHERE id = ?');
                    $stmt->execute([$title, $desc, $dueDate, $tagId, $state, time(), $id]);

                    $response->getBody()->write(json_encode(['success' => true]));
                    return $response->withHeader('Content-Type', 'application/json');
                }
                );

                $group->delete('/tasks/{id}', function (Request $request, Response $response, array $args) {
                    $userAttr = $request->getAttribute('user');
                    $db = Database::getUserDb($userAttr['dbFile']);
                    $stmt = $db->prepare('DELETE FROM task_comments WHERE task_id = ?');
                    $stmt->execute([(int)$args['id']]);
                    $stmt = $db->prepare('UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?');
                    $stmt->execute([time(), time(), (int)$args['id']]);

                    $response->getBody()->write(json_encode(['success' => true]));
                    return $response->withHeader('Content-Type', 'application/json');
                }
                );

                $group->get('/tasks/{id}/comments', function (Request $request, Response $response, array $args) {
                    $userAttr = $request->getAttribute('user');
                    $db = Database::getUserDb($userAttr['dbFile']);
                    $dbKey = $userAttr['dbKey'];

                    $stmt = $db->prepare('SELECT id, comment, created_at FROM task_comments WHERE task_id = ? ORDER BY id ASC');
                    $stmt->execute([(int)$args['id']]);
                    $comments = $stmt->fetchAll(PDO::FETCH_ASSOC);

                    foreach ($comments as &$c) {
                        $c['comment'] = Database::decrypt($c['comment'], $dbKey);
                    }

                    $response->getBody()->write(json_encode(['comments' => $comments]));
                    return $response->withHeader('Content-Type', 'application/json');
                }
                );

                $group->post('/tasks/{id}/comments', function (Request $request, Response $response, array $args) {
                    $userAttr = $request->getAttribute('user');
                    $db = Database::getUserDb($userAttr['dbFile']);
                    $dbKey = $userAttr['dbKey'];
                    $body = $request->getParsedBody();

                    if (!isset($body['comment']))
                        return $response->withStatus(400);

                    $comment = Database::encrypt($body['comment'], $dbKey);
                    $stmt = $db->prepare('INSERT INTO task_comments (task_id, comment, created_at) VALUES (?, ?, ?)');
                    $stmt->execute([(int)$args['id'], $comment, date('Y-m-d H:i:s')]);

                    $response->getBody()->write(json_encode(['success' => true]));
                    return $response->withHeader('Content-Type', 'application/json');
                }
                );

                // TAGS CRUD
                $group->get('/tags', function (Request $request, Response $response) {
                    $userAttr = $request->getAttribute('user');
                    $db = Database::getUserDb($userAttr['dbFile']);
                    $stmt = $db->query('SELECT id, title, color FROM tags WHERE deleted_at = 0');
                    $tags = $stmt->fetchAll(PDO::FETCH_ASSOC);
                    $response->getBody()->write(json_encode(['tags' => $tags]));
                    return $response->withHeader('Content-Type', 'application/json');
                }
                );

                $group->post('/tags', function (Request $request, Response $response) {
                    $userAttr = $request->getAttribute('user');
                    $db = Database::getUserDb($userAttr['dbFile']);
                    $body = $request->getParsedBody();

                    if (!isset($body['title']) || !isset($body['color'])) {
                        $response->getBody()->write(json_encode(['error' => 'Missing fields']));
                        return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
                    }

                    $stmt = $db->prepare('INSERT INTO tags (title, color, updated_at) VALUES (?, ?, ?)');
                    $stmt->execute([$body['title'], $body['color'], time()]);

                    $response->getBody()->write(json_encode(['success' => true, 'id' => $db->lastInsertId()]));
                    return $response->withHeader('Content-Type', 'application/json');
                }
                );

                $group->delete('/tags/{id}', function (Request $request, Response $response, array $args) {
                    $userAttr = $request->getAttribute('user');
                    $db = Database::getUserDb($userAttr['dbFile']);
                    $tagId = (int)$args['id'];

                    // Validate unused or all done
                    $stmt = $db->prepare('SELECT COUNT(*) as count FROM tasks WHERE tag_id = ? AND state != "finished"');
                    $stmt->execute([$tagId]);
                    $res = $stmt->fetch();
                    if ($res['count'] > 0) {
                        $response->getBody()->write(json_encode(['error' => 'Cannot delete tag with unfinished tasks']));
                        return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
                    }

                    // Delete tasks with tag
                    $stmt = $db->prepare('DELETE FROM tasks WHERE tag_id = ?');
                    $stmt->execute([$tagId]);

                    $stmt = $db->prepare('UPDATE tags SET deleted_at = ?, updated_at = ? WHERE id = ?');
                    $stmt->execute([time(), time(), $tagId]);

                    $response->getBody()->write(json_encode(['success' => true]));
                    return $response->withHeader('Content-Type', 'application/json');
                }
                );

                // STATES
                $group->get('/states', function (Request $request, Response $response) {
                    $userAttr = $request->getAttribute('user');
                    $db = Database::getUserDb($userAttr['dbFile']);
                    $stmt = $db->query('SELECT state FROM states');
                    $states = $stmt->fetchAll(PDO::FETCH_COLUMN);
                    $response->getBody()->write(json_encode(['states' => $states]));
                    return $response->withHeader('Content-Type', 'application/json');
                }
                );

                $group->post('/states', function (Request $request, Response $response) {
                    $userAttr = $request->getAttribute('user');
                    $db = Database::getUserDb($userAttr['dbFile']);
                    $body = $request->getParsedBody();
                    $state = $body['state'] ?? null;
                    if ($state) {
                        $stmt = $db->prepare('INSERT INTO states (state) VALUES (?)');
                        try {
                            $stmt->execute([$state]);
                        }
                        catch (\Exception $e) {
                        }
                    }
                    $response->getBody()->write(json_encode(['success' => true]));
                    return $response->withHeader('Content-Type', 'application/json');
                }
                );

            }
            )->add(new \App\Application\Middleware\E2EMiddleware())->add(new AuthMiddleware($jwtSecret));

    // Serve React index.html for any unmatched route
    $app->get('/[{routes:.*}]', function (Request $request, Response $response) {
        $file = __DIR__ . '/../public/index.html';
        if (file_exists($file)) {
            $response->getBody()->write(file_get_contents($file));
            return $response->withHeader('Content-Type', 'text/html');
        }
        $response->getBody()->write('Frontend not built yet. Please run npm run build in frontend.');
        return $response->withStatus(404)->withHeader('Content-Type', 'text/plain');
    });
};
