# Open Payments Go SDK (test network only)

Module `github.com/interledger/open-payments-go`. Import alias used in docs and tests: `op`. Generated types: `as` = `.../generated/authserver`, `rs` = `.../generated/resourceserver`, wallet types `was` = `.../generated/walletaddressserver`.

Test wallet UI is `https://wallet.interledger-test.dev` (`open-payments/docs/src/content/docs/sdk/before-you-begin.mdx`). Wallet-address URLs used by the Go integration testnet env are on `https://ilp.interledger-test.dev/...`, auth on `https://auth.interledger-test.dev/...` (`open-payments-go/test/integration/environment.go`). Play money only.

## Status & version

Docs table: **Go = Done** (`before-you-begin.mdx`). `go.mod` declares `go 1.22.5` and `module github.com/interledger/open-payments-go`. README requires go 1.22+ (`open-payments-go/README.md`). No version constant in the module. CI reads the newest git tag and falls back to `v0.0.0` if none exist (`.github/workflows/ci.yml`). **Published semver: UNVERIFIED.**

Maturity: resource and grant calls exist and are exercised by `test/integration/client_test.go` (`go test ./test/integration -env=testnet` needs `.env.testnet` or process env). Grant construction is still manual unions. `grant.go` TODOs: no `NewIncomingPaymentGrantRequest` helpers; debit/receive limits are not validated as mutually exclusive; `Grant` is hand-decoded and “prone to drift” from OpenAPI.

Missing in this SDK (explicit):

- No parser for `interact_ref` from the finish redirect. Callers pass the string.
- No pending-grant type. Pending vs finalized is `AccessToken == nil` / `IsGrantedWithAccessToken`.
- No high-level “one-time payment” method. Flow is grant + resource calls.
- Quote create cannot take `rs.CreateQuoteRequest` (unexported union). Pass a concrete variant (`quote.go`).
- `OpenPaymentsClientError.ValidationErrors` is never filled (`errors.go`).

## Install

```bash
go get github.com/interledger/open-payments-go
```

That module path is from `go.mod`. README does not show `go get`; it documents clone + `git submodule update --init` and `go generate ./generated` for SDK authors.

## Credentials

Authenticated client identity is the **client wallet-address URL** (must not start with `$`), a **key ID**, and an **Ed25519 private key** (`client.go` `NewAuthenticatedClient`).

`httpsignatureutils.LoadKey` (`httpsignatureutils/key.go`), called by the constructor:

1. If `os.Stat(input)` succeeds, read that path as PEM (`LoadKeyFromFile`).
2. Else if the string starts with `-----BEGIN`, parse as PEM (`LoadPEMKey`).
3. Else base64-decode then parse PEM (`LoadBase64Key`).

PEM must be PKCS#8 Ed25519. Docs snippets pass `PRIVATE_KEY_BASE_64` as the second argument (`sdk/wallet-get-info.mdx`). Testnet integration loads `KEY_ID`, `PRIVATE_KEY_BASE64`, `SENDING_WALLET_ADDRESS` from `.env.testnet` or the process (`environment.go`). The test wallet’s **Generate public & private key** flow downloads `private.key` and shows the key id (`before-you-begin.mdx`).

HTTP signatures are applied inside `AuthenticatedClient.DoSigned` (Content-Digest when the body is non-empty, `Signature` / `Signature-Input`). Callers do not sign themselves.

## Clients

Unauthenticated (`client.go`):

```go
c := op.NewClient() // optional: op.WithHTTPClientUnauthed(httpClient)
// c.WalletAddress, c.IncomingPayment (public GET only)
```

Authenticated:

```go
ac, err := op.NewAuthenticatedClient(walletAddressURL, privateKey, keyID,
    op.WithHTTPClientAuthed(httpClient), // optional
    op.WithPreSignHook(func(req *http.Request) {}),
    op.WithPostSignHook(func(req *http.Request) {}),
)
// ac.WalletAddress, Grant, IncomingPayment, Quote, Token, OutgoingPayment
```

`GrantService.client` is set to that wallet address and written on every grant as `client.walletAddress` unless `GrantRequestParams.ClientOverride` (`*as.ClientDirectedIdentity`) is set. Override is documented as non-interactive only (`grant.go`).

## One-time payment

Wallet lookup is unsigned. Use auth and resource URLs from the wallet document, not hardcoded hosts.

```go
wa, err := client.WalletAddress.Get(ctx, op.WalletAddressGetParams{URL: walletURL})
// *wa.Id, *wa.AuthServer, *wa.ResourceServer, wa.AssetCode, wa.AssetScale
keys, err := client.WalletAddress.GetKeys(ctx, op.WalletAddressGetKeysParams{URL: walletURL}) // GET {url}/jwks.json
```

