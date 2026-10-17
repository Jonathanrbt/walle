# Python SDK (`open-payments-python-sdk`)

Test network only. Wallet addresses in this SDK’s own samples are `https://ilp.interledger-test.dev/<id>`. The dashboard that issues those addresses is `https://wallet.interledger-test.dev`. Docs status: **In Progress** (`open-payments/docs/src/content/docs/sdk/before-you-begin.mdx`). The official docs tree has **no Python snippets** under `sdk/` or non-`es` partials beyond that status row. Every snippet below is from the SDK repo.

## Status & version

| | |
|---|---|
| Docs status | In Progress |
| README | “still a work in progress” (`open-payments-python-sdk/README.md`) |
| Package | Poetry name `open-payments-sdk`, version **0.1.0**, `requires-python >= 3.10` (`pyproject.toml`). README says Python `>= 3.11`. |
| Wheel | `dist/open_payments_sdk-0.1.0-py3-none-any.whl` |
| Import | `open_payments_sdk` (`src/open_payments_sdk/__init__.py` is empty) |
| PyPI | README: `pip install open-payments-python-sdk` is “currently not setup” |

**Present:** one client that always holds a key; unsigned wallet GET; signed grant request / continuation / delete; access-token rotate and delete; incoming payment create, list, get, complete; quote create and get; outgoing payment create, list, get. Models include outgoing `limits` with optional ISO 8601 `interval`.

**Missing (no method, no helper, no finished example):**

- A separate unauthenticated client type.
- `isPendingGrant` / `isFinalizedGrant` (or any grant-state helper).
- Public (unauthenticated) read of an incoming payment by URL.
- A finished one-time payment example. README and tests stop at wallet GET and `post_grant_request`. `tests/integration/test_grants.py` `test_create_interactive_grant_request` is an empty function. `interactive_grant_req_dto` is `GrantRequest(**{})` with `#TODO complete writing tests`.
- Grant polling (`continue.wait` is modeled, never used).
- Using the token `manage` URL. Rotate/revoke rebuild `{authServer}/token/{token_id}`.

## Install

Dev checkout (`README.md`):

```bash
poetry install
poetry build
pip install </path/to/>open-payments-python-sdk/dist/open_payments_sdk-0.1.0-py3-none-any.whl
```

Module after install: `open_payments_sdk`. Runtime deps: `httpx`, `pydantic` v2, `cryptography`, `http-message-signatures`.

## Credentials

The client needs three strings. `client_wallet_address` is stored and **never read** by any method (`client.py`). The wallet address that identifies the client is the `client` field on `GrantRequest`.

Key material is an Ed25519 PEM **string**. `KeyManager.generate_key_pair()` writes PKCS8 PEM and a JWKS entry (`kid`, `x`, `alg=EdDSA`, `kty=OKP`, `crv=Ed25519`). The public JWKS must be hosted at `{client wallet address}/jwks.json` (model docstring on `Client` in `models/auth.py`).

```python
# open-payments-python-sdk/README.md
import json
from open_payments_sdk.gnap_utils.keys import KeyManager

key_manager = KeyManager()
key_pair = key_manager.generate_key_pair()

with open("privkey.pem", "w", encoding="utf_8") as pem_file:
    pem_file.write(key_pair.private_key_pem)

with open("jwks.json", "w", encoding="utf_8") as jwks_file:
    jwks_file.write(json.dumps(key_pair.jwks.keys[0].__dict__))

with open("privkey.pem", "r", encoding="utf_8") as privkey:
    private_key = privkey.read()  # PEM str — this is what OpenPaymentsClient expects
```

`load_ed25519_private_key_from_pem` returns `cryptography`’s `Ed25519PrivateKey`, not a PEM string. Do not pass that object into `OpenPaymentsClient` (annotation is `str`). Tests load the PEM file as text (`tests/conftest.py`, key id `a96a5611-c5fa-49c0-8cb4-184763eca0b8`).

## Clients

There is only `OpenPaymentsClient`. Wallet calls on it are unsigned. Everything else signs with HTTP message signatures (`label="sig1"`, Ed25519) and, when a token is passed, `Authorization: GNAP {access_token}`.

```python
# constructor: open-payments-python-sdk/src/open_payments_sdk/client/client.py
# required: keyid, private_key, client_wallet_address
# optional: cfg=configuration.Configuration(), http_client=HttpClient(http_timeout=10.0)

from open_payments_sdk.client.client import OpenPaymentsClient

op_client = OpenPaymentsClient(
    keyid="a96a5611-c5fa-49c0-8cb4-184763eca0b8",
    private_key=private_key,  # PEM str
    client_wallet_address="https://ilp.interledger-test.dev/elijahokellosalary",
)
# op_client.wallet            unsigned
# op_client.grants            Grants
# op_client.access_tokens     AccessTokens
# op_client.incoming_payments IncomingPayments
# op_client.outgoing_payments OutgoingPayments
# op_client.quotes            Quotes
```

