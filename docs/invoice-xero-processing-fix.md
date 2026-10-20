# Invoices stuck in `processing` — root cause and fix design

Status: proposal (2026-10-20). No code is changed yet.

## 1. Summary

- 28 invoices are stuck in `processing` (17 MYR, 11 SGD), from 2026-09-06 to 2026-10-19.
- The Xero rate limit is **not** the main cause. Bulk runs of 25 invoices often finish with no stuck invoices.
- The main cause is in our code. Both workers have paths that end **without** a final status. They do not set `approved` or `failed`, and they do not log a useful reason.
- Some of these paths create the bill in Xero **before** we save the link. If someone approves those invoices again, Xero gets **duplicate bills**.

## 2. Evidence from production

| Group | Invoices | What the data shows | Cause |
|---|---|---|---|
| A. SGD | 11 | All bulk runs were done by one admin (Tinissha). In 60 days, no SGD invoice got through bulk approve. The only SGD success (INV-2943) was a single approve by Super Admin. | The bulk worker skips the invoice with no log when the admin's Xero connection has no SGD organisation (`worker.ts:336`). This is likely; it is confirmed when the admin's API page is checked. |
| B. MYR 22 Sep | 13 | One job of 25 invoices. It approved 8 invoices between 06:54:29 and 06:54:48. Then nothing happened for 39 s, then the job logged "Completed". 13 invoices have the same `updatedAt` and no `xeroInvoiceId`. | One error after `createInvoices` stopped the results loop (`worker.ts:415-523`). The Xero bills probably exist, but they are not linked to our invoices. |
| C. MYR single | 3 (INV-9363, 7340, 9770) | No bulk run at those times, so they used the single-approve path. | Not confirmed. Possible causes: an HTTP call that hangs (no timeout), a job dropped because of a duplicate `jobId`, or `contactID` is null. |
| D. MYR data | 1 (INV-6269) | `pay_to` is a bank number. | The contact lookup or contact creation failed in the bulk preparation step (`worker.ts:402`). |

"Zero `failed` invoices" does not mean "zero failures". The bulk UI lets an admin approve `failed` invoices again (`invoices-list.jsx:898`), and then they go back to `processing`.

## 3. What Xero's docs say (checked against the official docs)

| Topic | Fact | Effect on our design |
|---|---|---|
| Rate limits | 5 calls at the same time, 60 calls/min per organisation, 1,000/day (starter app tier) or 5,000/day, 10,000/min across the whole app. A 429 response has `Retry-After` and `X-Rate-Limit-Problem` headers. | Throttle per organisation. Wait for `Retry-After`. A 429 is always safe to retry. |
| Idempotency | `Idempotency-Key` works on POST/PUT/PATCH. Xero keeps keys for **6 minutes**. Maximum length is 128 characters. A replay returns the saved response. The same key with a different body returns 400. `xero-node` 9.3.0 supports the key on `createInvoices`, `createContacts` and attachments. | Protects quick retries only. For later retries we must also look up the bill first. |
| `summarizeErrors=false` | HTTP 200, with a status on each item (OK, WARNING or ERROR). The docs do **not** say the results come back in the same order as the request. | Do not match results by array position (`worker.ts:415-417`). |
| Batch size | Up to 50 items per request is recommended. | We do not split batches today. |
| Bill `InvoiceNumber` | It is **not unique** for ACCPAY. Xero does not stop a duplicate bill. You can search bills with `InvoiceNumbers=` and `createdByMyApp=true`. | We must prevent duplicates ourselves. Today the number is `"{client} {campaign}"`, which many creators share. |
| Tokens | Access tokens last 30 min, refresh tokens last 60 days. Every refresh **rotates** the refresh token. The old one still works for 30 min. | Only one refresh may run at a time. Save the new token immediately. |
| Connections | The `/connections` list contains only the organisations the user selected on the consent screen. `updateTenants()` makes 1 call plus 1 more call per organisation. | Cache the organisation list. Treat "organisation missing" as a clear error. |
| Contacts | A contact name must be unique. `searchTerm` searches name and email. | On a "name already exists" error, look up the existing contact. Do not fail the invoice. |
| Plan limit | The "Early/Starter" plan allows only 5 approved bills per month. Going over gives a 400 validation error. | Classify this as a final error that needs a person to act. |
| Attachments | Up to 10 files per document, 10 MB each. Uploading a file with the same name replaces the old one. | A failed attachment upload must never undo the bill. |

## 4. Code review findings (checked against the source)

These are ordered by how much damage they do.