Sources: `wallet_address.go`, `generated/walletaddressserver/types.go`.

### 1. Incoming-payment grant (non-interactive)

From `test/integration/client_test.go` `newIncomingPaymentGrant` and `sdk/grant-create-incoming.mdx` (same shape):

```go
incomingAccess := as.AccessIncoming{
    Type: as.IncomingPayment,
    Actions: []as.AccessIncomingActions{
        as.AccessIncomingActionsCreate,
        as.AccessIncomingActionsRead,
        as.AccessIncomingActionsList,
        as.AccessIncomingActionsComplete,
    },
}
item := as.AccessItem{}
_ = item.FromAccessIncoming(incomingAccess)
var body as.GrantRequest
_ = body.FromGrantRequestWithAccessToken(as.GrantRequestWithAccessToken{
    AccessToken: as.AccessTokenRequest{Access: []as.AccessItem{item}},
})
grant, err := client.Grant.Request(ctx, op.GrantRequestParams{
    URL:         *receiver.AuthServer, // integration uses ReceiverOpenPaymentsAuthUrl
    RequestBody: body,
})
// immediate token: grant.AccessToken.Value, grant.AccessToken.Manage
```

No `interact` field. Success is HTTP 200 (`grant.go`).

### 2. Create incoming payment

`IncomingPayment.Create` POSTs `{BaseURL}/incoming-payments` with `Authorization: GNAP <token>` (`incoming_payment.go`). Docs (`sdk/incoming-create.mdx`):

```go
expiresAt := time.Now().Add(10 * time.Minute)
ip, err := client.IncomingPayment.Create(ctx, op.IncomingPaymentCreateParams{
    BaseURL:     *receiver.ResourceServer,
    AccessToken: grant.AccessToken.Value,
    Payload: rs.CreateIncomingPaymentRequest{
        WalletAddressSchema: *receiver.Id,
        IncomingAmount: &rs.Amount{Value: "1000", AssetCode: receiver.AssetCode, AssetScale: receiver.AssetScale},
        ExpiresAt: &expiresAt,
    },
})
```

Also: `Get` (`IncomingPaymentGetParams`), `List` (`IncomingPaymentListParams` + `Pagination{First,Last,Cursor}`; query `wallet-address`), `Complete` (POST `{url}/complete`), `GetPublic` on either client (no token).

### 3. Quote grant + create quote

`newQuote` in `client_test.go`:

```go
quoteAccess := as.AccessQuote{
    Type:    as.Quote,
    Actions: []as.AccessQuoteActions{as.Create, as.Read},
}
// FromAccessQuote → FromGrantRequestWithAccessToken → Grant.Request
// URL: *sender.AuthServer
quote, err := client.Quote.Create(ctx, op.QuoteCreateParams{
    BaseURL:     *sender.ResourceServer, // SDK joins "quotes"
    AccessToken: quoteGrant.AccessToken.Value,
    Payload: rs.CreateQuoteRequestByReceiver{
        WalletAddressSchema: *sender.Id,
        Receiver:            *ip.Id,
        Method:              "ilp",
    },
})
got, err := client.Quote.Get(ctx, op.QuoteGetParams{URL: *quote.Id, AccessToken: quoteGrant.AccessToken.Value})
```

Other payload types named in `quote.go`: `CreateQuoteRequestWithReceiveAmount`, `CreateQuoteRequestWithDebitAmount`.

### 4. Interactive outgoing-payment grant

Docs (`sdk/grant-create-outgoing.mdx`) and `newOutgoingPaymentGrant`:

```go
outgoing := as.AccessOutgoing{
    Type: as.OutgoingPayment,
    Actions: []as.AccessOutgoingActions{
        as.AccessOutgoingActionsCreate,
        as.AccessOutgoingActionsRead,
        as.AccessOutgoingActionsList,
    },
    Identifier: *sender.Id,
}
item := as.AccessItem{}
_ = item.FromAccessOutgoing(outgoing)
interact := &as.InteractRequest{
    Start: []as.InteractRequestStart{as.InteractRequestStartRedirect}, // "redirect"
}
var req as.GrantRequest
_ = req.FromGrantRequestWithAccessToken(as.GrantRequestWithAccessToken{
    AccessToken: as.AccessTokenRequest{Access: []as.AccessItem{item}},
    Interact:    interact,
})
pending, err := client.Grant.Request(ctx, op.GrantRequestParams{
    URL: *sender.AuthServer, RequestBody: req,
})
if !pending.IsInteractive() { /* Interact == nil */ }
// user opens pending.Interact.Redirect
// continuation: pending.Continue.Uri, pending.Continue.AccessToken.Value
// optional wait: *pending.Continue.Wait seconds (integration sleeps this)
```

