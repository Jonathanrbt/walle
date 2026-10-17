# Open Payments troubleshooting (docs only)

HTTP status codes below are marked UNVERIFIED when the English guides and concept pages describe the failure but do not name the status.

## Signatures and keys

**`Could not load private key when creating authenticated client` / `Key is not a valid path or file` (VERIFIED):** the PEM reached the SDK broken. Most common cause: a multi-line key in `.env` without quotes, so the env loader keeps only `-----BEGIN PRIVATE KEY-----`. Fix: wrap the whole PEM in double quotes in `.env`, or store the file path instead (`PRIVATE_KEY_PATH=secrets/private.key`), or normalize it in code (restore real newlines from `\n`-escaped or space-flattened PEM before passing it to the SDK).


Every client request is signed with Ed25519 (`alg: EdDSA`, `kty: OKP`, `crv: Ed25519`). The private key stays on the client. Public `kid` and `x` are published at `{walletAddress}/jwks.json`. Requests carry `Signature-Input` (includes `keyid`) and `Signature`. Open Payments does not use bearer tokens. The access token is bound to that key.

The auth server loads the JWKS when `client` is a wallet address, finds the public key for the `keyId` in `Signature-Input`, and checks the signature. A mismatch (unknown `kid`, wrong key pair, or a signature over different bytes than the server rebuilds) fails verification. The guides do not print a `401` body. Calling `401` the status for a bad signature is UNVERIFIED in these pages.

Directed identity (`client` as an inline `jwk`, `proof: "httpsig"`) is only for non-interactive grants (`incoming-payment`, `quote`). Do not use it on interactive outgoing grants. How an ASE registers keys is out of scope. The testnet key-pair walkthrough is linked from `identity/client-keys` (`sdk/before-you-begin`), not from the use-case guides.

Wrong `keyId`: the server looks up `kid` in the JWKS. A `keyId` that is not that `kid`, or a private key that does not match the published `x`, fails the same verification step. Exact error payload: UNVERIFIED.

## Grant pending or interaction not finished

An outgoing grant returns `interact` and `continue`, not the payment `access_token`. Snippets throw `Expected pending/interactive grant` when the response is not pending. Creating an outgoing payment with the continuation token, or calling continuation before the user finishes, is the wrong token and the wrong time.

Fix: send the user to `interact.redirect`. On return, `POST` continuation to `continue.uri` with the continuation access token and the `interact_ref` query value. `continue.wait` in examples is `30` (seconds). If there is no browser, poll until interaction has completed, then continue. Only the continuation response’s `access_token.value` may create outgoing payments.

Incoming and quote grants are non-interactive and return `access_token` immediately. Do not run the redirect flow for those unless the request included an action that requires interaction (`list-all` should force interaction; that action is not used in these guides).

## Grant or token expired

Recurring and one-time guides say: if the access token expired, `POST` the Rotate Access Token API and retry with the new token. The new token keeps the same rights. They do not tell you to request a new grant while the grant is still inside its interval and limits.

A distinct “grant expired” error, separate from access-token expiry, is UNVERIFIED. Interval end means the debit or receive cap no longer applies to a new window; the documented fix for a later cycle is to create new resources under the same grant, not to rotate because the window ended.

## Quote expired (`expiresAt`)

Quote responses include `expiresAt` (example timestamp `2025-03-12T23:24:51.50Z` in the fixed-debit guide). Create the outgoing payment before that time. If creation fails because the quote expired, create a new quote and retry. Quotes are valid only for a limited time. `GET` quote can show whether it is still valid. The HTTP status and error code for using an expired quote are UNVERIFIED.

## Limits exceeded

`limits.debitAmount` or `limits.receiveAmount` is a maximum. With `interval`, it is the maximum per window and resets when the next window starts. Unspent value does not roll over. The future-payments guide reads `spentDebitAmount` and `spentReceiveAmount` for the current window.

What the API returns when a new outgoing payment would pass that cap is UNVERIFIED (no status or error string in the guides).

