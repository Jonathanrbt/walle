# Open Payments PHP SDK (test network only)

Package `interledger/open-payments-php`, namespace `OpenPayments\`. Docs status: **Done** (`open-payments/docs/src/content/docs/sdk/before-you-begin.mdx`). Library maturity: **1.2.0** (2026-10-07), OpenAPI spec constant `OpenPayments\OpenApi\SpecVersion::SPEC_VERSION = '1.3.2'` (`open-payments-php/lib/OpenApi/SpecVersion.php`, `CHANGELOG.md`). PHP **>= 8.3**, `ext-sodium`, `ext-bcmath`. Test wallet UI: `https://wallet.interledger-test.dev` (same doc). There is no production-wallet client in this package.

## Install

```bash
composer require interledger/open-payments-php
```

(`open-payments-php/composer.json`, `"name": "interledger/open-payments-php"`.) Autoload PSR-4 `OpenPayments\` → `lib/`, plus files `lib/Utils/HttpSignature.php` and `lib/Enums/Actions.php`.

## Credentials

Three constructor strings on `OpenPayments\Config\Config`: wallet address URL, private key, key ID (`lib/Config/Config.php`).

```php
public function __construct(string $walletAddressUrl, string $privateKey = '', string $keyId = '', bool $useHttp = false)
```

`AuthClient` passes `getPrivateKey()` and `getKeyId()` into `ApiClient`. Signing does `base64_decode($this->privateKey)` (`lib/ApiClient.php`). Tests construct `new ApiClient(base64_encode($privateKey), 'gnap-key', 'token')` (`tests/Http/ApiClientHeadersTest.php`). Helpers in `lib/Utils/HttpSignature.php` (global functions, not a class): `loadKey($path)` (file bytes → `sodium_crypto_sign_secretkey`), `loadBase64Key($base64Key)`, `generateKey`, `loadOrGenerateKey`. The published snippets use variables `$WALLET_ADDRESS`, `$PRIVATE_KEY`, `$KEY_ID`. How those are read from `private.key` / env is **UNVERIFIED** in this tree (snippets live in `open-payments-php-snippets`, not vendored here). Test-wallet key generation (Settings → Developer Keys → Generate public & private key → `private.key` download + on-screen key ID) is in `before-you-begin.mdx`. `Config::$useHttp` is stored and exposed by `getUseHttp()`; `AuthClient` never reads it.

Wallet address model fields (`lib/Models/WalletAddress.php`): `id`, `publicName`, `assetCode`, `assetScale`, `authServer`, `resourceServer`.

## Clients

There is one client class: `OpenPayments\AuthClient`. `UnauthenticatedClientInterface` exists (`lib/Contracts/UnauthenticatedClientInterface.php`) and is **not implemented** by any class. Docs treat a `Config` with only the wallet URL as unauthenticated (`sdk/wallet-get-info.mdx`):

```php
use OpenPayments\AuthClient;
use OpenPayments\Config\Config;