1. **One error stops the rest of the bulk batch, after the bills exist.** `sendToSpreadSheet` (`worker.ts:472`) and the creator `saveNotification` (`:512`) have no error handling of their own. The catch at `:521` covers the whole loop, so the invoices after the error stay `processing` while their Xero bills already exist. **Duplicate risk on re-approve.**
2. **Silent skips in bulk preparation.** These end with no status change and a log that says `undefined`: an organisation that is missing (`:336`), and any error in contact lookup or contact creation (`:402`).
3. **A job-level error in bulk leaves every invoice in the job stuck.** The bulk worker has no `failed` handler (`:542` only logs). Also, `latestToken.expires_at` (`:280`) throws when `latestToken` is null.
4. **Saving an already-approved invoice creates a second bill.** The edit form keeps `status: 'approved'` (`invoice-new-edit-form.jsx:174`). The controller then queues a new job without checking the old status or `xeroInvoiceId` (`invoiceController.ts:1385`). The worker writes the new bill ID over the old one (`worker.ts:160`).
5. **The bulk guard "skip approved/paid" never works.** `updateMany` sets `processing` on every ID it receives (`invoiceController.ts:2108`) before the worker checks the status (`worker.ts:322`).
6. **The single worker's `failed` handler writes `failed` after the bill exists.** Any error after `worker.ts:160` (attachment, Sheets, notification) changes `approved` to `failed`, and `job.remove()` deletes the evidence (`:550-563`). **Duplicate risk on re-approve.**
7. **Single-path jobs can hang or be dropped.** There is no HTTP timeout (axios default). A duplicate `jobId` (`invoice-${id}`) makes BullMQ ignore the new job without an error. When `contactID` is null, the job completes but leaves the status unchanged (`worker.ts:145`).
8. **The controller's order of steps leaves bad states.** The single path writes `approved` first, and sets `processing` and queues the job only later (`invoiceController.ts:1181` and `:1386`). An error between those steps leaves `approved` with no bill. The bulk path sets `processing` before it saves the files and queues the job (`:2108-2140`).
9. **One shared `XeroClient` object for all concurrent jobs** (`config/xero.ts`). The single worker runs 10 jobs at the same time, plus the bulk worker, all in one process. One job can call Xero with another admin's token or organisation list. The webhook worker also runs inside each of the 3 API processes (`server.ts:20`).
10. **Token refresh is not coordinated.** Seven places write `xeroTokenSet`. `checkRefreshToken` refreshes on every call, because `dayjs(expires_at)` reads Unix seconds as milliseconds (`invoiceController.ts:1513`). `getprofile` refreshes and calls `updateTenants` on every finance page load.
11. **The single and bulk paths build different bills.** They use different contact lookup keys (`invoiceFrom.name` vs `payTo`). Bulk leaves out the reimbursement lines. The single path sends `accountID = accounts[0]`, which is an arbitrary account. `creator.xeroContactId` does not record which organisation it belongs to.
12. **Error logs lose the details.** `xero-node` rejects with a JSON string, so `err.message` is `undefined` (`worker.ts:403, 456, 522`).
13. **Frontend polling stops after 5 min with no message** (`invoices-list.jsx:989`). Each poll fetches up to 10,000 invoices.
14. **No 429 handling, no retries, no idempotency key, no batch splitting.**

## 5. Design goals (rules the new code must keep)

- **G1.** Each job ends in `approved` or `failed`. `failed` always has a reason that people can read.
- **G2.** An invoice cannot stay in `processing` for more than 30 minutes without a live job. A check that runs on a timer (the reaper) puts it back in the queue.
- **G3.** At most **one** Xero bill per invoice, even after any number of retries, crashes or re-approves.
- **G4.** The link (`xeroInvoiceId`) is saved **before** any side effect (attachment, Sheets, notifications). A failed side effect never changes the invoice status.

## 6. Data shape

### Schema (Prisma migration)

```prisma
model Invoice {
  // existing fields …
  xeroBillNumber  String?   @unique // exact InvoiceNumber sent to Xero; set once, before the first attempt
  xeroTenantId    String?
  xeroError       String?           // last error, shown in the UI on `failed`
  xeroAttemptedAt DateTime?         // start of the current attempt (used by the reaper)
}

model CreatorXeroContact {          // replaces Creator.xeroContactId, which does not record the organisation
  id        String @id @default(cuid())
  creatorId String
  tenantId  String
  contactId String
  @@unique([creatorId, tenantId])
}

model Admin {
  // existing fields …
  xeroTenants Json? // [{ tenantId, tenantName, baseCurrency }]; saved on connect, used by workers and the API page
}
```

### Invoice states

```
draft/pending/failed ──approve──▶ processing ──worker──▶ approved ──webhook──▶ paid
                                     │
                                     └─(final error)──▶ failed (+ xeroError)
```

