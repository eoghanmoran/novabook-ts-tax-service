# novabook-ts-tax-service

## Overview

A small HTTP service that records sales and tax payments as events and reports the **tax position** at any
point in time. The tax position is the total tax charged on sales minus the total tax already paid.

It has three business endpoints:

| Method  | Path            | What it does                                                                          |
| ------- | --------------- | ------------------------------------------------------------------------------------- |
| `POST`  | `/transactions` | Records a `SALES` event or a `TAX_PAYMENT` event                                      |
| `GET`   | `/tax-position` | Returns the tax position at a date, given as `?date=`                                 |
| `PATCH` | `/sale`         | Amends the cost and tax rate of one item in a sale (even before the sale has arrived) |

It also has two operational endpoints, `GET /health` and `GET /metrics` (see [Observability](#observability)).

**Tech stack:** plain TypeScript (strict mode) on the built-in Node.js `http` module, with **no web framework**.
[Zod](https://zod.dev) validates input, [SQLite](https://github.com/WiseLibs/better-sqlite3) (via `better-sqlite3`)
stores the data, and [Vitest](https://vitest.dev) runs the tests.

### How it is built

The code is split into layers. Each layer only calls the one below it:

```
Routes  ->  Services  ->  Domain (pure functions)
                \
                 ->  Storage (behind an interface)
```

| Folder               | Purpose                                                                           |
| -------------------- | --------------------------------------------------------------------------------- |
| `src/schemas/`       | Zod schemas. The TypeScript types are derived from them, never written by hand    |
| `src/domain/`        | Pure tax functions: tax per item, effective item values, tax position. No I/O     |
| `src/storage/`       | The `EventStore` interface and its SQLite implementation                          |
| `src/services/`      | Coordinates a request: checks rules, reads and writes the store, calls the domain |
| `src/routes/`        | HTTP handlers: read the request, validate it, call a service, send the reply      |
| `src/observability/` | Logging, the health check and metrics                                             |
| `src/common/`        | Shared error types                                                                |
| `src/index.ts`       | Entry point: settings, database, routing, request logging                         |

Two design choices are worth knowing about:

- **Append-only event store.** Events are only ever added, never changed or deleted. The tax position is not stored;
  it is calculated from the events each time it is asked for.
- **The domain layer is protected by a lint rule.** ESLint fails if anything in `src/domain/` imports from storage,
  routes, services, `node:http` or `better-sqlite3`, so the tax rules stay pure and easy to test.

## Getting Started

### Prerequisites

- **Node.js 22 or newer** (required by `better-sqlite3`; developed and tested on Node 24)
- npm (comes with Node.js)

### Install

```bash
npm install
```

### Configure

Copy the example settings file and edit it if you want different values:

```bash
cp .env.example .env
```

| Setting         | Default                 | Meaning                                                                         |
| --------------- | ----------------------- | ------------------------------------------------------------------------------- |
| `PORT`          | `3000`                  | The port the HTTP server listens on. A whole number from 1 to 65535             |
| `DATABASE_PATH` | `./data/tax-service.db` | Where the SQLite database file is kept. Use `:memory:` for a throwaway database |

Both are optional: with no `.env` file the defaults are used. A `.env` file is read from the folder you start the
service in, and real environment variables (for example `PORT=4000 npm run dev`) win over the file. If a setting is
invalid, the service logs the problem and exits with code 1. The database folder is created automatically.

### Start the service

```bash
npm run dev
```

This starts the service and restarts it when you change a file. You should see a log line like:

```json
{
  "level": "info",
  "time": 1793465401761,
  "message": "Tax service listening on port 3000",
  "port": 3000,
  "databasePath": "./data/tax-service.db"
}
```

To run the compiled version instead:

```bash
npm run build && npm start
```

Stop the service with `Ctrl+C`. It stops accepting new requests and closes the database cleanly.

## Running Tests

```bash
npm test             # everything: 69 tests
npm run test:unit    # unit tests only: 25 tests, under a second
npm run test:e2e     # end-to-end tests only: 44 tests, roughly 20 to 30 seconds
```

Other checks:

```bash
npm run typecheck    # TypeScript, strict mode
npm run lint         # ESLint, including the "domain must not import storage" rule
npm run format:check # Prettier
```

### Unit tests (`test/unit/`, 25 tests)

Fast tests of the pure domain functions. No server and no database.

| File                   | Tests | Covers                                                                                                                                                 |
| ---------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tax.test.ts`          | 6     | Tax per item: multiplication, rounding down and up, zero cost, zero rate                                                                               |
| `amendments.test.ts`   | 10    | Which cost and tax rate apply at a date: latest amendment wins, future amendments ignored, amendment before its sale, same-date ties, timezone offsets |
| `tax-position.test.ts` | 9     | Sales minus payments, amendments, negative positions, each item rounded separately before summing                                                      |

### End-to-end tests (`test/e2e/`, 44 tests)

Each test starts the **real service** as a separate process (with an empty in-memory SQLite database and a free port)
and talks to it over real HTTP, so every test begins with a fresh, empty store.

| File                    | Tests | Covers                                                                                            |
| ----------------------- | ----- | ------------------------------------------------------------------------------------------------- |
| `transactions.test.ts`  | 10    | `POST /transactions`: valid events, duplicate invoices, repeated itemIds, bad input, future dates |
| `tax-position.test.ts`  | 8     | `GET /tax-position`: correct totals, dates before all events, timezone offsets, bad dates         |
| `sale.test.ts`          | 5     | `PATCH /sale`: valid amendments, amendment before its sale, bad input                             |
| `lifecycle.test.ts`     | 7     | Whole scenarios: out-of-order amendments, past and future events, overpayment, rounding           |
| `routing.test.ts`       | 6     | 404 for unknown paths, 405 (with an `Allow` header) for wrong methods                             |
| `observability.test.ts` | 8     | `/health`, `/metrics`, and a 500 / 503 when the database breaks, with no internal details leaked  |

## Endpoints

All request and response bodies are JSON, except `GET /metrics`, which is plain text. Amounts are in **whole pennies**.
Dates must be full ISO 8601 timestamps with a timezone, such as `2024-02-22T17:29:39Z` or `2024-02-22T17:29:39+01:00`.
A date with no time of day (`2024-02-22`) is rejected.

**Error replies** always look like this, whatever the status code:

```json
{ "errors": ["first problem", "second problem"] }
```

These errors apply to every endpoint:

| Status | When                                                                                                       |
| ------ | ---------------------------------------------------------------------------------------------------------- |
| `404`  | The path does not exist. Body: `{"errors":["Not found"]}`                                                  |
| `405`  | The path exists but not for that method. Body: `{"errors":["Method not allowed"]}`, plus an `Allow` header |
| `500`  | Something unexpected went wrong. Body is always `{"errors":["Internal server error"]}`, never any details  |

### `POST /transactions`

Records one event. The `eventType` field decides which kind.

**A sale (`SALES`):**

| Field       | Type            | Rules                                                                                             |
| ----------- | --------------- | ------------------------------------------------------------------------------------------------- |
| `eventType` | `"SALES"`       |                                                                                                   |
| `date`      | ISO 8601 string | Past and future dates are both fine                                                               |
| `invoiceId` | string          | Not empty. Must not have been used by an earlier sale                                             |
| `items`     | array           | Each item needs `itemId` (string), `cost` and `taxRate`. `itemId`s must be unique within the sale |
| `cost`      | integer         | Whole pennies, 0 or more                                                                          |
| `taxRate`   | number          | From 0 to 1 (`0.2` means 20%)                                                                     |

**A tax payment (`TAX_PAYMENT`):**

| Field       | Type            | Rules                    |
| ----------- | --------------- | ------------------------ |
| `eventType` | `"TAX_PAYMENT"` |                          |
| `date`      | ISO 8601 string |                          |
| `amount`    | integer         | Whole pennies, 0 or more |

Fields that are not listed are rejected.

**Success:** `202 Accepted` with no body.

**Errors:**

| Status | When                                             | Example body                                                                                             |
| ------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `400`  | The body is not valid JSON                       | `{"errors":["Request body must be valid JSON"]}`                                                         |
| `400`  | The body breaks a rule (all problems are listed) | `{"errors":["date: Invalid ISO datetime","items.0.cost: Invalid input: expected int, received number"]}` |
| `400`  | An `itemId` is repeated in a sale                | `{"errors":["items.1.itemId: Duplicate itemId \"A\" at position 1 (first used at position 0)"]}`         |
| `400`  | The `invoiceId` was already used                 | `{"errors":["Invoice already exists"]}`                                                                  |

**Example:**

```bash
curl -i -X POST http://localhost:3000/transactions \
  -H 'Content-Type: application/json' \
  -d '{
    "eventType": "SALES",
    "date": "2024-02-22T17:29:39Z",
    "invoiceId": "INV-001",
    "items": [
      { "itemId": "ITEM-1", "cost": 1000, "taxRate": 0.2 },
      { "itemId": "ITEM-2", "cost": 333,  "taxRate": 0.1 }
    ]
  }'
# HTTP/1.1 202 Accepted

curl -i -X POST http://localhost:3000/transactions \
  -H 'Content-Type: application/json' \
  -d '{ "eventType": "TAX_PAYMENT", "date": "2024-02-23T09:00:00Z", "amount": 100 }'
# HTTP/1.1 202 Accepted
```

### `GET /tax-position?date=`

Returns the tax position at a point in time: the tax from every sale dated **on or before** `date`, minus every tax
payment dated on or before `date`, using the amendments that apply at that date.

| Parameter | Type            | Rules                                         |
| --------- | --------------- | --------------------------------------------- |
| `date`    | ISO 8601 string | Required. Other query parameters are rejected |

**Success:** `200 OK` with the date you asked about and the position in whole pennies. A negative number means more tax
has been paid than is owed.

```json
{ "date": "2024-03-02T00:00:00Z", "taxPosition": 33 }
```

**Errors:** `400` if `date` is missing, is not a full ISO 8601 timestamp, or another parameter is present.

```json
{ "errors": ["date: Invalid input: expected string, received undefined"] }
```

**Example:**

```bash
curl 'http://localhost:3000/tax-position?date=2024-02-28T00:00:00Z'
# {"date":"2024-02-28T00:00:00Z","taxPosition":133}
```

> **A `+` in a timezone offset must be written as `%2B`.** In a URL query string a plain `+` means a space, so
> `?date=2024-03-02T01:00:00+01:00` arrives as `2024-03-02T01:00:00 01:00` and is rejected with
> `date: Invalid ISO datetime`. Write it like this instead:
>
> ```bash
> curl 'http://localhost:3000/tax-position?date=2024-03-02T01:00:00%2B01:00'
> # {"date":"2024-03-02T01:00:00+01:00","taxPosition":33}
> ```
>
> Dates ending in `Z` need no special treatment.

### `PATCH /sale`

Amends the cost and tax rate of one item in a sale. The amendment takes effect from its own `date`. It is always
accepted, even if the sale it refers to has not been received yet, and an item can be amended many times.

| Field       | Type            | Rules                                  |
| ----------- | --------------- | -------------------------------------- |
| `date`      | ISO 8601 string | When the amendment takes effect        |
| `invoiceId` | string          | The sale to amend. Not empty           |
| `itemId`    | string          | The item to amend. Not empty           |
| `cost`      | integer         | The new cost, whole pennies, 0 or more |
| `taxRate`   | number          | The new tax rate, from 0 to 1          |

Fields that are not listed are rejected.

**Success:** `202 Accepted` with no body.

**Errors:** `400` if the body is not valid JSON or breaks a rule (same format as `POST /transactions`).

**Example:**

```bash
curl -i -X PATCH http://localhost:3000/sale \
  -H 'Content-Type: application/json' \
  -d '{
    "date": "2024-03-01T00:00:00Z",
    "invoiceId": "INV-001",
    "itemId": "ITEM-1",
    "cost": 500,
    "taxRate": 0.2
  }'
# HTTP/1.1 202 Accepted

curl 'http://localhost:3000/tax-position?date=2024-03-02T00:00:00Z'
# {"date":"2024-03-02T00:00:00Z","taxPosition":33}
```

The tax position went from 133 to 33 because ITEM-1 changed from 1000 pennies (tax 200) to 500 pennies (tax 100), and the
100-penny payment is subtracted: `100 + 33 - 100 = 33`.

## Observability

### Health: `GET /health`

Reads from the database to prove it can be reached.

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

- `200 {"status":"ok"}`: the service is running and the database can be read.
- `503 {"status":"error"}`: the database could not be read. The reason is written to the log and is **never** sent back to the caller.

### Metrics: `GET /metrics`

Plain text, one labelled value per line, sorted so the output is steady between reads.

```bash
curl http://localhost:3000/metrics
```

```
# Requests finished, by method, route and status code
http_requests_total{method="GET",route="unmatched",status="404"} 2
http_requests_total{method="POST",route="/transactions",status="202"} 1
http_requests_total{method="POST",route="/transactions",status="400"} 2

# Request duration in milliseconds, by method and route
http_request_duration_ms_count{method="POST",route="/transactions"} 3
http_request_duration_ms_sum{method="POST",route="/transactions"} 13.358
http_request_duration_ms_max{method="POST",route="/transactions"} 10.187
```

| Metric                           | Meaning                                                           |
| -------------------------------- | ----------------------------------------------------------------- |
| `http_requests_total`            | How many requests have finished, by method, route and status code |
| `http_request_duration_ms_count` | How many requests the duration figures are based on               |
| `http_request_duration_ms_sum`   | Total time spent on those requests, in milliseconds               |
| `http_request_duration_ms_max`   | The slowest single request, in milliseconds                       |

The average time is `sum / count`. Things to know:

- Requests to paths the service does not have are all counted under `route="unmatched"`, so random URLs cannot create endless new lines.
- A request is counted once it has **finished**, so a fresh service shows no counters until at least one request has completed.
- The numbers live in memory and start again from zero when the service restarts.

### Logs and request IDs

The service writes **one JSON object per line to stdout**. Each line has these fields, then any extras:

| Field       | Meaning                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------- |
| `level`     | `info`, `warn` or `error`                                                                      |
| `time`      | When it happened, as epoch milliseconds                                                        |
| `requestId` | The ID of the request being handled (left out for logs not tied to a request, such as startup) |
| `message`   | What happened, in plain English                                                                |

Every finished request is logged as `Request completed`, with `method`, `path`, `statusCode` and `durationMs`. The level
follows the status: `info` for 2xx and 3xx, `warn` for 4xx, `error` for 5xx. `/health` and `/metrics` are **not** logged,
because monitoring tools call them constantly.

```json
{"level":"info","time":1793465041246,"requestId":"f63a4784-acc1-4dd5-ba1b-c443403638b9","message":"Request completed","method":"POST","path":"/transactions","statusCode":202,"durationMs":10}
{"level":"warn","time":1793465041279,"requestId":"c235b4db-1997-4066-bba8-4d0544c4543d","message":"Request completed","method":"POST","path":"/transactions","statusCode":400,"durationMs":1}
```

**Request IDs.** Every incoming request is given a new random UUID. It is carried through the whole request
automatically (using Node's `AsyncLocalStorage`), so any log line written while handling that request includes the same
`requestId`, without it being passed from function to function. To follow one request, search the logs for its ID. The
ID is not currently sent back to the caller in a response header.

**Reading the logs.** Because each line is JSON, tools like [`jq`](https://jqlang.github.io/jq/) work well:

```bash
npm run dev | jq .                                  # pretty-print everything
npm run dev | jq 'select(.level == "error")'        # only errors
npm run dev | jq 'select(.requestId == "f63a4784-acc1-4dd5-ba1b-c443403638b9")'   # one request
```

(`npm run dev` prints a few npm header lines first, so for `jq` it is cleaner to run `npm start` after building, or
`npx tsx src/index.ts`.)

Logging is switched off when `NODE_ENV=test`.

## Assumptions

These are the decisions made where the brief left room for interpretation, and the limits you should know about.

### Money and tax

- **All amounts are whole pennies.** `cost` and `amount` must be integers, 0 or more. Decimals and negatives are rejected. `taxRate` is a fraction from 0 to 1.
- **Rounding.** The tax on an item is `Math.round(cost × taxRate)`, rounded **once per item**. Each item is rounded separately and then the results are added up (two items of 5 pennies at 50% are 3 + 3 = 6, not 5). Halves round up (`2.5` becomes `3`).
- **The tax position can be negative.** If more tax has been paid than is owed, the position is a negative number. It is not clamped to zero.
- **No financial years.** There are no tax periods or year boundaries. The position at a date counts everything from the beginning of time up to that date.

### Dates and ordering

- **Events are placed by their own `date`, not by when they arrived.** Past and future dates are both valid, and the position at a date uses only events dated on or before it (inclusive).
- **Dates are compared as moments in time, not as text.** `10:00+05:00` is correctly treated as earlier than `08:00Z`.
- **Dates must be full ISO 8601 timestamps with a timezone** (`Z` or an offset). Date-only values are rejected.
- **Events with the same date keep the order they arrived in.**

### Amendments

- **An amendment takes effect at its own date.** A position asked for before that date uses the earlier values; from that date on, it uses the amended ones.
- **An amendment replaces both `cost` and `taxRate`** for the item. It is not a partial update.
- **Multiple amendments to one item:** the one with the latest date (that is on or before the query date) wins. If two have exactly the same date, the one that arrived later wins.
- **Amendments are accepted before the sale arrives.** They are stored as they come in and apply once the sale exists. An amendment for a sale that never arrives has no effect on the tax position.
- **Amendments are always accepted.** There is no check that the invoice or item exists, and no check for duplicates.

### Validation

- **A duplicate `invoiceId` on a sale is rejected with `400`** and the message `Invoice already exists`. This only applies to sales: tax payments and amendments have no uniqueness rule.
- **`itemId`s within a sale must be unique.** The error names the repeated ID and its position in the list.
- **Unknown fields are rejected** (in request bodies and in the query string), rather than silently ignored. A typo in a field name gets a `400`, not a surprise.
- **IDs cannot be empty strings.**
- **A sale with an empty `items` list is allowed.** The brief does not forbid it, and it simply adds no tax.
- **A rejected request is never stored.**
- **`202 Accepted` is returned for successful writes** (with no body), as the brief asks, even though the event is already saved by the time the reply is sent.

### Known limitations

- **The duplicate-invoice check has a race condition.** It first reads the store to see if the invoice exists, and then writes, as two separate steps. In this service that is safe today: SQLite is accessed synchronously by a single process, so two requests cannot get between the check and the write. It would **not** be safe with more than one service process sharing a database, or with an asynchronous database. The robust fix is a unique database constraint on the invoice ID.
- **Every sale ingest reads the whole history.** To check for a duplicate invoice, the service loads all events and searches them. That is simple and correct, but gets slower as the data grows. A dedicated "does this invoice exist?" query on an indexed column would fix it. Calculating the tax position also reads every event up to the date and, for each item, scans them for amendments, so its cost grows with items multiplied by events.
- **There is no limit on request body size.**
- **Metrics are kept in memory** and reset when the service restarts.

### Scope

- **Single user, no authentication or authorisation.** Anyone who can reach the service can use every endpoint.
- **No framework.** The service uses Node's built-in `http` module with a small hand-written router (an exact path and method match), instead of Express or similar. Paths match exactly, so `/sale/` with a trailing slash gives a `404`.
- **A single process with one SQLite file.** There is no clustering, replication or migration tooling beyond creating the table if it does not exist.
