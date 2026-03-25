<?php

namespace App\Application\Middleware;

use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Server\RequestHandlerInterface as RequestHandler;
use Slim\Psr7\Response as SlimResponse;
use App\Application\Helpers\E2EEncryption;

class E2EMiddleware
{
    public function __invoke(Request $request, RequestHandler $handler): Response
    {
        $userAttr = $request->getAttribute('user');
        if (!$userAttr) {
            // If not authenticated, do not encrypt/decrypt body.
            return $handler->handle($request);
        }

        $userSalt = $userAttr['dbKey'];
        $sessionPepper = $userAttr['sessionPepper'] ?? '';

        if (!empty($sessionPepper)) {
            // Check if the request body is encrypted text
            $bodyContent = (string)$request->getBody();
            if (!empty($bodyContent) && is_string($bodyContent) && !json_decode($bodyContent, true)) {
                $decryptedBody = E2EEncryption::decrypt($bodyContent, $userSalt, $sessionPepper);
                if ($decryptedBody) {
                    $jsonParsed = json_decode($decryptedBody, true);
                    if (is_array($jsonParsed)) {
                        $request = $request->withParsedBody($jsonParsed);
                    }
                }
            }

            // Run route
            $response = $handler->handle($request);

            // Output logic
            $respBodyContent = (string)$response->getBody();
            if (!empty($respBodyContent)) {
                $encryptedOutput = E2EEncryption::encrypt($respBodyContent, $userSalt, $sessionPepper);
                $newResponse = new SlimResponse();
                $newResponse->getBody()->write($encryptedOutput);
                return $newResponse->withHeader('Content-Type', 'text/plain');
            }
            return $response;
        }

        return $handler->handle($request);
    }
}
