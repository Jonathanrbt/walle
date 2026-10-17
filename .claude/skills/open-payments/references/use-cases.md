# Open Payments use cases (from English guides)

Test-network skill context. Guides use `*.example.com` hosts, not a testnet hostname. Amounts are strings in minor units: `value`, `assetCode`, `assetScale`. Display amount = `value / 10^assetScale` (`USD` scale 2: `"10000"` = $100.00). Debit amount is what leaves the sender, in the sender asset. Receive amount is what arrives, in the recipient asset.

Shared mechanics:

- `GET` each wallet address. Use `authServer` for grants and `resourceServer` for resources. Read `assetCode` and `assetScale` from that wallet.
- `incoming-payment` and `quote` grants are non-interactive. Request `actions: ["create"]` on the recipient auth server (incoming) or sender auth server (quote). The response includes `access_token.value` immediately.
- `outgoing-payment` grants are interactive. Body includes `interact.start: ["redirect"]` and `interact.finish: { method: "redirect", uri, nonce }`. The pending response has `interact.redirect`, `continue.uri`, `continue.access_token`, and `continue.wait` (examples use `30`). Redirect the user, then `POST` the continuation to `continue.uri` with `interact_ref` from the return query. If there is no UI, poll until interaction finishes. Do not create the outgoing payment until continuation returns the final `access_token`.
- Interval limits use `R{n}/{start ISO-8601}/P…` (example `R3/2025-10-03T23:25:00Z/P1M` = 3 monthly windows). The cap resets each window. Unspent amount does not roll over. Any number of payments is allowed inside the cap. Reuse the same grants on later cycles. If the access token expired, `POST` rotate token and use the new token. That is token expiry, not a new grant.
- Quote `method` in every guide snippet is `"ilp"`. Create the outgoing payment before `expiresAt`. If it fails because the quote expired, create a new quote.
- Three quote shapes (`concepts/resources`): (1) incoming-amount quote — incoming payment has `incomingAmount`; quote body is `walletAddress` + `receiver` (incoming payment URL) only; incoming payment completes when the outgoing payment completes. (2) Fixed-send — open incoming payment plus quote `debitAmount`; incoming payment does not auto-complete (call complete, or it expires). (3) Fixed-receive — open incoming payment plus quote `receiveAmount`; incoming payment auto-completes.
- Outgoing payment with a quote sends `quoteId` only (no extra amounts). Without a quote, send `incomingPayment` plus `debitAmount`.

Nine English guides exist. No other guide files under `guides/` (Spanish copies ignored).

## Accept a one-time online purchase

Source: `guides/accept-otp-online-purchase`. Use when a merchant must receive a known price (example $1,400 MXN shoes) and the payer approves once. If a platform fee must be paid directly, use split payments instead.

Grants:

- Retailer auth server: `incoming-payment`, `actions: ["create"]`. No limits.
- Customer auth server: `quote`, `actions: ["create"]`. No limits.
- Customer auth server, interactive: `outgoing-payment`, `actions: ["create"]`, `identifier` = customer wallet URL, `limits.debitAmount` = `{ assetCode: "MXN", assetScale: 2, value: "140000" }`. The snippet sets this debit limit in MXN even though the example customer wallet `assetCode` is `USD`. Copy the documented body; do not “correct” the currency unless you recompute the quote debit.

Quote: incoming-amount quote (no `debitAmount` or `receiveAmount` on the quote). The quote response still returns both amounts. `receiveAmount` equals the incoming payment’s `incomingAmount`.

Steps:

1. `GET` customer and retailer wallet addresses.
2. Incoming-payment grant on the retailer auth server.
3. Create incoming payment on the retailer resource server: `walletAddress` = retailer id, `incomingAmount` = `{ value: "140000", assetCode: "MXN", assetScale: 2 }`.
4. Quote grant on the customer auth server.
5. Create quote: `method: "ilp"`, `walletAddress` = customer id, `receiver` = incoming payment `id`.
6. Interactive outgoing grant (limits above).
7. Start redirect interaction.
8. Finish interaction (user returns).
9. Grant continuation with `interact_ref`.
10. Create outgoing payment: `quoteId` = quote `id`.