The README constructor omits `client_wallet_address`. That call does not match `client.py` and raises `TypeError`.

**Unauthenticated use** is `op_client.wallet` only:

```python
# open-payments-python-sdk/src/open_payments_sdk/api/wallet.py
wallet = op_client.wallet.get_wallet_address(
    "https://ilp.interledger-test.dev/elijahokellosalary"
)
# wallet.id, .publicName, .assetCode, .assetScale, .authServer, .resourceServer
jwks = op_client.wallet.get_keys(
    "https://ilp.interledger-test.dev/elijahokellosalary"
)  # GET {url}/jwks.json
```

README sample response: `authServer` `https://auth.interledger-test.dev/`, `resourceServer` `https://ilp.interledger-test.dev/`.

## One-time payment

Resource methods all take `resource_server_endpoint` (wallet `resourceServer`) and `access_token` (the **value** string). Grant methods take `auth_server_endpoint` (wallet `authServer`). Amounts are decimal strings. `WalletAddress` / `Receiver` / `Client` are pydantic `RootModel`s: construct with the URL string, or a dict field that pydantic coerces.

### 1. Receiver wallet

```python
receiver = op_client.wallet.get_wallet_address(
    "https://ilp.interledger-test.dev/5c327379"
)
auth = str(receiver.authServer)
rs = str(receiver.resourceServer)
```

### 2. Non-interactive incoming-payment grant

Omit `interact`. Actions live on `ActionIncoming`: `create`, `complete`, `read`, `read-all`, `list`, `list-all`.

```python
# shape from tests/conftest.py grant_req_dto, minus interact
from open_payments_sdk.models.auth import GrantRequest

incoming_grant = op_client.grants.post_grant_request(
    grant_request=GrantRequest(
        access_token={
            "access": [
                {
                    "type": "incoming-payment",
                    "actions": ["create", "read", "complete"],
                    "identifier": "https://ilp.interledger-test.dev/5c327379",
                }
            ]
        },
        client="https://ilp.interledger-test.dev/elijahokellosalary",
    ),
    auth_server_endpoint=auth,
)
# Non-interactive body validates as GrantResponse (models/auth.py):
token = incoming_grant.root.access_token.value
# incoming_grant.root.access_token.manage, .expires_in, .access
# incoming_grant.root.cont  — JSON key "continue" is renamed to "cont"
```

`Grant` is `RootModel[Union[InteractionInstructionsResponse, GrantResponse]]`. With no `interact`, the response is `GrantResponse` and `.root.access_token` is set. The integration test asserts `grant_response.root.access_token.value`.

### 3. Create incoming payment

```python
# IncomingPayments.post_create_payment — api/resource.py
# IncomingPaymentRequest — models/resource.py
incoming = op_client.incoming_payments.post_create_payment(
    payment={
        "walletAddress": "https://ilp.interledger-test.dev/5c327379",
        "incomingAmount": {
            "value": "1000",
            "assetCode": "USD",
            "assetScale": 2,
        },
        # "expiresAt": "...", "metadata": {}  optional
    },
    resource_server_endpoint=rs,
    access_token=token,
)
# returns IncomingPayment; id is AnyUrl
```

`incomingAmount` may be omitted (open incoming payment). No sample of that call exists in the repo; the model allows `Optional[Amount]`.

### 4. Quote grant and quote

`AccessQuote` has **no** `identifier`. Actions: `create`, `read`, `read-all`. Quote `receiver` must contain `/incoming-payments/` in the path (`QuoteRequestBase.check_path`); failure is `AssertionError`.

```python
quote_grant = op_client.grants.post_grant_request(
    grant_request=GrantRequest(
        access_token={
            "access": [{"type": "quote", "actions": ["create", "read"]}]
        },
        client="https://ilp.interledger-test.dev/elijahokellosalary",
    ),
    auth_server_endpoint=str(sender.authServer),  # sender wallet, not receiver
)
q_token = quote_grant.root.access_token.value

# QuoteFixedReceive | QuoteFixedSent | QuoteRequestBase, method is Literal["ilp"]
quote = op_client.quotes.post_create_quote(
    quote={
        "walletAddress": "https://ilp.interledger-test.dev/elijahokellosalary",
        "receiver": str(incoming.id),
        "method": "ilp",
        "receiveAmount": {"value": "1000", "assetCode": "USD", "assetScale": 2},
    },
    resource_server_endpoint=str(sender.resourceServer),
    access_token=q_token,
)
# Quotes.get_quote(quote_id, resource_server_endpoint, access_token)
```