Finish redirect (`partials/code/guides/recurring-remittance-fixed-debit/_grant-request-outgoing-payment.mdx`):

```go
Finish: &as.InteractRequestFinish{
    Method: as.Redirect, // see Gotchas — generated const differs
    Uri:    "https://myapp.example.com/finish/{...}",
    Nonce:  NONCE,
},
```

Generated API (`generated/authserver/types.go`): `InteractRequest.Finish` is an anonymous struct with `Method InteractRequestFinishMethod`, `Nonce`, `Uri`. Constant is `as.InteractRequestFinishMethodRedirect` (`"redirect"`), not `as.Redirect`. Docs partial that writes `as.Redirect` does not match this tree.

### 5. `interact_ref`, then continue

`sdk/grant-continue.mdx`: after approval the auth server sends `interact_ref`; the client must POST it to the continue URI. **No Go code in this repo reads it off the redirect URL.** Pass the value you already have:

```go
final, err := client.Grant.Continue(ctx, op.GrantContinueParams{
    URL:         pending.Continue.Uri,          // must contain "continue/"
    AccessToken: pending.Continue.AccessToken.Value,
    InteractRef: INTERACT_REF,                  // omitted from JSON if ""
})
if final.AccessToken == nil {
    // docs: "Expected finalized grant. Received non-finalized grant."
}
token := final.AccessToken.Value
```

`Grant.Continue` sets `Authorization: GNAP <continuation token>` and, if `InteractRef != ""`, body `{"interact_ref":...}` (`grant.go`). Integration `TestCreateAndGetOutgoingPayment` continues **without** `InteractRef` after browser consent and `time.Sleep(*grant.Continue.Wait)`. That path has no finish URI.

### 6. Create, get, list outgoing

`sdk/outgoing-create.mdx` and the integration test. Create expects the **union** wrapper, not the inner struct alone:

```go
var payload rs.CreateOutgoingPaymentRequest
_ = payload.FromCreateOutgoingPaymentRequestFromQuote(rs.CreateOutgoingPaymentRequestFromQuote{
    WalletAddressSchema: *sender.Id,
    QuoteId:             *quote.Id,
})
opmt, err := client.OutgoingPayment.Create(ctx, op.OutgoingPaymentCreateParams{
    BaseURL: *sender.ResourceServer, AccessToken: token, Payload: payload,
})
one, err := client.OutgoingPayment.Get(ctx, op.OutgoingPaymentGetParams{
    URL: *opmt.Id, AccessToken: token, // URL must contain "outgoing-payments/"
})
list, err := client.OutgoingPayment.List(ctx, op.OutgoingPaymentListParams{
    BaseURL: *sender.ResourceServer, AccessToken: token, WalletAddress: *sender.Id,
    Pagination: op.Pagination{First: "10"},
})
spent, err := client.OutgoingPayment.GetGrantSpentAmounts(ctx, op.OutgoingPaymentGrantGetParams{
    BaseURL: *sender.ResourceServer, AccessToken: token,
})
```

`Get` returns `rs.OutgoingPayment`. `Create` returns `rs.OutgoingPaymentWithSpentAmounts`. List result is `*OutgoingPaymentListResponse`.

## Recurring grant (interval limits)

`LimitsOutgoing` is a union. Interval is an ISO-8601 repeating interval (`type Interval = string`). Debit-amount form from `partials/.../recurring-remittance-fixed-debit/_grant-request-outgoing-payment.mdx`:

```go
interval := "R3/2025-10-03T23:25:00Z/P1M"
limits := as.LimitsOutgoing{}
_ = limits.FromLimitsOutgoingDebitAmount(as.LimitsOutgoingDebitAmount{
    Interval: &interval,
    DebitAmount: as.Amount{Value: "20000", AssetCode: "USD", AssetScale: 2},
})
outgoing.Limits = &limits
```

Receive-amount variant: `FromLimitsOutgoingReceiveAmount` / `LimitsOutgoingReceiveAmount.ReceiveAmount`. No-amount: `FromLimitsOutgoingNoAmount`. Same interactive `Grant.Request` as a one-time outgoing grant. There is **no** separate recurring client method. `sdk/outgoing-grant-spent-amounts.mdx` says spent amounts for an interval grant are the **current interval only** (prose; the Go call is the same `GetGrantSpentAmounts`).

## Token rotate / revoke, grant cancel