$config = new Config($WALLET_ADDRESS);
$opClient = new AuthClient($config); // because of missing keys in config, this will be an unauthenticated client
$wallet = $opClient->walletAddress()->get([
    'url' => $config->getWalletAddressUrl()
]);
```

Authenticated (`sdk/grant-create-incoming.mdx`):

```php
$config = new Config($WALLET_ADDRESS, $PRIVATE_KEY, $KEY_ID);
$opClient = new AuthClient($config);
```

Accessors: `walletAddress()`, `incomingPayment()`, `quote()`, `outgoingPayment()`, `grant()`, `token()`, plus `setAccessToken(string)`. Services also take `access_token` inside the first argument array and call `setAccessToken` themselves (except token rotate; see Gotchas).

## One-time payment

All snippets below are the PHP tabs under `open-payments/docs/src/content/docs/sdk/`.

**1. Wallet address** — `walletAddress()->get(['url' => $config->getWalletAddressUrl()])`. Use `$wallet->authServer` for grants and `$wallet->resourceServer` for resources. `getKeys(['url' => ...])` returns `JsonWebKeySet` (`sdk/wallet-get-keys.mdx`). `WalletAddressService::getDIDDocument()` is deprecated (DID document left the spec; removal planned in v1.2.1, `CHANGELOG.md`).

**2. Non-interactive incoming-payment grant** (`sdk/grant-create-incoming.mdx`):

```php
$grant = $opClient->grant()->request(
    ['url' => $wallet->authServer],
    [
        'access_token' => [
            'access' => [[
                'type' => 'incoming-payment',
                'actions' => ['read', 'complete', 'create', 'list'],
            ]],
        ],
    ]
);
if (!$grant instanceof \OpenPayments\Models\Grant) {
    throw new \Error('Expected non-interactive grant');
}
// $grant->access_token->value, $grant->access_token->manage
```

`GrantService::request` injects `client` = configured wallet address unless the caller passed `['client' => ['jwk' => ...]]` (directed identity; a `jwk` plus `interact` fails schema validation, `CHANGELOG.md` 1.2.0).

**3. Create incoming payment** (`sdk/incoming-create.mdx`):

```php
$newIncomingPayment = $opClient->incomingPayment()->create(
    [
        'url' => $wallet->resourceServer,
        'access_token' => $INCOMING_PAYMENT_GRANT_ACCESS_TOKEN,
    ],
    [
        'walletAddress' => $config->getWalletAddressUrl(),
        'incomingAmount' => ['value' => '130', 'assetCode' => 'USD', 'assetScale' => 2],
        'metadata' => ['description' => '...', 'externalRef' => 'INVOICE-'.uniqid()],
        'expiresAt' => (new \DateTime('now', new \DateTimeZone('UTC')))
            ->add(new \DateInterval('PT59M'))->format("Y-m-d\TH:i:s.v\Z"),
    ]
);
// $newIncomingPayment->id
```

POSTs `{resourceServer}/incoming-payments` (`IncomingPaymentService::create`).

**4. Quote grant + quote** (`sdk/grant-create-quote.mdx`, `sdk/quote-create.mdx`):

```php
$grant = $opClient->grant()->request(
    ['url' => $wallet->authServer],
    [
        'access_token' => [
            'access' => [[
                'type' => 'quote',
                'actions' => ['create', 'read', 'read-all'],
            ]],
        ],
        'client' => $config->getWalletAddressUrl(),
    ]
);
if ($grant instanceof \OpenPayments\Models\PendingGrant) {
    throw new \Error('Expected non-interactive grant');
}

$newQuote = $opClient->quote()->create(
    ['url' => $wallet->resourceServer, 'access_token' => $QUOTE_GRANT_ACCESS_TOKEN],
    ['method' => 'ilp', 'walletAddress' => $wallet->id, 'receiver' => $INCOMING_PAYMENT_URL]
);
// $newQuote->id
```

**5. Interactive outgoing-payment grant** (`sdk/grant-create-outgoing.mdx`):

```php
$grant = $opClient->grant()->request(
    ['url' => $wallet->authServer],
    [
        'access_token' => [
            'access' => [[
                'type' => 'outgoing-payment',
                'actions' => ['list', 'list-all', 'read', 'read-all', 'create'],
                'identifier' => $wallet->id,
                'limits' => [
                    'receiver' => $INCOMING_PAYMENT_URL, // optional
                    'debitAmount' => ['assetCode' => 'USD', 'assetScale' => 2, 'value' => '130'],
                ],
            ]],
        ],
        'client' => $config->getWalletAddressUrl(),
        'interact' => [
            'start' => ['redirect'],
            'finish' => [
                'method' => 'redirect',
                'uri' => 'https://localhost/?paymentId=123423',
                'nonce' => '1234567890',
            ],
        ],
    ]
);
if (!$grant instanceof \OpenPayments\Models\PendingGrant) {
    throw new \Error('Expected interactive grant');
}
// redirect: $grant->interact->redirect
// continue token: $grant->continue->access_token->value
// continue URI: $grant->continue->uri
```

`request()` returns `PendingGrant` only when the JSON has both `interact` and `continue` (`GrantService`). Send the user to `interact->redirect`.

**6. `interact_ref` after redirect.** Doc prose (`sdk/grant-continue.mdx`): the auth server redirects to the finish URI with `interact_ref` on the query string. The PHP snippet does **not** read `$_GET`; it expects a variable `$interactRef`. Parsing that query value is **UNVERIFIED** in this tree. Continuation body key is `interact_ref` (`1.0.2` made it optional on the continuation schema).

**7. Grant continue** (`sdk/grant-continue.mdx`). `continue()` requires the URL to contain `continue/` and sets the GNAP token from `access_token`. It always overwrites `client` with the configured wallet address (a caller `jwk` client is not kept).

```php
$grant = $opClient->grant()->continue(
    ['access_token' => $CONTINUE_ACCESS_TOKEN, 'url' => $CONTINUE_URI],
    ['interact_ref' => $interactRef]
);
if (!$grant instanceof \OpenPayments\Models\Grant) {
    throw new \Error('Expected finalized grant. Received non-finalized grant.');
}
// $grant->access_token->value, $grant->access_token->manage
```

Return type is `Grant` only. A response that is still pending (no `access_token` and no `subject`) makes `GrantTransformer` throw `UnexpectedValueException` (`CHANGELOG.md` 1.2.0). `Grant::$access_token` is nullable; subject-only grants set `Grant::$subject` and leave the token null. `GrantContinue::$access_token` is `AccessToken|SimpleAccessToken`.

**8. Create outgoing payment** (`sdk/outgoing-create.mdx`), quote id form:

```php
$newOutgoingPayment = $opClient->outgoingPayment()->create(
    ['url' => $wallet->resourceServer, 'access_token' => $OUTGOING_PAYMENT_GRANT_ACCESS_TOKEN],
    [
        'walletAddress' => $config->getWalletAddressUrl(),
        'quoteId' => $QUOTE_URL,
        'metadata' => [
            'description' => 'Test outgoing payment',
            'reference' => '1234567890',
            'invoiceId' => '1234567890',
            'customData' => ['key1' => 'value1', 'key2' => 'value2'],
        ],
    ]
);
```

The same page has a second PHP block that uses an incoming-payment URL instead of `quoteId` (not copied here). POSTs `{resourceServer}/outgoing-payments`.

**9. Get / list**

```php
$outgoingPayment = $opClient->outgoingPayment()->get([
    'access_token' => $OUTGOING_PAYMENT_GRANT_ACCESS_TOKEN,
    'url' => $OUTGOING_PAYMENT_URL,
]);