- Only `draft`, `pending` and `failed` with `xeroInvoiceId IS NULL` can move to `processing`. Use a guarded `updateMany` that returns the count of rows it changed.
- An invoice in `approved` or `paid`, or with a `xeroInvoiceId`, is never queued again.

### Bill number

`xeroBillNumber = "{client} {campaign} ({invoiceNumber})"`. For example: `Brand X Eat Better, Change Smarter (INV-2324)`.

- Finance still sees the client and campaign in Xero. For bills, `InvoiceNumber` shows as "Reference" in Xero.
- It is unique because our `invoiceNumber` is unique.
- We save it **before** the first call to Xero. A later lookup searches for the exact saved text, so it still works if someone renames the campaign.

## 7. New flow

### One queue, one job per invoice

Both single and bulk approve put **one job per invoice** on `xero-bill-queue`, with `jobId = bill-${invoiceId}`. Use the existing `enqueueExtraction` pattern (`utils/queue.ts`): remove an old finished job before adding a new one, so a re-queue is never ignored without an error.

- Worker: `concurrency: 2`, BullMQ `limiter: { max: 20, duration: 60_000 }`. Each invoice needs about 2–3 Xero calls, so the total stays under 60 calls/min.
- Job options: `attempts: 6`, exponential `backoff` starting at 30 s.
- Throughput: about 20 invoices/min, so 100 invoices take about 5 minutes. The bulk UI shows progress.

### Worker steps (`processXeroBill(invoiceId)`)

1. **Read the invoice again from the DB.** If `status !== 'processing'` or `xeroInvoiceId` is set, stop. This makes the job safe to run more than once.
2. Set `xeroAttemptedAt = now()`.
3. **Get the admin's client** from `getXeroClientForAdmin(adminId)`:
   - It makes a **new** `XeroClient` for each job. Never use the shared singleton.
   - Refresh only inside a Redis lock `xero:refresh:{adminId}`. After it gets the lock, it reads the token again, refreshes only if the token is still expired, and saves the new token before any API call.
4. **Find the organisation** by currency in `Admin.xeroTenants`. If it is missing → final error: *"Your Xero connection has no SGD organisation. Reconnect Xero and select Cult Creative Pte Ltd."*
5. **Find the contact:** first `CreatorXeroContact`, then `searchTerm` (name or email), then create it with an idempotency key. If Xero says the name already exists, look up that contact. Save the contact ID for that organisation.
6. **Look for an existing bill:** `getInvoices(tenant, …, invoiceNumbers=[xeroBillNumber], …, createdByMyApp=true)`, and ignore DELETED and VOIDED bills. If one exists → link it and go to step 8.
7. **Create the bill:** one invoice per call, with `idempotencyKey = bill-${invoiceId}-${hash(body)}` (128 characters or less), built by the one shared builder in §8.
8. **Commit point:** one `prisma.invoice.update` sets `status: 'approved'`, `xeroInvoiceId`, `xeroTenantId` and `xeroError: null`. It runs only `where status = 'processing' AND xeroInvoiceId IS NULL`.
9. **Side effects after the commit.** Each one runs as its own small job with its own retries: attachment upload, Sheets row, campaign log, notifications. Their errors are logged and never touch the invoice status.

### Error types (`classifyXeroError(err)`)

| Error | What the code does |
|---|---|
| 429 | Retry after `Retry-After`: call `worker.rateLimit(ms)` and throw `Worker.RateLimitError()`, which pauses the queue. |
| Timeout, network error, 5xx | Throw, so BullMQ retries. This is safe because step 6 looks for the bill before step 7 creates it. |
| 401 / `invalid_grant` | Final `failed`: "Xero connection expired — reconnect Xero". |
| 400 validation (plan limit, bad account code, contact rules) | Final `failed` with Xero's own validation text. |
| Organisation missing | Final `failed` with the message from step 4. |

A final error, or the last attempt, runs a **guarded** update: set `failed` + `xeroError` only `where status='processing' AND xeroInvoiceId IS NULL`. Never write `failed` over an invoice that already has a bill.

`classifyXeroError` must read the JSON-string errors that `xero-node` returns: the status code, the `X-Rate-Limit-Problem` header and the validation messages.

### Timeouts

In the worker entry point, set `axios.defaults.timeout = 30_000`. `xero-node` uses the default axios instance. Also give the Google Sheets calls a timeout.

### Reaper (cron, every 10 min)

- It finds invoices that are `processing`, with `xeroAttemptedAt` (or `updatedAt`) older than 30 minutes and no waiting or active job, and queues them again.
- Queueing again is safe because of step 6.
- If an invoice gets queued again 3 times, the reaper sends an alert to finance.

