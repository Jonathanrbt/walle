# Open Payments Java SDK (test network only)

Host: `https://wallet.interledger-test.dev`. Package `org.interledger:open-payments`. Implementation class `OpenPaymentsHttpClient`. Facade `IOpenPaymentsClient` with `auth()`, `walletAddress()`, `quote()`, `payment()`.

## Status & version

Docs mark Java **Done** (`open-payments/docs/src/content/docs/sdk/before-you-begin.mdx`). README install pin is **1.3.0**. This checkout’s `gradle.properties` is `release.version=1-SNAPSHOT` and `build.gradle` targets **Java 21** (`languageVersion = JavaLanguageVersion.of(21)`).

Maturity: one-time incoming, quote, interactive outgoing, get/list, incoming complete, token rotate/revoke, and grant cancel are implemented and used in `src/integrationTest/java/org/interledger/openpayments/InterledgerApiClientHttpImpl.java`.

Missing in this SDK:

- No unauthenticated client type or option. Every factory requires a wallet URL, PEM, and key id.
- No high-level recurring-grant method. `Limits.interval` exists and its Javadoc says it is **not fully implemented**. `continuation()` never sets `interval`. The Java tab for an interval outgoing grant is the literal `coming soon` (`grant-create-outgoing.mdx`).
- Outgoing-grant spent amounts Java tab is `// Coming soon` (`outgoing-grant-spent-amounts.mdx`).
- No `isPending` / `isFinalized` helpers.
- List calls have no cursor, limit, or pagination arguments.

## Install

Maven, from `open-payments-java/README.md`:

```xml
<dependency>
    <groupId>org.interledger</groupId>
    <artifactId>open-payments</artifactId>
    <version>1.3.0</version>
</dependency>
```

Build the checkout: `./gradlew clean build` (Gradle 9+, JDK 21).

## Credentials

Three strings, loaded only as method arguments. There is no file loader and no env helper on the public client.

| Piece | Role |
| --- | --- |
| Wallet address URL | GNAP `client` identity (`model/grant/Client`) |
| Key id | HTTP signature key id |
| Private key PEM | Ed25519 PKCS#8 |

PEM must be `-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----`. `UtilGlobal.getPrivateKeyFromPem` strips those markers, Base64-decodes, and builds an Ed25519 `PKCS8EncodedKeySpec`. Wrong format throws `OpenPaymentsClientException` with code `412` (`PRE_CONDITION_FAILED`).

Test-wallet steps (generate key, download `private.key`, copy key id) are in `before-you-begin.mdx`. Integration tests read `client.wallet.address`, `client.private.key`, `client.key.id`, `sender.wallet.address`, `receiver.wallet.address` from `src/integrationTest/resources/test-config.properties` (`src/integrationTest/README.md`).

## Create the client

Only authenticated construction. `OpenPaymentsClientOptions` is connect timeout, request timeout, and transaction expiration seconds. `DEFAULT` is `(10, 10, 600)`.

```java
import org.interledger.openpayments.IOpenPaymentsClient;
import org.interledger.openpayments.httpclient.OpenPaymentsHttpClient;

IOpenPaymentsClient client = OpenPaymentsHttpClient.defaultClient(
    "https://ilp.interledger-test.dev/alice",
    privateKeyPem,
    keyId
);
```

`defaultClient` calls `getPrivateKeyFromPem`, wraps the address in `new Client(clientAddress)`, and uses `OpenPaymentsClientOptions.DEFAULT`, `HttpClient.newHttpClient()`, and `new HttpLogger()` (`OpenPaymentsHttpClient.java`).

Lombok `@RequiredArgsConstructor` also exposes:

```java
new OpenPaymentsHttpClient(clientWallet, privateKey, keyId, options, httpClient, httpLogger)
```

There is no unauthenticated factory. Wallet-address GET and JWKS GET are unsigned even on this client (`HttpOPWalletAddressClient`), but you still must pass a key to construct it.

## One-time payment

Snippets below match the Java tabs and `InterledgerApiClientHttpImpl.openPaymentsCreateOutgoingFromQuote`. Wallet URL examples in the docs are placeholders (`https://cloudninebank.example.com/...`); on the test network use the URL from the test wallet.

### 1. Wallet address

```java
var receiverWallet = client.walletAddress().get("https://ilp.interledger-test.dev/receiver");
var senderWallet = client.walletAddress().get("https://ilp.interledger-test.dev/sender");
```

`WalletAddress` implements `IAuthServer` and `IResourceServer`. Fields used later: `getAuthServer()`, `getResourceServer()`, `getId()`, `getIdAsURI()`, `getAssetCode()`, `getAssetScale()`.