## One-time remittance, fixed debit

Source: `guides/onetime-remittance-fixed-debit`. Use when the sender fixes what they pay (example exactly $100 USD) and the recipient amount may change with FX (example receive about $1,700 MXN).

Grants:

- Recipient: `incoming-payment`, `actions: ["create"]` (TypeScript snippet). The Rust snippet also lists `complete`. The guide’s example grant response shows only `create`.
- Sender: `quote`, `actions: ["create"]`.
- Sender, interactive: `outgoing-payment`, `actions: ["create"]`, `limits.debitAmount` = `{ assetCode: "USD", assetScale: 2, value: "10000" }`. No interval.

Quote: fixed-send. Body includes `debitAmount` `{ value: "10000", assetCode: "USD", assetScale: 2 }`. Response `debitAmount` stays $100 USD; `receiveAmount` is the converted credit.

Steps:

1. `GET` sender and recipient wallets (example sender USD scale 2, recipient MXN scale 2).
2. Incoming-payment grant on the recipient auth server.
3. Create an open incoming payment: `walletAddress` only. No `incomingAmount`.
4. Quote grant on the sender auth server.
5. Create quote: `method: "ilp"`, `walletAddress`, `receiver` = incoming payment id, `debitAmount` as above.
6. Interactive outgoing grant with the same `debitAmount` in `limits`.
7. Start interaction.
8. Finish interaction.
9. Continuation with `interact_ref`.
10. Create outgoing payment with `quoteId` only.

Because the incoming payment has no `incomingAmount`, it does not auto-complete. Call complete, or let it expire.

## One-time remittance, fixed receive

Source: `guides/onetime-remittance-fixed-receive`. Use when the recipient must get an exact amount (example $5,000 MXN = `"500000"`) and the sender’s debit floats with FX.

Grants:

- Recipient: `incoming-payment`, `actions: ["create"]` (Rust snippet also includes `complete`; example response shows `create`).
- Sender: `quote`, `actions: ["create"]`.
- Sender, interactive: `outgoing-payment`, `actions: ["create"]`, `limits.receiveAmount` = `{ assetCode: "MXN", assetScale: 2, value: "500000" }`. Put the same `receiveAmount` on the grant as on the quote.

Quote: fixed-receive. `receiveAmount` is the exact credit. Response `debitAmount` is the sender’s cost in their asset.

Steps: same order as fixed-debit remittance, except step 5 sends `receiveAmount` instead of `debitAmount`, and step 6 limits `receiveAmount`. Incoming payment is open (`walletAddress` only). Outgoing payment is `quoteId` only. This quote type auto-completes the incoming payment when the outgoing payment completes.

## Outgoing grant for future payments

Source: `guides/outgoing-grant-future-payments`. Use when the payer consents before any recipient is known (Web Monetization / pay-as-you-browse). Example: up to $100 CAD per month for three months. Do not use this when the receiver URL is already known.

Grants: one interactive `outgoing-payment` on the user auth server. `actions: ["read", "create"]` (request order in the snippet). `identifier` = user wallet URL. `client` = user wallet URL. `limits.interval` = `R3/2025-05-20T13:00:00Z/P1M`. `limits.debitAmount` = `{ assetCode: "CAD", assetScale: 2, value: "10000" }`. No receiver limit. No quote grant and no incoming-payment grant in this guide.

Quote: none in this guide.

Steps:

1. `GET` the user’s wallet address (example CAD, scale 2).
2. Interactive outgoing grant with interval and debit cap.
3. Start interaction.
4. Finish interaction.
5. Continuation with `interact_ref`. Final token `actions` in the example response are `["create", "read"]`.
6. Optional: `GET` spent amounts for the current outgoing-payment grant (current interval only). Response fields: `spentReceiveAmount`, `spentDebitAmount`.

Creating later payments to a discovered receiver is out of this guide’s steps. Concepts say an outgoing payment without `quoteId` uses `incomingPayment` plus `debitAmount`.

## Recurring remittance, fixed debit

Source: `guides/recurring-remittance-fixed-debit`. Use when the sender pays a fixed debit on a schedule (example $200 USD each month for 3 months) and the receive amount may move with FX. The sender approves once.