$outgoingPaymentList = $opClient->outgoingPayment()->list(
    ['url' => $wallet->resourceServer, 'access_token' => $OUTGOING_PAYMENT_GRANT_ACCESS_TOKEN],
    ['wallet-address' => $config->getWalletAddressUrl(), 'first' => 3]
);

$quote = $opClient->quote()->get([
    'access_token' => $QUOTE_GRANT_ACCESS_TOKEN,
    'url' => $QUOTE_URL,
]);
```

(`sdk/outgoing-get.mdx`, `sdk/outgoing-list.mdx`, `sdk/quote-get.mdx`.) Incoming get/list/complete exist as `incomingPayment()->get|list|complete|getPublic` (`sdk/incoming-get.mdx`, `incoming-list.mdx`, `incoming-complete.mdx`). `PublicIncomingPaymentService::get` is the unauthenticated incoming read; it is not wired on `AuthClient` (only `IncomingPaymentService`).

Interval spent amounts (`sdk/outgoing-grant-spent-amounts.mdx`):

```php
$grantSpentAmounts = $opClient->outgoingPayment()->getGrant([
    'url' => $walletAddress->resourceServer,
    'access_token' => $OUTGOING_PAYMENT_ACCESS_TOKEN,
]);
// $grantSpentAmounts->spentDebitAmount?->toArray()
```

`GET {url}/outgoing-payment-grant`. The method docblock says `url` is a wallet address URL; the snippet passes `resourceServer`. Which host the test wallet accepts is **UNVERIFIED** beyond that snippet.

## Recurring grant (interval limits)

Same outgoing grant with `limits.interval` (`sdk/grant-create-outgoing.mdx`, “with an interval”):

```php
'limits' => [
    'debitAmount' => ['assetCode' => 'USD', 'assetScale' => 2, 'value' => '132'],
    'interval' => 'R/2025-04-22T08:00:00Z/P1D',
],
```

Still interactive (`PendingGrant`). No separate recurring client method. Fixed-receive vs fixed-debit guide partials repeat this `interval` field (`partials/code/guides/recurring-*`).

## Token rotate / revoke, grant cancel

```php
$token = $opClient->token()->rotate([
    'access_token' => $ACCESS_TOKEN,
    'url' => $TOKEN_MANAGE_URL, // must contain 'token/'
]);
// $token->value, $token->manage