Fixed-send uses `debitAmount` instead of `receiveAmount` (`QuoteFixedSent`). No repo example builds this dict; fields are from `models/resource.py`.

### 5. Interactive outgoing-payment grant

`InteractRequest.start` is only `["redirect"]`. `finish.method` is only `"redirect"`. `finish.nonce` is required when `finish` is set.

```python
# interact block copied from tests/conftest.py grant_req_dto
# outgoing access shape from AccessOutgoing / LimitsOutgoing1 in models/auth.py
outgoing_grant = op_client.grants.post_grant_request(
    grant_request=GrantRequest(
        access_token={
            "access": [
                {
                    "type": "outgoing-payment",
                    "actions": ["create", "read"],
                    "identifier": "https://ilp.interledger-test.dev/elijahokellosalary",
                    "limits": {
                        "receiver": str(incoming.id),
                        "debitAmount": {
                            "value": "2000",
                            "assetCode": "USD",
                            "assetScale": 2,
                        },
                    },
                }
            ]
        },
        client="https://ilp.interledger-test.dev/elijahokellosalary",
        interact={
            "start": ["redirect"],
            "finish": {
                "method": "redirect",
                "uri": "https://webmonize.com/return/876FGRD8VC",
                "nonce": "4edb2194-dbdf-46bb-9397-d5fd57b7c8a7",
            },
        },
    ),
    auth_server_endpoint=str(sender.authServer),
)
# Pending interaction validates as InteractionInstructionsResponse:
redirect_url = outgoing_grant.root.interact.redirect
continue_uri = str(outgoing_grant.root.cont.uri)
continue_token = outgoing_grant.root.cont.access_token.value
# outgoing_grant.root.cont.wait  optional seconds; SDK never sleeps
# outgoing_grant.root.interact.finish  callback key from the AS
```

Send the user to `redirect_url`. The SDK does not open a browser and does not read the query string. After redirect, **you** take `interact_ref` off the callback URI. `UNVERIFIED` which query parameter name the test wallet uses; the continuation body field is exactly `interact_ref`:

```python
# models/auth.py InteractRef
# Grants.post_grant_continuation_request
from open_payments_sdk.models.auth import InteractRef

continued = op_client.grants.post_grant_continuation_request(
    interact_ref=InteractRef(interact_ref="<value from the redirect>"),
    continue_uri=continue_uri,
    access_token=continue_token,
)
out_token = continued.access_token.value
```

`GrantContinueResponse` is `{access_token, cont: Optional[Continue]}`. It does **not** use the `continue` → `cont` validator (`ReservedKeyMappingModel` is only on `GrantResponse` and `InteractionInstructionsResponse`). A spec body that returns `"continue"` will fail validation here. No test covers continuation.

### 6. Create, get, list outgoing payment

```python
# OutgoingPaymentRequest = quoteId form | incomingPayment+debitAmount form
payment = op_client.outgoing_payments.post_create_payment(
    payment={
        "walletAddress": "https://ilp.interledger-test.dev/elijahokellosalary",
        "quoteId": str(quote.id),
    },
    resource_server_endpoint=str(sender.resourceServer),
    access_token=out_token,
)

one = op_client.outgoing_payments.get_outgoing_payment(
    payment_id="<id segment>",  # URL path segment, not the full payment URL
    resource_server_endpoint=str(sender.resourceServer),
    access_token=out_token,
)

listed = op_client.outgoing_payments.get_outgoing_payments(
    query={
        "walletAddress": "https://ilp.interledger-test.dev/elijahokellosalary",
        # cursor, first (1..100), last (1..100) optional
    },
    resource_server_endpoint=str(sender.resourceServer),
    access_token=out_token,
)
```

`get_outgoing_payments` is broken in source: it assigns the signed `Request` to `response`, discards `send()`, then calls `response.json()` on the request (`api/resource.py`). Do not use list until that is fixed.

Incoming counterparts (these do return the HTTP body):

```python
op_client.incoming_payments.get_incoming_payment(payment_id, rs, token)
# returns IncomingPaymentResponse: PublicIncomingPayment | IncomingPaymentWithMethods
op_client.incoming_payments.get_incoming_payments(query, rs, token)  # list/list-all grant
op_client.incoming_payments.post_complete_incoming_payment(payment_id, rs, token)
```

`get_outgoing_payment` does not `rstrip("/")` the resource server. `get_quote` uses `strip("/")` (both ends). Other resource URLs use `rstrip("/")`.

## Recurring grant (interval limits)

