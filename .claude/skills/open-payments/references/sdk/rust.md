# Open Payments Rust SDK (test network only)

Crate **`open-payments` 0.2.0** (`src/lib.rs` exports `client`, `types`, `http_signature`; root re-exports `client::*`). Module path in Rust is `open_payments`. Docs status: **Done** (`open-payments/docs/src/content/docs/sdk/before-you-begin.mdx`). Maturity: resource client, GNAP grants, HTTP message signatures, spent-amount query, directed identity (`CHANGELOG.md` 0.2.0, 2026-08-28). Spec pin noted there: Open Payments **1.3.0**.

Test wallet only: `https://wallet.interledger-test.dev` (same page: create account, fund play money, add wallet address, **Settings → Developer Keys → Generate public & private key** → download `private.key`, copy key ID).

Runnable snippets were **removed** from this crate (`open-payments-rust/src/snippets/README.md`). The blocks below are the Rust tabs in `open-payments/docs/src/content/docs/sdk/*.mdx` plus the public API. Helpers `create_authenticated_client()` and `get_env_var` appear only in those docs; they are **not** in the crate. Their bodies are **UNVERIFIED** in this checkout.

## Status and what is missing

Present: unauthenticated wallet lookup and JWKS; authenticated incoming/outgoing/quote create, get, list; incoming complete; public incoming get; grant request / continue / cancel; token rotate / revoke; outgoing-grant spent amounts; `LimitsOutgoing.interval`; directed identity via `client_override`.

Missing or stubbed:

- `WalletAddressResource::get_did_document` is `unimplemented!()` (`src/client/api.rs`).
- No `is_pending` / `is_finalized` methods. Pending exists only as `ContinueResponse::Pending`. `GrantResponse` is only `WithToken` or `WithInteraction` (`src/types/auth.rs`).
- Docs Rust tab for an **interval** outgoing grant is not a real sample: the one-shot sample sets `interval: None`. A later Rust tab in `grant-create-outgoing.mdx` is the literal `coming soon` (subject-verification section). The type exists; a docs snippet for recurring does not.
- No SDK helper that reads `interact_ref` off the redirect URL. Docs load `INTERACT_REF` from the environment.
- `get_resource_server_url` strips the last path segment. Integration tests say not to use that for the test wallet, because `resourceServer` can be a different host (`tests/integration/common.rs`).

## Install

```toml
[dependencies]
open-payments = "0.2.0"
```

From `README.md` / `Cargo.toml`. `Cargo.toml` sets `rust-version = "1.84"`. The README prerequisite “Rust >= 1.70” disagrees with that; trust `rust-version`. You also need `tokio` (dev-dep in the crate; not a library dependency). Snippets use `uuid` and `chrono` themselves.

```sh
cargo add open-payments
```

That command is **UNVERIFIED** here; the README only shows the `Cargo.toml` lines and `cargo build` inside the SDK repo.

## Credentials

`ClientConfig` (`src/client/config.rs`):

| Field | Role |
| --- | --- |
| `wallet_address_url: String` | Wallet address URL. Sent as GNAP `client` unless you pass a JWK override. |
| `key_id: String` | Key id from the test wallet Developer Keys screen. |
| `private_key_path: PathBuf` | PEM PKCS#8 Ed25519 (`PRIVATE KEY`). File may be raw PEM or standard-base64 of that PEM (`src/http_signature/utils.rs`). |
| `jwks_path: Option<PathBuf>` | If `Some`, `AuthenticatedClient::new` writes a JWKS next to the key. |

`Default`: `key_id` and `wallet_address_url` empty, `private_key_path` = `private.key`, `jwks_path` = `None`.

**Gotcha:** if `private_key_path` does not exist, `load_or_generate_key` **creates a new key** and the client still constructs. A missing test-wallet key silently signs with an unregistered key.

Integration env names (`tests/integration/.env.example` usage in `common.rs`): `OPEN_PAYMENTS_WALLET_ADDRESS`, `OPEN_PAYMENTS_KEY_ID`, `OPEN_PAYMENTS_PRIVATE_KEY_PATH`. Docs snippets use `WALLET_ADDRESS_URL` via `get_env_var` (**UNVERIFIED** helper).

## Clients