## Amount format

Send `value` as a string of minor units, plus `assetCode` and `assetScale`. Do not send a decimal or a float. `$100.00` USD at scale 2 is `"10000"`. JPY scale 0: `¥1000` is `"1000"`. JOD scale 3: 1.000 is `"1000"`. Scale is an integer from 0 to 255. Take scale and code from the wallet address that owns that side of the payment (sender for debit, recipient for receive). A numeric `value` or a major-unit decimal is not the documented shape. The error body for a bad amount is UNVERIFIED.

## Currency mismatch

Fixed-send quotes put `debitAmount.assetCode` / `assetScale` on the sender wallet. Fixed-receive quotes put `receiveAmount` on the recipient asset (MXN `"500000"` or `"400000"` while the sender wallet is USD). Incoming-amount quotes omit both and let the quote compute debit versus receive, including fees. The online-purchase outgoing grant snippet sets `limits.debitAmount` in MXN while the customer wallet is USD. That is what the snippet contains.

An API error named “currency mismatch” is UNVERIFIED.

## Incoming payment completed or expired

`completed: false` and `receivedAmount.value: "0"` are the new-resource examples. With `incomingAmount`, the total received cannot exceed that maximum, and the incoming payment completes when the outgoing payment completes (incoming-amount quote and fixed-receive quote). An open incoming payment (no `incomingAmount`) does not auto-complete for a fixed-send quote. Call complete on an unexpired incoming payment to stop further payments, or the session expires. Complete means no further payments toward that resource. Paying an already completed or expired incoming payment: the failure status is UNVERIFIED. Create allows an optional `expiresAt` (SDK examples use about 10 or 59 minutes). The guides’ incoming-payment creates usually omit it.

## Idempotency

`Idempotency` does not appear in `llms-full.txt` or the English guide and concept pages searched. Retry keys, duplicate POST behavior, and a required idempotency header are UNVERIFIED.

## Outgoing payment shows `sentAmount: "0"` (VERIFIED)

Normal right after `create`: payments settle asynchronously. Poll `outgoingPayment.get` every ~1.5 s until `sentAmount.value === debitAmount.value` or `failed: true`.

## Grant limit lower than the quote

Testnet fees can double a small payment (1.00 EUR received cost 2.00 EUR). Set `limits.debitAmount` to `quote.debitAmount` (the whole object), not to the amount you want delivered.

## Sanity checklist before calling the API

1. Use the test wallet’s `authServer` and `resourceServer` from `GET` wallet address. Do not hard-code another host’s servers.
2. Sign with the Ed25519 private key whose `kid` is in that client wallet’s `jwks.json`. Set `Signature-Input` `keyid` to that `kid`.
3. Non-interactive grant: `client` is the wallet URL or, only then, a directed `jwk`. Interactive outgoing grant: `client` wallet URL where the snippet sets it, plus `interact.finish.nonce` and a real finish `uri`.
4. `identifier` on the access item is the wallet that will be debited or credited, not the other party.
5. `value` is a string. `assetScale` matches that wallet. Debit uses the sender asset. Receive and `incomingAmount` use the recipient asset.
6. Open incoming payment (no `incomingAmount`) requires the quote to include `debitAmount` or `receiveAmount`, except the recurring fixed-debit guide, which skips the quote and puts `debitAmount` on the outgoing payment.
7. If the incoming payment has `incomingAmount`, the quote is `method: "ilp"` plus `receiver` only.
8. Outgoing payment sends `quoteId` or (`incomingPayment` and `debitAmount`), not both amount styles at once.
9. For an interactive grant, continue only after `interact_ref` is present. Use the continuation `access_token` for `POST` outgoing payment.
10. Check quote `expiresAt` before creating the outgoing payment.
11. For a repeating grant, stay inside `debitAmount` or `receiveAmount` for the current window. On the next window, create new incoming, quote, and outgoing resources. Rotate the token only when it has expired.
12. Do not treat a subject-only verification grant as permission to pay. It has no payment `access` list.