$tokenResponse = $opClient->token()->revoke([
    'access_token' => $ACCESS_TOKEN,
    'url' => $TOKEN_MANAGE_URL,
]);

$response = $opClient->grant()->cancel([
    'access_token' => $ACCESS_TOKEN,
    'url' => $CONTINUE_URI,
]);
```

(`sdk/token-rotate.mdx`, `token-revoke.mdx`, `grant-revoke.mdx`.) `cancel` is `DELETE` on the continue URL; success is HTTP 204 with no `error` key (`GrantService::cancel`). `revoke` is `DELETE` on the manage URL after `setAccessToken`.

## Errors and grant state

Pending vs finalized is an `instanceof` check, not a method:

| Check | Meaning in the snippets |
| --- | --- |
| `$grant instanceof \OpenPayments\Models\PendingGrant` | interactive; has `interact` + `continue` |
| `$grant instanceof \OpenPayments\Models\Grant` | finalized (or subject-only) |

`GrantService::request` on an `error` key throws `\Exception` with `print_r` of the body. It does not map that body onto `GrantError`.

`OpenPayments\Enums\GrantErrorCode`: `invalid_client`, `invalid_request`, `request_denied`, `too_fast`, `invalid_continuation`, `invalid_rotation`. Model `OpenPayments\Models\GrantError`. Trait `HasErrorResponse`: `withErrorResponse()`, `getErrorResponse()`, `withGrantError()`, `getGrantError()`. Resource errors use `ErrorResponse` (`error`, optional `message`).

Typed exceptions (all under `OpenPayments\Exceptions`, many implement `ClientException`):

- Continue POST: `PostContinueBadRequestException` (400), `PostContinueUnauthorizedException` (401), `PostContinueNotFoundException` (404).
- Continue DELETE: `DeleteContinueBadRequestException`, `DeleteContinueUnauthorizedException`, `DeleteContinueNotFoundException`.
- Token POST: `PostTokenBadRequestException`, `PostTokenUnauthorizedException`, `PostTokenNotFoundException`.
- Incoming create: `CreateIncomingPaymentUnauthorizedException`, `CreateIncomingPaymentForbiddenException`.
- Outgoing grant spent: `GetOutgoingPaymentGrantUnauthorizedException`, `GetOutgoingPaymentGrantForbiddenException`.
- Also present: `UnauthorizedException`, `ForbiddenException`, `NotFoundException`, `ConflictException`, `ValidationException`, `BadRequestException`, and per-operation `Get*` / `List*` / `Complete*` variants.

`ApiClient::request` catches Guzzle `RequestException` and returns `['error' => true, 'message' => $e->getMessage(), 'status_code' => $e->getCode()]`. Services then branch on `status_code`. Grant `continue` falls through to `UnexpectedValueException` for any other status. `ValidationException` is for local JSON Schema failures before the HTTP call.

## Gotchas

- One class for both modes. Empty key and key id skip HTTP signatures (`ApiClient`: sign only if key and key id are set and the method is POST or an access token is set).
- Private key argument must be **base64 of the raw Ed25519 secret**, because `generateHttpSignature` always `base64_decode`s it. Passing PEM text or raw binary will not match the test construction.
- `token()->rotate()` never calls `setAccessToken`. The `access_token` entry in the docs array is ignored. The POST is signed with the client key, and `Authorization: GNAP …` is added only if some earlier call already set the token on the same `AuthClient`.
- `grant()->continue()` replaces any `client` value with the wallet address string. Directed-identity `jwk` clients are only preserved on `request()`, and only when there is no `interact`.
- `request()` appends a trailing slash to the auth server URL. `continue()` rejects URLs that do not contain the substring `continue/`. `rotate()` rejects manage URLs that do not contain `token/`.
- HTTP failures are arrays, not exceptions, until the service layer. `RequestException::getCode()` is often `0`, so the 400/401/403/404 branches may miss and you get `UnexpectedValueException` or a generic `\Exception`.
- `Grant::$access_token` can be null (subject-only grant, spec 1.3). Snippets that read `->value` without a null check will error.
- `getDIDDocument()` is deprecated. No class implements `UnauthenticatedClientInterface`. `Config::getUseHttp()` is unused by `AuthClient`.
- Pagination list filters use the hyphenated key `'wallet-address'`, not `walletAddress`.
- A stray file `lib/Exceptions/NotFoundException copy.php` is in the tree; it is not the type services throw.