```rust
use open_payments::client::{AuthenticatedClient, ClientConfig, UnauthenticatedClient};

let unauth = UnauthenticatedClient::new(); // no config; public GETs

let client = AuthenticatedClient::new(ClientConfig {
    private_key_path: "private.key".into(),
    key_id: "my-key-id".to_string(),
    jwks_path: Some("jwks.json".into()),
    wallet_address_url: "https://wallet.interledger-test.dev/YOUR_ADDRESS".into(),
})?;
```

`AuthenticatedClient` is a type alias of `AuthenticatedOpenPaymentsClient` (`src/client/core.rs`). Traits: `AuthenticatedResources`, `UnauthenticatedResources`. An authenticated client can call both (`grant-create-incoming.mdx`). `public_jwk()` returns the Ed25519 public `JsonWebKey` for directed identity.

`grant().request` fills `GrantRequest.client` from `config.wallet_address_url` (`GrantRequest::new` docs). Third argument `client_override: Option<&JsonWebKey>` replaces that with directed identity (`None` = wallet URL). **Breaking in 0.2.0.**

## One-time payment

Use the **receiver** wallet for the incoming-payment grant and the incoming payment, and the **sender** wallet for the quote grant, quote, outgoing-payment grant, and outgoing payment. Docs use one `WALLET_ADDRESS_URL` in each isolated snippet.

### 1. Wallet address

```rust
use open_payments::client::api::UnauthenticatedResources;
let wallet_address = client.wallet_address().get(&wallet_address_url).await?;
// wallet_address.id, .auth_server, .resource_server, .asset_code, .asset_scale
```

`wallet-get-info.mdx`. Prefer `wallet_address.resource_server` over `open_payments::client::utils::get_resource_server_url`.

### 2. Non-interactive incoming-payment grant

`grant-create-incoming.mdx`:

```rust
use open_payments::types::auth::{
    AccessItem, AccessTokenRequest, GrantRequest, GrantResponse, IncomingPaymentAction,
};

let grant_request = GrantRequest::new(
    AccessTokenRequest {
        access: vec![AccessItem::IncomingPayment {
            actions: vec![
                IncomingPaymentAction::Create,
                IncomingPaymentAction::Read,
                IncomingPaymentAction::ReadAll,
                IncomingPaymentAction::List,
                IncomingPaymentAction::Complete,
            ],
            identifier: None,
        }],
    },
    None, // no interact
);
let response = client
    .grant()
    .request(&wallet_address.auth_server, &grant_request, None)
    .await?;
let incoming_token = match response {
    GrantResponse::WithToken { access_token, .. } => access_token,
    GrantResponse::WithInteraction { .. } => unreachable!("Interaction not required for incoming payments"),
};
// incoming_token.value, incoming_token.manage
```

### 3. Create incoming payment

`incoming-create.mdx`. `IncomingPaymentRequest` is an alias of `CreateIncomingPaymentRequest` (`src/types/mod.rs`).

```rust
use open_payments::types::{resource::CreateIncomingPaymentRequest, Amount};
use chrono::{Duration, Utc};

let request = CreateIncomingPaymentRequest {
    wallet_address: wallet_address_url.clone(),
    incoming_amount: Some(Amount {
        value: "1000".to_string(),
        asset_code: "EUR".to_string(),
        asset_scale: 2,
    }),
    expires_at: Some(Utc::now().checked_add_signed(Duration::minutes(10000)).unwrap()),
    metadata: None,
};
let payment = client
    .incoming_payments()
    .create(&wallet_address.resource_server, &request, Some(&incoming_token.value))
    .await?;
// payment.id is the incoming-payment URL used as the quote receiver
```

### 4. Quote grant and quote

`grant-create-quote.mdx` then `quote-create.mdx`. Quote grants are non-interactive (`interact: None`). `QuoteRequest` aliases `CreateQuoteRequest`.

```rust
use open_payments::types::{
    auth::{AccessItem, AccessTokenRequest, GrantRequest, QuoteAction},
    resource::CreateQuoteRequest, PaymentMethodType, Receiver,
};

let quote_grant = GrantRequest::new(
    AccessTokenRequest {
        access: vec![AccessItem::Quote {
            actions: vec![QuoteAction::Create, QuoteAction::Read, QuoteAction::ReadAll],
        }],
    },
    None,
);
// match GrantResponse::WithToken the same way as the incoming grant
let quote = client.quotes().create(
    &sender_wallet.resource_server,
    &CreateQuoteRequest::NoAmountQuote {
        wallet_address: sender_wallet_address_url,
        receiver: Receiver(payment.id.clone()),
        method: PaymentMethodType::Ilp,
    },
    Some(&quote_access_token),
).await?;
```