Public keys only: `client.walletAddress().keys(url)` GETs `{url}/jwks.json` (appends `/` if missing) and returns `Ed25519Keys`. It does not return the private key.

### 2. Non-interactive incoming-payment grant

```java
import org.interledger.openpayments.model.grant.AccessAction;

var ipGrant = client.auth().grant().incomingPayment(receiverWallet);
// or
var ipGrant = client.auth().grant().incomingPayment(
    receiverWallet, AccessAction.read, AccessAction.complete, AccessAction.create);
```

Empty actions default to `read`, `complete`, `create` (`HttpOPGrantClient.incomingPayment`). The request is a signed POST of `GrantRequest.build(...)` to `receiverWallet.getAuthServer()` with no `interact`. Token: `ipGrant.getAccess().getToken()`. Manage URI: `ipGrant.getAccess().getManage()`.

### 3. Create incoming payment

```java
import java.math.BigDecimal;

var incomingPayment = client.payment().createIncoming(
    receiverWallet, ipGrant, BigDecimal.valueOf(11.25));
```

Amount is a major-unit `BigDecimal` (integration test uses `11.25` / `12.25`). Id is a `URI` (`incomingPayment.getId()`). Completion flag is `incomingPayment.isCompleted()` (Lombok on `boolean completed`).

### 4. Quote grant and quote

```java
import java.util.Optional;

var quoteGrant = client.auth().grant().quote(senderWallet);
var quote = client.quote().create(
    quoteGrant.getAccess().getToken(),
    senderWallet,
    incomingPayment,
    Optional.empty(),
    Optional.empty()
);
```

Empty quote actions default to `read` and `create`. `quote.create` POSTs to `{sender resourceServer}/quotes` with `Authorization` set from the raw quote token (`SignatureRequestBuilder.accessToken`). Pass `Optional.of(amount)` for debit or receive; the SDK does not expose separate methods. The docs Java tabs for debit-amount and receive-amount quotes use this same `create` call.

Read a quote later: `client.quote().get(quoteUri, quoteGrant)`.

### 5. Interactive outgoing-payment grant

```java
import java.net.URI;

var pending = client.auth().grant().continuation(
    senderWallet,
    quote.getDebitAmount(),
    URI.create("https://example.com/redirect?paymentId=1234"),
    "test" // nonce
);
URI start = pending.getInteract().getRedirect();
```

`continuation` returns `OutgoingPayment`, not `Grant`. It always requests `read` + `create`, sets `identifier` to **the sender wallet URI** (`sender.getIdAsURI()`), sets `limits.debitAmount` only, and calls `GrantRequest.redirectInteract(returnUrl, nonce)` (`interact.start = ["redirect"]`, `interact.finish.method = "redirect"`). Send the user to `getInteract().getRedirect()`. Continuation token and URI are `pending.getPaymentContinue().getAccess().getToken()` and `pending.getPaymentContinue().getUri()`.

### 6. `interact_ref` after redirect

The SDK does not read the browser redirect. `InteractContinue` documents a callback like `?state=12345&interact_ref=abc123`. The integration test parses the query itself (`performInteractionAndContinue`): split on `&`, keep the value after `interact_ref=`. Docs pass that string into `finalize` (`grant-continue.mdx`).

### 7. Continue the grant

```java
var finalized = client.auth().grant().finalize(pending, interactRef);
String payToken = finalized.getAccess().getToken();
```

`finalize` POSTs `InteractRef` (`{"interact_ref":"..."}`) to `pending.getPaymentContinue().getUri()` using the **continue** access token (`extractContinueAccessToken`). Empty `interactRef` throws `OpenPaymentsClientException`.

### 8. Create, get, list outgoing

```java
var outgoing = client.payment().createOutgoing(finalized, senderWallet, quote);
var again = client.payment().getOutgoing(outgoing.getId(), finalized);
var listed = client.payment().getOutgoingPayments(
    senderWallet, senderWallet.getIdAsURI(), finalized);
```

Second create overload (no quote), from the integration test:

```java
client.payment().createOutgoing(
    finalized, senderWallet, incomingPayment,
    Amount.build(BigDecimal.valueOf(10.00), incomingPayment.getIncomingAmount().getAssetCode()));
```

Incoming read/list/complete:

```java
var payment = client.payment().getIncoming(incomingPayment.getId(), ipGrant);
client.payment().incomingPaymentComplete(incomingPayment, ipGrant);
var page = client.payment().getIncomingPayments(
    receiverWallet, receiverWallet.getIdAsURI(), ipGrant);
```

