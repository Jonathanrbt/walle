# Open Payments SDK — C# (.NET)

Test network only: create the wallet and keys at `https://wallet.interledger-test.dev` (`open-payments/docs/src/content/docs/sdk/before-you-begin.mdx`). Snippet env example uses wallet address `https://ilp.interledger-test.dev/test` (`open-payments-dotnet/OpenPayments.Snippets/example.env`). Play money only.

## Status & version

| Source | Status |
| --- | --- |
| Docs client-library table | **In progress** (`before-you-begin.mdx`) |
| Repo README badge | “active” (`open-payments-dotnet/README.md`) |
| Package | `Interledger.OpenPayments` **1.0.0**, `net9.0`, LangVersion 12 (`OpenPayments.Sdk/OpenPayments.Sdk.csproj`) |

Public surface is DI + `IAuthenticatedClient` / `IUnauthenticatedClient` over NSwag clients (`OpenPayments.Sdk.Generated.{Auth,Resource,Wallet}`). HTTP signatures are Ed25519 via `NSec.Cryptography` and `KeyUtils`.

Present: wallet address + JWKS, public incoming GET, GNAP grant request/continue/cancel, token rotate/revoke, incoming create/get/list/complete, quote create (three body types) and get, outgoing create (from quote or from incoming payment) / get / list, interactive `redirect` + `interact_ref`, recurring limits as an ISO interval string.

Missing in this SDK (no helper, not a separate type):

- No `IsPending` / grant-state enum. Callers test `AuthResponse.AccessToken == null`.
- No parser for `interact_ref` on the redirect query. Guides assign `Guid.NewGuid()` (`Guides/1_OneTimePayment.cs`).
- `Start` and `FinishMethod` only have `Redirect` (`Generated/Auth/AuthServerClient.g.cs`).
- Wallet DID document path throws `ApiException` message `"DID Document not yet implemented"` (`Generated/Wallet/WalletAddressClient.g.cs`).
- Guides are not wired into the snippet CLI (`OpenPayments.Snippets/Program.cs` never constructs `Guides.*`).

## Install

```bash
dotnet add package Interledger.OpenPayments
```

(`README.md`). Prerequisites to build the repo itself: .NET 9.0. Usings in every snippet:

```csharp
using Microsoft.Extensions.DependencyInjection;
using OpenPayments.Sdk.Clients;
using OpenPayments.Sdk.Extensions;
using OpenPayments.Sdk.HttpSignatureUtils;
```

Assembly `RootNamespace` is `Interledger.OpenPayments`; source namespaces are `OpenPayments.Sdk.*`.

## Credentials

From the test wallet Developer Keys tab: key ID, downloaded `private.key` (PEM), and the wallet address URL (`before-you-begin.mdx`).

`OpenPaymentsOptions` (`OpenPayments.Sdk/Configuration/OpenPaymentsOptions.cs`):

- `KeyId` (`string?`) — key id, snippet env `CLIENT_ID`.
- `PrivateKey` (`NSec.Cryptography.Key?`) — not a PEM string. Load first.
- `ClientUrl` (`Uri?`) — client wallet address URL. Sent as the GNAP client identity. Snippet env `CLIENT_URL`.

Loaders (`OpenPayments.Sdk.HttpSignatureUtils/KeyUtils.cs`):

- `KeyUtils.LoadPem(string pem)` — PKCS#8 PEM, OID `1.3.101.112` (Ed25519), 32-byte seed.
- `KeyUtils.LoadBase64Key(string base64Key)` — Base64 seed (32 bytes) or 64-byte key; only the first 32 bytes are imported.

Snippet CLI replaces literal `\n` before `LoadPem` (`OpenPayments.Snippets/Program.cs`):

```csharp
opts.KeyId = Environment.GetEnvironmentVariable("CLIENT_ID");
opts.PrivateKey = KeyUtils.LoadPem(
    Environment.GetEnvironmentVariable("CLIENT_SECRET")!.Replace("\\n", "\n")
);
opts.ClientUrl = new Uri(Environment.GetEnvironmentVariable("CLIENT_URL")!);
```