Other `CreateQuoteRequest` variants exist in `src/types/resource.rs` (fixed send/receive). The docs Rust tab only shows `NoAmountQuote`.

### 5. Interactive outgoing-payment grant

`grant-create-outgoing.mdx`. `start: ["redirect"]`, `finish.method: "redirect"`. `limits.debit_amount` is copied from `quote.debit_amount`. `identifier` is the **sender** wallet id.

```rust
use open_payments::types::auth::{
    AccessItem, AccessTokenRequest, GrantRequest, InteractFinish, InteractRequest,
    LimitsOutgoing, OutgoingPaymentAction,
};

let grant_request = GrantRequest::new(
    AccessTokenRequest {
        access: vec![AccessItem::OutgoingPayment {
            actions: vec![
                OutgoingPaymentAction::Read,
                OutgoingPaymentAction::ReadAll,
                OutgoingPaymentAction::List,
                OutgoingPaymentAction::Create,
            ],
            identifier: wallet_id.to_string(),
            limits: Some(LimitsOutgoing {
                receiver: None,
                debit_amount: Some(quote.debit_amount.clone()),
                receive_amount: None,
                interval: None,
            }),
        }],
    },
    Some(InteractRequest {
        start: vec!["redirect".to_string()],
        finish: Some(InteractFinish {
            method: "redirect".to_string(),
            uri: "http://localhost".to_string(),
            nonce: Uuid::new_v4().to_string(),
        }),
    }),
);
let response = client
    .grant()
    .request(&wallet_address.auth_server, &grant_request, None)
    .await?;
match response {
    GrantResponse::WithInteraction { interact, continue_ } => {
        // Send the user to interact.redirect
        // continue_.uri, continue_.access_token.value, continue_.wait
    }
    GrantResponse::WithToken { .. } => { /* already issued; unusual for this interact mode */ }
}
```

### 6. `interact_ref`, continue, create outgoing payment

After the wallet redirects to `finish.uri`, the query contains `interact_ref` (and `hash`). **This crate does not parse that URL.** `grant-continue.mdx` reads `CONTINUE_ACCESS_TOKEN`, `CONTINUE_URI`, `INTERACT_REF`.

```rust
use open_payments::types::auth::ContinueResponse;

let response = client
    .grant()
    .continue_grant(&continue_uri, &interact_ref, Some(&continue_access_token))
    .await?;
let outgoing_token = match response {
    ContinueResponse::WithToken { access_token, .. } => access_token,
    ContinueResponse::WithSubject { .. } => panic!("subject-only continuation"),
    ContinueResponse::Pending { .. } => panic!("still pending; honor continue.wait"),
};
```

`outgoing-create.mdx`:

```rust
use open_payments::types::OutgoingPaymentRequest;

let payment = client.outgoing_payments().create(
    &resource_server_url,
    &OutgoingPaymentRequest::FromQuote {
        wallet_address: wallet_address_url,
        quote_id: quote_url, // quote.id URL
        metadata: None,
    },
    Some(&outgoing_token.value),
).await?;
```

### 7. Get and list

`incoming-get.mdx`, `outgoing-get.mdx`, `quote-get.mdx`, `outgoing-list.mdx` (incoming list matches this shape):

```rust
client.incoming_payments().get(&payment_url, Some(&access_token)).await?;
client.public_incoming_payments().get(&payment_url).await?; // no token; public view
client.outgoing_payments().get(&payment_url, Some(&access_token)).await?;
client.quotes().get(&quote_url, Some(&access_token)).await?;
client.outgoing_payments().list(
    &resource_server_url,
    &wallet_address_url,
    None,        // cursor
    Some(10),    // first
    None,        // last
    Some(&access_token),
).await?;
// response.result, response.pagination.has_next_page, pagination.end_cursor
```

`incoming_payments().complete(&payment_url, Some(&token))` (`incoming-complete.mdx`). `outgoing_payments().get_grant_spent_amounts(&resource_server_url, Some(&token))` maps to `GET /outgoing-payment-grant` (`src/client/api.rs`). Amount fields on `OutgoingPayment` are `Option<Amount>` since 0.2.0.

## Recurring grant (interval limits)