`getIncomingPayments` GETs `{resourceServer}/incoming-payments?wallet-address={uri}`. The published Java list snippet passes `senderWallet.getId()` (a `String`) as the second argument; the interface requires `URI`. Use `getIdAsURI()`.

Poll with `payment.isCompleted()`. Outgoing failure is `outgoing.getFailed()`. There is no spent-amount client method.

## Recurring grant and interval limits

Not available as an SDK operation.

`Limits` has optional `receiver`, `receiveAmount`, `debitAmount`, and `interval` (ISO-8601 repeat, example in Javadoc: `R12/2023-01-01T00:00:00Z/P1M`). `AccessItem.accessOutgoing` sets identifier and `debitAmount` only. `continuation()` is the only outgoing-grant builder and does not call `setInterval`. Building a `GrantRequest` by hand and signing it is not a public client method (`sendGrantRequest` is private). The Java “with an interval” snippet is `coming soon`.

## Token rotate, revoke, grant cancel

`WalletAddress` is an `IAuthServer`. Both token calls target `{authServer}/token/{tokenId}` with the grant’s access token (`GNAP` via `SignatureRequestBuilder`).

```java
Grant rotated = client.auth().rotateToken(
    receiverWallet, tokenId, ipGrant); // POST
client.auth().revokeToken(receiverWallet, tokenId, ipGrant); // DELETE
client.auth().grant().cancel(ipGrant); // DELETE grant.getAccessContinue().getUri()
```

`rotateToken` returns a new `Grant`. `revokeToken` and `cancel` return `void`.

The Java tabs in `token-rotate.mdx` and `token-revoke.mdx` pass `grant.getAccess().getToken()` while the variable in those snippets is `grantRequest`. That identifier is not declared there. The Java method’s second argument is named `tokenId`. Whether the test wallet expects the token value or the last segment of `grant.getAccess().getManage()` is **UNVERIFIED** in these files. `cancel` needs `accessContinue.uri` and `access_token.value` (`extractAccessToken`).

## Errors and grant shape

All failures are unchecked `AOpenPaymentsException` (`getCode()`, `getMessage()`).

| Type | When |
| --- | --- |
| `OpenPaymentsAPIException` | HTTP status outside 2xx. `getCode()` is the status. Message is `[status] (error.code) error.description`. Also `getResponseHeaders()`, `getResponseBody()`. Body parsed as `ApiError`. |
| `OpenPaymentsClientException` | Bad input (`Code.BAD_REQUEST` = 400), PEM/key (`PRE_CONDITION_FAILED` = 412), `IO_ERROR` = -100, `INTERRUPTED` = -101. |

Non-interactive grants (`incomingPayment`, `quote`) come back as `Grant` with `access_token`. Interactive `continuation` comes back as `OutgoingPayment`: use `getInteract().getRedirect()` while the user has not finished, then `finalize`. There is no `isPending()` or `isFinalized()`. After `finalize`, the integration test treats a null `finalized.getAccess().getToken()` as failure. `AccessContinue.wait` is deserialized and never read by the client.

## Gotchas

- Test network only in this skill: wallet UI `https://wallet.interledger-test.dev`. Integration assertions also show auth `https://auth.interledger-test.dev/...` and resource `https://ilp.interledger-test.dev/...`.
- Client wallet URL, sender wallet, and receiver wallet are different values. `defaultClient`’s first argument is the **client** key identity, not necessarily the payer.
- Incoming and quote grants ignore an explicit empty action list and substitute defaults. They do not add `list` or `read-all` unless you pass those `AccessAction` values. Enum wire values: `read`, `complete`, `create`, `read-all`, `list`, `list-all`.
- `continuation` binds the grant to the sender wallet id and a single `debitAmount`, not to the quote id. Nonce is required when `returnUrl` is non-null.
- `finalize` signs with the continue token, not the later payment token.
- Quote and resource calls send the access-token **string**, not the `Grant`. Passing the wrong token fails inside `extractAccessToken` or at the API.
- `getIncomingPayments` / `getOutgoingPayments` take `(IResourceServer, URI, Grant)`. Docs that pass `getId()` do not match the signature.
- `OpenPaymentsClientException.responseHeaders` and `responseBody` are hard-coded `null`. API detail is only on `OpenPaymentsAPIException`.
- HTTP signatures and JSON need the private key on every authenticated call. Wallet GET does not.
- No public API sets `Limits.interval` or reads outgoing-grant spent amounts.