No recurring-payment type and no subscription client. Recurrence is `limits` on an outgoing-payment access item. At least one of `debitAmount` or `receiveAmount` is required (`LimitsOutgoing2` / `LimitsOutgoing3`); both optional only on `LimitsOutgoing1`, which will not satisfy the union if both are missing. `interval` is an ISO 8601 repeating interval string. Model examples:

`R11/2022-08-24T14:15:22Z/P1M`, `R/2017-03-01T13:00:00Z/2018-05-11T15:30:00Z`, `R-1/P1Y2M10DT2H30M/2022-05-11T15:30:00Z`.

```python
# models/auth.py LimitsOutgoing2 — amounts are maxima across the interval
"limits": {
    "receiver": str(incoming.id),  # optional
    "debitAmount": {"value": "5000", "assetCode": "USD", "assetScale": 2},
    "interval": "R/2022-08-24T14:15:22Z/P1M",
}
```

The same interactive grant + `post_grant_continuation_request` flow applies. Nothing in the SDK creates the later payments of the series for you; call `post_create_payment` again under that token.

## Token rotate, revoke, grant cancel

`token_id` is the path segment you supply. The SDK does not parse `access_token.manage`.

```python
# AccessTokens — api/auth.py
rotated = op_client.access_tokens.post_rotate_access_token(
    token_id="<uuid>",
    auth_server_endpoint=auth,          # POST {auth}/token/{token_id}
    access_token=token,
)  # AccessToken

op_client.access_tokens.delete_access_token(
    token_id="<uuid>",
    auth_server_endpoint=auth,          # DELETE {auth}/token/{token_id}
    access_token=token,
)

# Grants.delete_grant — DELETE {auth}/continue/{req_id}
# req_id is not parsed from cont.uri
op_client.grants.delete_grant(
    req_id="<continue id>",
    auth_server_endpoint=auth,
    access_token=continue_token,
)
```

Rotate/delete return nothing on delete (`None`). No tests call these three methods.

## Errors

There are **no SDK error classes**. `HttpClient.send` uses `httpx.Client` and `res.raise_for_status()`, so HTTP failures are `httpx.HTTPStatusError`. Body is not parsed into an Open Payments error model. Timeout is 10 seconds, hardcoded (`# TODO: get from cfg`).

Pydantic `ValidationError` if a response does not match the model (likely on grant continuation, see `continue` vs `cont`). `QuoteRequest` path check raises `AssertionError`. `KeyManager.load_ed25519_private_key_from_pem` raises `ValueError` if the key is not Ed25519.

**Pending vs finalized:** not implemented. You distinguish by the `Grant.root` variant:

- `InteractionInstructionsResponse` — has `interact` and `cont`, no access token yet (pending interaction).
- `GrantResponse` — has `access_token` and `cont`.
- `GrantContinueResponse` — has `access_token` and optional `cont`.

There is no `wait` loop. If both variants could match a payload, behavior is whatever pydantic union matching does. `UNVERIFIED` against a live test-wallet body; no fixture JSON is stored in the repo.

## Gotchas

1. README client construction is stale: `client_wallet_address` is required and then unused. README also rebinds `private_key` from a PEM string to an `Ed25519PrivateKey`. The signer path (`OPKeyResolver`) is built with the constructor’s `private_key` string.
2. JSON property `continue` is renamed to attribute `cont` only when parsing `Grant` (`GrantResponse` / `InteractionInstructionsResponse`). `GrantContinueResponse.cont` has no such validator.
3. `get_outgoing_payments` never reads the HTTP response (bug above).
4. `get_incoming_payment` is annotated `-> IncomingPayment` but returns `IncomingPaymentResponse` (`PublicIncomingPayment | IncomingPaymentWithMethods`).
5. `tests/conftest.py` fixture `grant()` calls `op_client` and `grant_req_dto` as globals, not fixture parameters, and its return type is annotated `str` while it returns a `Grant`.
6. Interactive grant test and `interactive_grant_req_dto` are stubs.
7. `OutgoingPayment` and `JsonWebKeySet` use `extra="forbid"`. Unknown JSON fields fail validation. `WalletAddress` uses `extra="allow"`.
8. List pagination `PaymentListQuery` requires `walletAddress` and optional `cursor` / `first` / `last`. No `wallet-address` query alias.
9. HTTP signatures cover `@method`, `@target-uri`, plus `content-type`, `content-digest`, `content-length` on JSON posts, plus `authorization` when a GNAP token is set. Default JSON header is only `Content-Type: application/json` (no `Accept`).
10. Hosts in code are `ilp.interledger-test.dev` and `auth.interledger-test.dev`, not `wallet.interledger-test.dev`.