`LimitsOutgoing.interval` is `Option<Interval>`, and `Interval` is a newtype string (`src/types/common.rs`: `pub struct Interval(pub String)`). Set it on the same `AccessItem::OutgoingPayment` as the one-shot grant, with the same redirect `InteractRequest` (outgoing grants stay interactive). Example shape, from the type plus the one-shot snippet (the ISO string itself is the PHP docs sample in `grant-create-outgoing.mdx`, not a Rust sample):

```rust
limits: Some(LimitsOutgoing {
    receiver: None,
    debit_amount: Some(quote.debit_amount),
    receive_amount: None,
    interval: Some(open_payments::types::Interval(
        "R/2025-04-22T08:00:00Z/P1D".to_string(),
    )),
}),
```

There is no separate recurring-grant method. Finish still goes through `continue_grant`. A Rust docs snippet that sets `interval: Some(...)` is **not in the local docs**.

## Token rotate, revoke, grant cancel

Manage URL is `access_token.manage`. The Rust parameter is named `auth_url` (`src/client/api.rs`); docs pass the manage URL, not `auth_server`.

```rust
// token-rotate.mdx
let response = client.token().rotate(&token_manage_url, Some(&access_token)).await?;
// response.access_token

// token-revoke.mdx
client.token().revoke(&token_manage_url, Some(&access_token)).await?;

// grant-revoke.mdx — continuation token + continue URI, not the payment token
client.grant().cancel(&continue_uri, Some(&continue_access_token)).await?;
```

## Errors and grant state

`open_payments::client::Result<T>` is `Result<T, Box<OpClientError>>`. `OpClientError` is a **struct**, not an enum (`src/client/error.rs`): `description`, `validation_errors`, `status: Option<String>` (reason phrase), `code: Option<u16>`, `details`. Constructors: `http`, `validation`, `other`, plus `header_parse`, `pem`, `pkcs8`, `signature`. `From` for reqwest, JSON, IO, base64, URL parse.

```rust
match result {
    Ok(v) => v,
    Err(e) => {
        eprintln!("{}", e.description);
        if let Some(code) = e.code { eprintln!("{code}"); }
        if let Some(errs) = &e.validation_errors { eprintln!("{errs:?}"); }
    }
}
```

Grant checks are matches, not methods:

| State | How to see it |
| --- | --- |
| Access token issued | `GrantResponse::WithToken` or `ContinueResponse::WithToken` (`has_access_token()`) |
| User must interact | `GrantResponse::WithInteraction { interact, continue_ }` — open `interact.redirect` |
| Continuation still pending | `ContinueResponse::Pending { continue_ }` — `continue_.wait` |
| Subject only | `ContinueResponse::WithSubject` or `WithToken.subject` (`has_subject()`) |

`GrantRequest::subject_only` / `with_subject` exist (`src/types/auth.rs`). The docs Rust sample for a subject grant is `coming soon`.

## Gotchas

1. **Missing private key is generated**, not rejected (`load_or_generate_key`).
2. **`grant().request` third argument is required** (`Option<&JsonWebKey>`). `None` keeps the configured wallet URL as `client`.
3. **`GrantRequest.client` is `pub(crate)`**. Build requests with `GrantRequest::new` or `subject_only`. Do not set `client` yourself.
4. **`get_resource_server_url` is the wrong host strategy** for `wallet.interledger-test.dev`. Read `WalletAddress.resource_server`.
5. **Quote vs payment tokens are different grants.** Docs env names: `INCOMING_PAYMENT_ACCESS_TOKEN`, `QUOTE_ACCESS_TOKEN`, `OUTGOING_PAYMENT_ACCESS_TOKEN`, plus `CONTINUE_*` for the interactive step.
6. **`continue_grant` / `cancel` want the continuation access token** (`continue_.access_token.value`), not the final payment token.
7. **Rotate/revoke URL is `access_token.manage`.**
8. **No redirect parser and no pending/finalized predicates.**
9. **`get_did_document` panics** (`unimplemented!`).
10. **Docs samples call `create_authenticated_client()?`**, which is outside this crate. Production code is `AuthenticatedClient::new(config)?`.
11. **README Rust `>= 1.70` vs `rust-version = "1.84"`.**
12. **HTTP signatures are automatic** on the authenticated client. `http_signature::{create_signature_headers, SignOptions}` is a lower-level API (`src/lib.rs` doctest), not required for the payment flow.
