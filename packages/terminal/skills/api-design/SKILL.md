---
name: api-design
description: >
  Universal guidance for designing backend/HTTP APIs that lifts any model above
  the sloppy defaults (verbs in URLs, 200-for-everything, leaked stack traces, no
  validation or pagination). Gives both judgment (model the contract first, the
  API is the product) and concrete scaffolding (correct HTTP method/status usage,
  a consistent error envelope, boundary validation, pagination, versioning, an
  auth/security floor, idempotency, observability). Use whenever designing,
  building, or changing an HTTP API, endpoint, route, service, or backend
  contract — REST or RPC.
---

# API Design

The contract is the product. Clients build against it and you cannot quietly
break it later, so design the interface before the implementation. This skill
works for any model: if you have judgment, use the principles; if not, the
concrete rules below keep you out of the common traps.

## 1. Model the contract first

Name the resources (nouns) and the operations on them before writing a handler.
Write the request/response shapes down first — paths, fields, types, and one
example of each. Resources are nouns, not verbs: `POST /orders`, not
`POST /createOrder`. Group by resource; nest only for real ownership
(`/orders/{id}/items`), not for every relation.

## 2. Use HTTP semantics correctly (the uplift step)

Pick the method by its contract, not by habit:

- **GET** — read, no side effects, safe + cacheable. Never mutate on GET.
- **POST** — create or non-idempotent action.
- **PUT** — full replace, idempotent. **PATCH** — partial update.
- **DELETE** — remove, idempotent.

Return the right status, not `200` for everything:

- `200` ok · `201` created (+ `Location`) · `202` accepted (async) · `204` no content.
- `400` malformed · `401` unauthenticated · `403` unauthorized · `404` absent ·
  `409` conflict · `422` semantic validation failure · `429` rate-limited.
- `500` server fault (never leak internals) · `503` unavailable (+ `Retry-After`).

The status code is API surface: clients branch on it. A `200` wrapping
`{"error": ...}` forces every client to parse bodies to detect failure — don't.

## 3. One consistent error envelope

Every error, everywhere, same shape. Pick one and hold it:

```json
{ "error": { "code": "order_not_found", "message": "No order with id 42.", "details": [] } }
```

`code` is a stable machine string clients switch on; `message` is human-readable;
never put a stack trace, SQL, or internal path in a client response. Log the
internal detail server-side with a request id and return a generic message.

## 4. Validate at the boundary

Validate and reject every input at the edge before it touches logic — types,
ranges, lengths, enums, required fields. Reject unknown fields or ignore them on
purpose, never silently trust them. Treat all input as hostile: this is the line
between a bug and a vulnerability (injection, mass-assignment, overflow).

## 5. Collections: paginate, filter, sort — always

Never return an unbounded list. Default and cap the page size. Prefer **cursor**
pagination (`?limit=50&cursor=...`) over offset for large or changing data;
offset is fine for small, stable sets. Document the default and the max.

## 6. Versioning and compatibility

Version from day one (`/v1/...` or a header). Additive changes (new optional
field, new endpoint) are safe; removing/renaming/retyping a field or tightening
validation is breaking — that needs a new version and a deprecation window.
Never repurpose an existing field's meaning.

## 7. Security floor (non-negotiable)

- Authenticate every non-public route; authorize per resource (can THIS caller
  touch THIS object?) — not just "is logged in".
- Secrets come from config/env, never code or the repo. TLS in transit.
- Rate-limit public and auth endpoints; return `429` + `Retry-After`.
- Don't leak existence via error differences when it's sensitive (`404` vs `403`).
- Log auth decisions; never log secrets, tokens, or full PII.

## 8. Correctness under load

- **Idempotency**: make retries safe. For non-idempotent creates, accept an
  `Idempotency-Key` and dedupe. Network retries are guaranteed, not hypothetical.
- **Concurrency**: use optimistic concurrency (version/ETag + `If-Match` → `409`
  on stale write) rather than last-write-wins on contended resources.
- **Timeouts everywhere**: every outbound call (DB, HTTP) has a timeout and a
  defined failure behavior. No unbounded waits.

## 9. Observability

Structured logs (not `print`), one request id propagated across components, and
metrics on latency + error rate per endpoint. When something breaks in
production, you debug from these — design them in, don't bolt on later.

## Anti-patterns (the "AI-generated backend" tells)

Verbs in URLs · `200` for errors · returning the raw exception/stack to clients ·
no input validation · unbounded list endpoints · no auth on "internal" routes ·
secrets in source · GET with side effects · inventing a new error shape per
endpoint · last-write-wins on shared state.

## Process: contract, critique, build, verify

1. **Contract**: write paths, methods, request/response shapes, status codes, and
   the error envelope — with one concrete example per endpoint.
2. **Critique** against §2–§8 and the anti-patterns before coding: every endpoint
   has correct method+status, validates input, is authorized, and (if a
   collection) paginates.
3. **Build** to the contract; validate at the boundary first thing in each handler.
4. **Verify**: test the failure paths (401/403/404/409/422/429), not just the
   happy path — that is where weak APIs break.