## 8. One bill builder for both paths

`buildXeroBill(invoice, tenant, contactId)` is the single source of the bill:

- Lines: the fee line plus one line per reimbursement. `REIMBURSEMENT` invoices have reimbursement lines only.
- `accountCode` comes from a map per organisation (MYR → `50930`, SGD → **to confirm with finance**). No `accountID`.
- `invoiceNumber = xeroBillNumber`, `dueDate`, `status: 'AUTHORISED'`.

## 9. Controller and frontend changes

**`updateInvoice`:**
- Approve only when the invoice moves **into** `approved` from `draft`, `pending` or `failed`, and `xeroInvoiceId IS NULL`.
- Write `processing` (never `approved`) in the transaction, then queue the job.
- If the queue call fails, set the status back.
- Editing an approved invoice must not queue anything.

**`bulkUpdateInvoices`:**
1. Save the PDFs in durable storage (GCS), not the API's local disk.
2. Run the guarded `updateMany` (allowed statuses only).
3. Call `addBulk` with one job per invoice.
4. Return a list: queued and skipped, each with a reason.

**`checkRefreshToken`:** use `dayjs.unix(expires_at)`. Move all refresh logic into `getXeroClientForAdmin`.

**`getprofile`:** read `Admin.xeroTenants` and stop refreshing on every page load.

**Frontend:**
- Re-approve only `failed`, not `processing`.
- Show `xeroError` on failed rows.
- Poll a small status endpoint for the selected IDs only.
- When polling ends, show "still processing" instead of stopping with no message.

## 10. Rollout

**Phase 0 — operations (now, no code change)**
- Tinissha reconnects Xero and selects **both** organisations. Then she approves the 11 SGD invoices again.
- Groups B, C and D: find the matching bills in Xero. Link found bills with a guarded SQL update. Approve again only the invoices with **no** bill.

**Phase 1 — stop the damage (small PR to `worker.ts` and `invoiceController.ts`)**
- Per-invoice try/catch that writes `failed` + reason.
- Commit `approved` + `xeroInvoiceId` for all results right after `createInvoices`, and match results by `invoiceNumber` (not by position).
- Side effects in their own try/catch.
- A bulk `failed` handler.
- Guarded `updateMany`. No re-queue when `xeroInvoiceId` is set.
- Error parsing for the JSON-string errors.
- `axios.defaults.timeout`.
- The `checkRefreshToken` Unix-time fix.
- A log of the organisation list at the start of each bulk job.

**Phase 2 — make it impossible**
- Schema migration.
- `xero-bill-queue` and `processXeroBill`.
- Token service with a lock.
- Organisation and contact caches.
- 429 handling.
- Reaper.
- Frontend changes.

**Phase 3 — tests**
- Jest tests with a mocked `XeroClient`: 429 then success, timeout after create (no duplicate), organisation missing, Sheets error after commit, re-approve of an approved invoice.

**One-off backlog script (optional, dry run first)**
- For each stuck MYR invoice, search the bills in the MY organisation by contact + `"{client} {campaign}"` + amount + date.
- Print the matches so a person can review them before anything is linked.

## 11. Open questions

1. Account code for the SGD organisation (the bulk path always sends `50930`).
2. Who on the team uses the "Invoices" Google Sheet? If it must not miss rows, its job needs alerts.
3. Our Xero app tier (1,000 vs 5,000 calls/day).
4. Do the 3 single-path jobs still exist in Redis? Run `LRANGE bull:invoice-queue:active 0 -1` and `ZRANGE bull:invoice-queue:failed 0 -1`.

## Sources

- Xero rate and plan limits: https://developer.xero.com/documentation/guides/oauth2/limits/ , https://developer.xero.com/faq/limits
- Idempotency: https://developer.xero.com/documentation/guides/idempotent-requests/idempotency/
- Requests and responses (`summarizeErrors`): https://developer.xero.com/documentation/api/accounting/requests-and-responses
- Response codes: https://developer.xero.com/documentation/api/accounting/responsecodes
- Invoices (ACCPAY `InvoiceNumber`, filters): https://developer.xero.com/documentation/api/accounting/invoices
- Contacts: https://developer.xero.com/documentation/api/accounting/contacts
- Attachments: https://developer.xero.com/documentation/api/accounting/attachments
- Tokens: https://developer.xero.com/documentation/guides/oauth2/token-types , https://developer.xero.com/faq/oauth2
- Tenants and connections: https://developer.xero.com/documentation/guides/oauth2/tenants
- Webhooks: https://developer.xero.com/documentation/guides/webhooks/overview
- xero-node source: https://github.com/XeroAPI/xero-node (installed version 9.3.0)