Manage URL is `grant.AccessToken.Manage` (`TestRotateToken`, `sdk/token-rotate.mdx`). Rotate URL must contain `token/`:

```go
rotated, err := client.Token.Rotate(ctx, op.TokenRotateParams{
    URL: grant.AccessToken.Manage, AccessToken: grant.AccessToken.Value,
})
err = client.Token.Revoke(ctx, op.TokenRevokeParams{
    URL: grant.AccessToken.Manage, AccessToken: grant.AccessToken.Value,
})
```

Rotate returns a new `as.AccessToken` (new `Value` and `Manage`). Revoke is HTTP DELETE, expects 204. A second revoke errors (`TestRevokeToken`).

Cancel the **continuation** URI, not the manage URL (`TestGrantCancel`, `sdk/grant-revoke.mdx`):

```go
err = client.Grant.Cancel(ctx, op.GrantCancelParams{
    URL: grant.Continue.Uri, AccessToken: grant.Continue.AccessToken.Value,
})
```

DELETE, expects 204. A second cancel errors.

## Errors and grant state

HTTP failures become `*OpenPaymentsClientError` (`errors.go`): `Status`, `Code`, `Description`, `Details`, `Method`, `URL`. JSON body shape is `{"error":{"description","code","details"}}`. Non-JSON body becomes `Description`. Empty body uses `resp.Status` (e.g. `"403 Forbidden"`). `Error()` string: `Error making Open Payments {METHOD} request to {URL}: {status} {description}`.

```go
var opErr *op.OpenPaymentsClientError
if errors.As(err, &opErr) { /* opErr.Status, opErr.Code */ }
```

`errors.As` usage is the normal Go pattern; the tests call `newClientErrorFromResponse` directly (`errors_test.go`).

Grant checks (`grant.go`):

| Check | Meaning |
|---|---|
| `IsInteractive()` | `Interact != nil` (pending user interaction) |
| `IsGrantedWithAccessToken()` / deprecated `IsGranted()` | `AccessToken != nil` |
| `IsGrantedWithSubject()` | `Subject != nil` |
| `AccessToken == nil` after `Continue` | docs treat this as not finalized |

There is no `IsPending` and no `PendingGrant` type. Continue too early can surface auth-server errors such as `too_fast` (`ErrorTooFastErrorCode` = `"too_fast"` in generated types). The client does not special-case that code.

Local validation errors (plain `error`, not `OpenPaymentsClientError`): wallet URL starting with `$`; key load failure; continue/cancel missing URL or token; continue URL without `continue/`; token rotate URL without `token/`; outgoing get URL without `outgoing-payments/`.

## Gotchas

- Wallet address argument must be `https://...`, never the `$` payment pointer (`client.go`).
- `LoadKey` treats any existing filesystem path as a key file before trying base64. A short key id that happens to be a path would be read as a file.
- Grant requests are unions. You must `FromGrantRequestWithAccessToken` or `FromGrantRequestWithSubject`, then `FromAccessIncoming` / `FromAccessQuote` / `FromAccessOutgoing`. `Grant.Request` overwrites `client` with the constructor wallet address unless `ClientOverride` is set.
- Quote `Payload` is `any`. Outgoing create `Payload` is `rs.CreateOutgoingPaymentRequest` and must be filled with `FromCreateOutgoingPaymentRequestFromQuote` (or `FromCreateOutgoingPaymentRequestFromIncomingPayment`).
- `Create` joins `incoming-payments`, `quotes`, or `outgoing-payments` onto `BaseURL`. Pass the resource server, not a resource id. `Get` wants the full resource URL.
- `Grant.Continue` rejects URLs that do not contain the substring `continue/`. `Token.Rotate` requires `token/`.
- Docs Go finish snippet uses `as.Redirect`. This checkout’s constant is `as.InteractRequestFinishMethodRedirect`.
- Integration outgoing flow does not send `interact_ref`. Docs continuation does. If you set `Finish`, follow the docs page and supply `InteractRef`.
- `Continue.Wait` is seconds to wait before calling continue (`generated` `Continue.Wait`). Integration sleeps `*grant.Continue.Wait` seconds. The SDK does not wait for you.
- Signed requests use the client `http.Client` after hooks. Replacing it (`WithHTTPClientAuthed`) can break signing behavior (comment in `client.go`).
- Public incoming payment is the only payment read on `NewClient()`. Create/list/complete/quotes/outgoing require `NewAuthenticatedClient`.
- Testnet receiver in integration is hardcoded `https://ilp.interledger-test.dev/blair` plus fixed auth/resource UUIDs (`environment.go`). Those are test fixtures, not a general API. Prefer `WalletAddress.Get` for `authServer` / `resourceServer`.
