# Connecting 1C to Spot

1C configurations differ from one restaurant to the next, so Spot doesn't
guess each one's API. It speaks one small JSON format — the **Spot exchange
format, version 1** — and the 1C side implements it once. There are two ways
to connect a location; pick the one that fits where 1C runs.

| Mode         | Spot provider | Who calls whom | Use when                                           |
| ------------ | ------------- | -------------- | -------------------------------------------------- |
| Exchange     | `1c-exchange` | 1C calls Spot  | 1C runs on an office computer or behind a router   |
| HTTP service | `1c`          | Spot calls 1C  | 1C publishes an HTTP service on a public https URL |

Either way, Spot keeps working on its own: if 1C is offline, guests still
order and staff still work in the dashboard. Changes wait and are delivered
in order once 1C is back.

General rules:

- JSON, UTF-8. Amounts are **integer minor units** (1 AMD = 100), so
  3 500 ֏ is `350000`. Times are ISO 8601 in UTC.
- Ids starting with Spot's are UUIDs; `externalId` values are 1C's own codes
  (up to 100 characters).
- Every change has a `changeId`. 1C may receive the same change more than
  once (a lost answer, a retry): **apply each `changeId` only once** and
  answer the same way again.

## Change documents

Spot sends three kinds of change, oldest first.

```json
{
  "changeId": "…",
  "type": "order.created",
  "order": {
    "id": "spot order uuid",
    "number": 42,
    "table": { "number": "3", "externalId": "T3" },
    "currency": "AMD",
    "totalMinor": 1000000,
    "note": "Birthday!",
    "submittedAt": "2030-01-18T08:00:00.000Z",
    "lines": [
      {
        "externalItemId": "00001",
        "name": "Pizza",
        "quantity": 2,
        "unitPriceMinor": 350000,
        "lineTotalMinor": 800000,
        "options": ["Large"],
        "note": "well done"
      }
    ]
  }
}
```

`externalItemId` / `table.externalId` are 1C's codes when the dish or table is
linked (see _Catalog_), otherwise `null` — use `name` / `number` then.

```json
{
  "changeId": "…",
  "type": "order.status",
  "orderId": "spot order uuid",
  "externalOrderId": "DOC-17",
  "status": "accepted",
  "reason": null
}
```

Statuses: `received`, `accepted`, `preparing`, `ready`, `served`,
`completed`, `cancelled`, `rejected` (`reason` is set for the last two).
`externalOrderId` is 1C's id for the order if 1C returned one, else `null`.

```json
{
  "changeId": "…",
  "type": "bill.closed",
  "billId": "…",
  "orderIds": ["…"],
  "externalOrderIds": ["DOC-17"],
  "currency": "AMD",
  "totalMinor": 1100000,
  "serviceFeeMinor": 100000,
  "paidMinor": 1100000
}
```

Sent when the bill is fully paid on Spot (online, cash or card terminal).

### Answering a change

```json
{ "ok": true, "externalId": "DOC-17" }
{ "ok": false, "error": "Base is locked by another user", "retry": true }
{ "ok": false, "error": "Unknown table 12" }
```

- `externalId` (optional, for `order.created`): 1C's id for the order. Spot
  sends it back in later changes for that order.
- `retry: true`: a temporary problem; Spot sends the change again after 1, 5,
  30 minutes, 2 hours and 6 hours, then gives up.
- `retry` false or missing: it will never work. Spot marks it failed and moves
  on; the restaurant sees it and can send failed changes again.

## Catalog and stock

```json
{
  "items": [{ "externalId": "00001", "name": "Pizza", "priceMinor": 350000, "category": "Food" }],
  "tables": [{ "externalId": "T3", "number": "3" }]
}
```

```json
{ "stock": [{ "externalId": "00001", "available": 0 }] }
```

Spot links dishes by name and tables by number (ignoring case and extra
spaces; names that appear twice on either side stay unlinked). For linked
dishes, `available: 0` marks the dish sold out on Spot and anything above 0
makes it orderable again. Dishes missing from the stock list are left alone.

## Mode 1: Exchange (1C calls Spot)

When the restaurant connects a location with **1C exchange**, Spot shows an
exchange token once. 1C sends it on every request:

```
Authorization: Bearer <token>
```

| Request                                | Body                                         | Answer                                  |
| -------------------------------------- | -------------------------------------------- | --------------------------------------- |
| `GET  /api/pos/1c/v1/changes?limit=50` | —                                            | `{ "data": { "changes": [ … ] } }`      |
| `POST /api/pos/1c/v1/changes/ack`      | `{ "results": [ { "changeId", …answer } ] }` | `{ "data": { "accepted", "ignored" } }` |
| `PUT  /api/pos/1c/v1/catalog`          | catalog                                      | `{ "data": { "items", "tables" } }`     |
| `PUT  /api/pos/1c/v1/stock`            | stock                                        | `{ "data": { "changed" } }`             |

A typical schedule (1C routine task, every 30–60 seconds):

1. `GET changes`, apply them in the order given, then `POST changes/ack`
   with one result per change (up to 200).
2. Every few minutes, `PUT stock`; after menu edits, `PUT catalog`.

Changes stay in the list until acknowledged. After `retry: true` the list
pauses at that change until its retry time, so status changes never overtake
their order. Limits: 300 requests a minute, 2 MB per body. Errors come back as
`{ "data": null, "error": { "code", "message" } }` with status 401 (bad
token), 422 (bad body) or 429 (slow down).

## Mode 2: HTTP service (Spot calls 1C)

Publish an HTTP service on the 1C web server, reachable on the internet over
**https** (Spot refuses http and private addresses), with three methods
under one base URL, e.g. `https://1c.example.am/cafe/hs/spot`:

| Request                  | Body       | Answer                 |
| ------------------------ | ---------- | ---------------------- |
| `GET  {base}/v1/catalog` | —          | catalog                |
| `GET  {base}/v1/stock`   | —          | stock                  |
| `POST {base}/v1/changes` | one change | one answer (see above) |

Spot authenticates with HTTP Basic (the 1C user name and password the
restaurant enters; the password is stored encrypted) and sends
`X-Spot-Exchange-Version: 1`. It doesn't follow redirects and waits up to
15 seconds. Status 401/403 or other 4xx stop the change (it's marked failed);
408, 429 and 5xx are retried like `retry: true`.