Grants:

- Recipient: `incoming-payment`, `actions: ["create"]`.
- Sender, interactive, approved once: `outgoing-payment`, `actions: ["create"]`, `limits.interval` = `R3/2025-10-03T23:25:00Z/P1M`, `limits.debitAmount` = `{ assetCode: "USD", assetScale: 2, value: "20000" }`. Cap is the max debit per window and resets next window.

Quote: none. This guide does not create a quote.

Steps:

1. `GET` sender (USD) and recipient (MXN) wallets.
2. Incoming-payment grant on the recipient auth server.
3. Open incoming payment: `walletAddress` only.
4. Interactive outgoing grant with interval and `debitAmount`.
5. Start interaction.
6. Finish interaction.
7. Continuation with `interact_ref`.
8. Create outgoing payment with `walletAddress` = sender id, `incomingPayment` = incoming payment URL, `debitAmount` = `{ assetCode: "USD", assetScale: 2, value: "20000" }`. Do not send `quoteId`.

Next month, create a new incoming payment (step 3) and a new outgoing payment (step 8) with the existing tokens. Do not request new grants while they remain valid. Rotate the token if it expired.

## Recurring remittance, fixed receive

Source: `guides/recurring-remittance-fixed-receive`. Use when each cycle must deliver a fixed receive amount (example $4,000 MXN = `"400000"` monthly for 3 months). Approve the outgoing grant once, before creating the incoming payment.

Grants:

- Sender, interactive, first: `outgoing-payment`, `actions: ["create"]`, `limits.interval` = `R3/2025-10-03T23:25:00Z/P1M`, `limits.receiveAmount` = `{ assetCode: "MXN", assetScale: 2, value: "400000" }`. Cap is max receive per window.
- Recipient, after continuation: `incoming-payment`, `actions: ["create"]`.
- Sender: `quote`, `actions: ["create"]`.

Quote: fixed-receive. `receiveAmount` `{ value: "400000", assetCode: "MXN", assetScale: 2 }`. Response `debitAmount` is the converted sender cost.

Steps:

1. `GET` both wallets.
2. Interactive outgoing grant (interval + `receiveAmount`).
3. Start interaction.
4. Finish interaction.
5. Continuation with `interact_ref`.
6. Incoming-payment grant on the recipient auth server.
7. Open incoming payment (`walletAddress` only).
8. Quote grant on the sender auth server.
9. Create quote: `method: "ilp"`, `walletAddress`, `receiver`, `receiveAmount`.
10. Create outgoing payment with `quoteId`.

Next interval: new incoming payment, new quote, new outgoing payment. Reuse grants. Rotate tokens if expired.

## Recurring subscription, fixed incoming amount

Source: `guides/recurring-subscription-incoming-amount`. Use when the payee must receive a fixed fee each period and the payer authorizes the series once (example streaming: $15 USD = `"1500"` monthly for 12 months). Both sides are the same asset in the example, so debit and receive match aside from fees.

Grants:

- Service provider: `incoming-payment`, `actions: ["create"]`.
- Customer: `quote`, `actions: ["create"]`.
- Customer, interactive: `outgoing-payment`, `actions: ["create", "read"]`, `limits.debitAmount` = `{ assetCode: "USD", assetScale: 2, value: "1500" }`, `limits.interval` = `R12/2025-10-14T00:03:00Z/P1M`.

Quote: incoming-amount quote (`method: "ilp"`, `walletAddress`, `receiver` only). `receiveAmount` on the response equals `incomingAmount`.

Steps:

1. `GET` customer and service-provider wallets.
2. Incoming-payment grant on the provider auth server.
3. Create incoming payment with `incomingAmount` `{ value: "1500", assetCode: "USD", assetScale: 2 }`.
4. Quote grant on the customer auth server.
5. Create quote from that incoming payment. Honor `expiresAt`.
6. Interactive outgoing grant (debit cap + interval).
7. Start interaction.
8. Finish interaction.
9. Continuation with `interact_ref`.
10. Create outgoing payment with `quoteId`.