`example.env` shape: `CLIENT_SECRET` is a one-line PEM with `\n`, `CLIENT_ID` is a UUID-like key id, `CLIENT_URL=https://ilp.interledger-test.dev/test`.

## Create clients

Only registration path is `IServiceCollection.UseOpenPayments(Action<OpenPaymentsOptions>)` (`Extensions/ServiceCollectionExtensions.cs`). `AuthenticatedClient` and `UnauthenticatedClient` constructors are `internal`.

Authenticated (`README.md`, docs C# blocks such as `grant-continue.mdx`):

```csharp
var client = new ServiceCollection()
    .UseOpenPayments(opts =>
    {
        opts.UseAuthenticatedClient = true;
        opts.KeyId = CLIENT_ID;
        opts.PrivateKey = KeyUtils.LoadPem(CLIENT_SECRET);
        opts.ClientUrl = new Uri(CLIENT_WALLET_ADDRESS);
    })
    .BuildServiceProvider()
    .GetRequiredService<IAuthenticatedClient>();
```

`UseAuthenticatedClient` throws `InvalidOperationException` if `KeyId`, `PrivateKey`, or `ClientUrl` is missing. The named `HttpClient` is `"authenticated"`. `IAuthenticatedClient` extends `IUnauthenticatedClient`, so wallet and public incoming calls work on this instance.

Unauthenticated — set the other flag. `IUnauthenticatedClient` is registered only when `UseUnauthenticatedClient` is true:

```csharp
services.UseOpenPayments(opts =>
{
    opts.UseUnauthenticatedClient = true;
});
var client = provider.GetRequiredService<IUnauthenticatedClient>();
```

Both flags may be set together. `HttpClient.BaseAddress` is ignored; callers pass absolute URIs.

Request argument types (`Clients/AuthenticatedClient.cs`):

```csharp
public class RequestArgs { public required Uri Url { get; set; } }
public class AuthRequestArgs : RequestArgs { public required string AccessToken { get; set; } }
```

Grant requests use `RequestArgs` (auth-server URL, no bearer). Resource calls and continue/cancel/rotate/revoke use `AuthRequestArgs`.

## Full one-time payment

From `OpenPayments.Snippets/Guides/1_OneTimePayment.cs`. Types: `OpenPayments.Sdk.Generated.Auth` and `.Resource`. Amounts differ: `AuthAmount` vs `Amount` (both `(value, assetCode, assetScale?)`, default scale 2).

```csharp
var customerWalletAddress = await client.GetWalletAddressAsync("https://cloudninebank.example.com/customer");
var retailerWalletAddress = await client.GetWalletAddressAsync("https://happylifebank.example.com/retailer");
```

`$host/path` is accepted and rewritten to `https://host/path` (`Clients/WalletAddressClientBase.cs`). Anything else throws `ArgumentException`. Use `wallet.AuthServer` and `wallet.ResourceServer` from the result. Public fields also include `Id`, `PublicName`, `AssetCode`, `AssetScale` (`Snippets/Services/Unauthenticated/WalletAddressService.cs`). Keys: `GetWalletAddressKeysAsync` → `JsonWebKeySet.Keys` (`Alg`, `Crv`, `Kid`, `Kty`, `X`).

Non-interactive incoming-payment grant, then create:

```csharp
var retailerIncomingPaymentGrant = await client.RequestGrantAsync(
    new RequestArgs { Url = retailerWalletAddress.AuthServer },
    new GrantCreateBody
    {
        AccessToken = new AccessToken
        {
            Access = [ new IncomingAccess { Actions = [Actions.Create] } ]
        }
    }
);
if (retailerIncomingPaymentGrant.AccessToken == null)
    throw new Exception("Expected a non-interactive grant");

var retailerIncomingPayment = await client.CreateIncomingPaymentAsync(
    new AuthRequestArgs
    {
        Url = retailerWalletAddress.ResourceServer,
        AccessToken = retailerIncomingPaymentGrant.AccessToken.Value
    },
    new IncomingPaymentBody
    {
        WalletAddress = retailerWalletAddress.Id,
        IncomingAmount = new Amount("140000", "MXN", 2)
    }
);
```

`IncomingAccess` sets `Type = AccessType.IncomingPayment`. `AccessToken.Value` is the bearer; `.Manage` is the token-management URL (`Generated/Auth/Types.cs`).

Quote grant + quote (`PaymentMethod.Ilp`):

```csharp
var customerQuoteGrant = await client.RequestGrantAsync(
    new RequestArgs { Url = customerWalletAddress.AuthServer },
    new GrantCreateBody
    {
        AccessToken = new AccessToken
        {
            Access = [ new QuoteAccess { Actions = [Actions.Create] } ]
        }
    }
);
if (customerQuoteGrant.AccessToken == null)
    throw new Exception("Expected a non-interactive grant");

var customerQuote = await client.CreateQuoteAsync(
    new AuthRequestArgs
    {
        Url = customerWalletAddress.ResourceServer,
        AccessToken = customerQuoteGrant.AccessToken.Value
    },
    new QuoteBody
    {
        WalletAddress = customerWalletAddress.Id,
        Receiver = retailerWalletAddress.Id,
        Method = PaymentMethod.Ilp
    }
);
```

Other overloads: `QuoteBodyWithDebitAmount`, `QuoteBodyWithReceiveAmount` (`IAuthenticatedClient.CreateQuoteAsync`).

Interactive outgoing grant. `GrantCreateBodyWithInteract` requires `AccessToken` and `Interact`. `OutgoingAccess.Identifier` is required.

```csharp
var NONCE = Guid.NewGuid().ToString();
var pending = await client.RequestGrantAsync(
    new RequestArgs { Url = customerWalletAddress.AuthServer },
    new GrantCreateBodyWithInteract
    {
        AccessToken = new AccessToken
        {
            Access =
            [
                new OutgoingAccess
                {
                    Identifier = customerWalletAddress.Id,
                    Actions = [Actions.Create],
                    Limits = new OutgoingAccessLimits
                    {
                        DebitAmount = new AuthAmount("140000", "MXN", 2)
                    }
                }
            ]
        },
        Interact = new InteractRequest
        {
            Start = [Start.Redirect],
            Finish = new Finish
            {
                Method = FinishMethod.Redirect,
                Uri = new Uri("https://localhost"),
                Nonce = NONCE
            }
        }
    }
);
```

Send the user to `pending.Interact.Redirect` (`Uri`, required on `InteractResponse`). `InteractResponse.Finish` is the finish key. Snippet list flow prints that URL and blocks on `Console.ReadLine()` (`OutgoingPaymentService.cs`).

**`interact_ref`:** the SDK does not read the redirect. `GrantContinueBody.InteractRef` is an optional string (`[JsonProperty("interact_ref")]`). The one-time guide sets `var interactRef = Guid.NewGuid().ToString()` and does not read a query string. Docs continuation snippet assumes a variable named `interactRef` (`docs/.../sdk/grant-continue.mdx`). How the test wallet puts `interact_ref` on the redirect URL is **UNVERIFIED** in these files.

Continue, then outgoing payment from the quote:

```csharp
var customerOutgoingPaymentGrant = await client.ContinueGrantAsync(
    new AuthRequestArgs
    {
        Url = pending.Continue.Uri,
        AccessToken = pending.Continue.AccessToken.Value
    },
    new GrantContinueBody { InteractRef = interactRef }
);
if (customerOutgoingPaymentGrant.AccessToken == null)
    throw new Exception("Expected a non-interactive grant");

var customerOutgoingPayment = await client.CreateOutgoingPaymentAsync(
    new AuthRequestArgs
    {
        Url = customerWalletAddress.ResourceServer,
        AccessToken = customerOutgoingPaymentGrant.AccessToken.Value
    },
    new OutgoingPaymentBodyFromQuote
    {
        WalletAddress = customerWalletAddress.Id,
        QuoteId = customerQuote.Id,
    }
);
```

`AuthContinue` (`continue` JSON): `Uri`, `AccessToken` (`ContinueAccessToken` / `Access_token2.Value`), optional `Wait` (seconds before the next continuation). `ContinueGrantAsync` defaults a null body to `new GrantContinueBody()`.

Without a quote, `CreateOutgoingPaymentAsync(..., OutgoingPaymentBodyFromIncomingPayment)` takes `IncomingPayment` and `DebitAmount` (`Guides/5_SendRecurringRemittanceWithFixedDebit.cs`).

Get / list need their own grants (`Actions.Read` or `Actions.List`). List passes the wallet id as a string (`IncomingPaymentService.cs`, `OutgoingPaymentService.cs`):

```csharp
var list = await client.ListIncomingPaymentsAsync(
    new AuthRequestArgs { Url = waDetails.ResourceServer, AccessToken = grant.AccessToken!.Value },
    new ListIncomingPaymentQuery { WalletAddress = waDetails.Id.ToString() }
);
var outgoing = await client.ListOutgoingPaymentsAsync(
    new AuthRequestArgs { Url = waDetails.ResourceServer, AccessToken = tokenResponse.AccessToken!.Value },
    new ListOutgoingPaymentQuery { WalletAddress = waDetails.Id.ToString() }
);
await client.GetIncomingPaymentAsync(new AuthRequestArgs { Url = /* incoming URL */, AccessToken = token });
await client.GetOutgoingPaymentAsync(new AuthRequestArgs { Url = /* outgoing URL */, AccessToken = token });
await client.GetQuoteAsync(new AuthRequestArgs { Url = /* quote URL */, AccessToken = token });
```

Public (no grant) incoming read is on the unauthenticated client and takes a raw URL string:

```csharp
await client.GetIncomingPaymentAsync(incomingPaymentUrl); // IUnauthenticatedClient
```

Authenticated name for that call is `GetPublicIncomingPaymentAsync(RequestArgs)`. `CompleteIncomingPaymentsAsync(AuthRequestArgs)` completes an incoming payment (`Actions.Complete` exists on `Actions`).

`Actions`: `Create`, `Complete`, `Read`, `ReadAll`, `List`, `ListAll`.

## Recurring grant (interval limits)

`OutgoingAccessLimits.Interval` is a `string?` (`debitAmount`, `receiveAmount`, `receiver` are the other fields). No interval type or validator. Example from `Guides/5_SendRecurringRemittanceWithFixedDebit.cs` (also `R12/.../P1M` in guide 4 and `R3/.../P1M` with receive amount in guide 6):

```csharp
Limits = new OutgoingAccessLimits
{
    DebitAmount = new AuthAmount("20000", "USD", 2),
    Interval = "R3/2025-10-03T23:25:00Z/P1M"
}
```

Same interactive redirect + `ContinueGrantAsync` as a one-time outgoing grant. The guide then creates one outgoing payment with `OutgoingPaymentBodyFromIncomingPayment` and the same debit amount. Whether one grant authorizes later payments until the interval repeats is **UNVERIFIED** here; the SDK only sends the string.

## Token rotate / revoke and grant cancel

Rotate and revoke use the **manage URL** (`AccessTokenResponse.Manage`) plus the current token value (`Snippets/Services/Authenticated/TokenService.cs`):

```csharp
var rotatedToken = await client.RotateTokenAsync(
    new AuthRequestArgs { Url = new Uri(tokenUrl), AccessToken = accessTokenValue }
);
// rotatedToken.AccessToken.Value, .Manage, .ExpiresIn
await client.RevokeTokenAsync(
    new AuthRequestArgs { Url = new Uri(tokenUrl), AccessToken = accessTokenValue }
);
```

`RotateTokenAsync` → `RotateTokenResponse`. `RevokeTokenAsync` → `Task` (no body).

Cancel a pending grant with the **continuation** URL and continuation token, not the manage URL (`OutgoingPaymentService.CreateOutgoingPaymentGrantAndCancelAsync`):

```csharp
await client.CancelGrantAsync(
    new AuthRequestArgs
    {
        Url = response.Continue.Uri,
        AccessToken = response.Continue.AccessToken.Value,
    }
);
```

## Error handling

There is no shared Open Payments exception type. NSwag emits **three** `ApiException` / `ApiException<TResult>` classes:

- `OpenPayments.Sdk.Generated.Auth.ApiException`
- `OpenPayments.Sdk.Generated.Resource.ApiException`
- `OpenPayments.Sdk.Generated.Wallet.ApiException`

Each has `StatusCode`, `Response` (raw body, message truncates to 512 chars), `Headers`. `ApiException<TResult>.Result` is the deserialized error on 401/403.

Auth error model (`Generated/Auth/Types.cs`): `ErrorResponse.Error` is `ErrorItem` with `Description` and `ErrorItemCode`: `InvalidClient`, `InvalidRequest`, `RequestDenied`, `TooFast`, `InvalidContinuation`, `InvalidRotation` (`invalid_client`, `invalid_request`, `request_denied`, `too_fast`, `invalid_continuation`, `invalid_rotation`). Resource has a separate `ResourceErrorResponse` (`Generated/Resource/Types.cs`).

Grant state (docs `grant-continue.mdx` and every guide):

```csharp
if (grant.AccessToken == null)
    throw new Exception("Expected finalized grant. Received non-finalized grant.");
```

Pending interactive grants still have `Continue` and usually `Interact`. `Continue.Wait` is the only SDK field for “try continuation later.” No poll loop is implemented. Snippets also throw plain `Exception` for a missing redirect (`"No redirect url returned"`).

`IUnauthenticatedClient.GetIncomingPaymentAsync(string)` does **not** throw `ApiException`. It calls `HttpResponseMessage.EnsureSuccessStatusCode()` (`Clients/UnauthenticatedClient.cs`), so failures are `HttpRequestException`, and an empty body is `InvalidOperationException`. Wallet GET/JWKS go through the generated wallet client and do throw wallet `ApiException` (404 copy: `"Wallet Address Not Found"`, `"JWKS Document Not Found"`).

DI misconfiguration throws `InvalidOperationException` with messages `OpenPaymentsOptions.KeyId must be provided.`, same for `PrivateKey` and `ClientUrl`.

## Gotchas

- Register `UseUnauthenticatedClient = true` or `GetRequiredService<IUnauthenticatedClient>()` fails even if an authenticated client exists. The authenticated registration only maps `IAuthenticatedClient`.
- `PrivateKey` is an `NSec` `Key`. Passing a PEM string does not compile. Escaped newlines in env files must be turned into real newlines before `LoadPem`.
- Non-Ed25519 PEM throws `ArgumentException` (`Unexpected algorithm OID`).
- `ClientUrl` is the client’s own wallet address, not the auth server and not the counterparty.
- Resource `Url` on create/list is `WalletAddress.ResourceServer`. Get/continue/rotate `Url` is the specific resource, continuation, or manage URL.
- Incoming vs quote grants omit `Identifier`. Outgoing grants must set `OutgoingAccess.Identifier` to the sender wallet `Id`.
- Two `Amount` types. Auth limits use `OpenPayments.Sdk.Generated.Auth.Amount`. Payment bodies use `OpenPayments.Sdk.Generated.Resource.Amount`.
- Guides do not read `interact_ref` from the redirect. Copying `Guid.NewGuid()` into `InteractRef` will not match the authorization server.
- `Interact.Start` without `Finish` is valid in token and list snippets (`new InteractRequest { Start = [Start.Redirect] }`). Those continuations often pass no `GrantContinueBody` (read/list flows in `OutgoingPaymentService`).
- `ListOutgoingPaymentsAsync` delegates to an internal `ListOutgoingPaymentAsync` (singular). Call the plural method on `IAuthenticatedClient`.
- HTTP 302 on wallet address is an error string (`"If the Accept header is text/html..."`), not a followed redirect (`WalletAddressClient.g.cs`).
- Package version 1.0.0 in the csproj is the local project version. Whether that version is the one on NuGet is **UNVERIFIED** (no network).