Next month: new incoming payment, new quote, new outgoing payment. Reuse grants. Rotate tokens if expired.

## Split payments

Source: `guides/split-payments`. Use when one payer action must credit two or more parties directly (marketplace: merchant 99%, platform 1% of $100 USD). Do not collect the full amount on one wallet and forward it. Open Payments only issues instructions; it does not move money.

Grants:

- Two incoming-payment grants, one per payee auth server (merchant and platform), each `incoming-payment` / `actions: ["create"]`. A single incoming grant can cover multiple accounts only when they share one ASE.
- One quote grant on the customer auth server: `quote` / `actions: ["create"]`. Reuse that token for both quotes.
- One interactive outgoing grant: `outgoing-payment` / `actions: ["create"]`, `limits.debitAmount` = sum of the two quote debit values. The snippet sets `value: "10000"` (`"9900"` + `"100"`) with `assetCode: "USD"`, `assetScale: 2`. Example response also shows a `limits.receiver` set to one incoming-payment URL; the request snippet limits only `debitAmount`.

Quote: two incoming-amount quotes, same customer token. Each body is `method: "ilp"`, customer `walletAddress`, and that payee’s incoming payment `id`. No debit or receive on the request. Each response has its own `id`, `debitAmount`, and `receiveAmount` (`receiveAmount` equals that incoming payment’s `incomingAmount`).

Steps:

1. `GET` customer, merchant, and platform wallets.
2. Request both incoming-payment grants.
3. Create two incoming payments: merchant `incomingAmount` `{ value: "9900", assetCode: "USD", assetScale: 2 }`, platform `{ value: "100", assetCode: "USD", assetScale: 2 }`.
4. Quote grant on the customer auth server.
5. Create both quotes with the same quote token.
6. Interactive outgoing grant for the combined debit.
7. Start interaction.
8. Finish interaction.
9. Continuation with `interact_ref`.
10. Create two outgoing payments, each with its own `quoteId`. The guide text says to use the access token associated with each quote; both quotes were created with one quote grant. Send each payment with the outgoing-payment token from continuation. Do not add amounts when `quoteId` is set.

## Verify wallet address ownership

Source: `guides/verify-wallet-address-ownership`. Use to prove a user controls a wallet address (signup on a payout platform) without creating a payment. Do not request `incoming-payment` or `outgoing-payment` access for this.

Grants: subject-only interactive grant. No `access` array. Body: `subject.sub_ids: [{ id: walletAddressUrl, format: "uri" }]`, `client` = that same wallet URL, `interact` redirect as usual. The IdP checks that the user can access the wallet in `subject`.

Quote: none.

Steps:

1. `GET` the claimed wallet address (example `https://cloudninebank.example.com/user`).
2. `POST` the subject grant to that wallet’s `authServer`.
3. Start interaction.
4. Finish interaction.
5. Continuation to `continue.uri` with `interact_ref`.

Treat a successful continuation that returns `access_token` as proof of control. The example token has `value` and `manage` only, no payment `access` list.

## Pick a pattern

| Hackathon idea | Guide |
| --- | --- |
| P2P, sender fixes what they pay | One-time remittance, fixed debit |
| P2P, recipient must get an exact amount | One-time remittance, fixed receive |
| Checkout, one merchant, known price | Accept a one-time online purchase |
| Subscription, fixed fee each period | Recurring subscription, fixed incoming amount |
| Remittance, one-shot | Fixed debit or fixed receive, one-time |
| Remittance, repeating, sender budget fixed | Recurring remittance, fixed debit |
| Remittance, repeating, recipient amount fixed | Recurring remittance, fixed receive |
| Donations / tips, recipient known, amount chosen at pay time | One-time fixed debit if the donor fixes the send; one-time online purchase if the page fixes `incomingAmount`. A donation jar with no amount uses an open incoming payment plus a fixed-send or fixed-receive quote |
| Micropayments before the receiver is known (browse-to-pay) | Outgoing grant for future payments, then pay into an open incoming payment with `debitAmount` |
| Marketplace split (merchant plus fee) | Split payments. Repeat the incoming, quote, and outgoing pair per extra payee |
