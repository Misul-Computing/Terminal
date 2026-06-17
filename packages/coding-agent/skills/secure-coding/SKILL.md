---
name: secure-coding
description: >
  Universal defensive-security scaffolding that lifts any model above the
  insecure defaults it writes out of the box (string-built SQL, secrets in code,
  Math.random tokens, MD5 passwords, eval, client-trusted authorization, leaked
  stack traces). Concrete, model-agnostic rules for the boundaries where bugs
  become vulnerabilities: input validation, injection-safe queries/commands,
  output encoding, authn/authz, secrets, crypto, dependencies, and safe failure.
  Use whenever writing or reviewing code that handles user input, queries, auth,
  secrets, file paths, web requests, serialization, or any untrusted data.
license: MIT
---

# Secure Coding

Most vulnerabilities are not exotic — they are ordinary code that trusted input
it shouldn't have, at a boundary. Security is how you handle those boundaries,
not a feature you add later. This skill works for any model: if you have the
judgment, use the principles; if not, the concrete rules below keep you out of
the traps that produce real CVEs. (Defensive use: writing and reviewing code to
be secure.)

## 1. Treat all input as hostile

Validate at the boundary before logic runs: type, length, range, format, allowed
set. Reject what doesn't fit; don't coerce it into working. "Input" includes
request bodies, query params, headers, file contents, env, and responses from
other services — anything you didn't compute yourself.

## 2. Never build a query or command by string concatenation

This is the single highest-value rule.

- **SQL**: use parameterized queries / prepared statements. `db.query("... WHERE
  id = ?", [id])`, never `"... WHERE id = " + id`. Same for NoSQL operators.
- **Shell**: avoid shelling out with user input; if unavoidable, pass an argv
  array to a no-shell exec — never interpolate into a shell string.
- **Paths**: resolve and confirm the result stays inside the intended root
  (block `../` traversal); never join untrusted input straight into a path.
- **Never** `eval`, `Function()`, or template-render untrusted strings as code.

## 3. Encode on output, in the right context

Injection also happens on the way out. Escape per context: HTML-escape for HTML,
attribute-escape for attributes, etc. In web UIs never assign untrusted data to
`innerHTML`; use text APIs / framework binding, and set a Content-Security-Policy.

## 4. Authentication and authorization on the server

- Authorize on every request on the server; never trust a client-supplied role,
  `isAdmin` flag, or hidden field.
- Check object-level access: can THIS principal act on THIS resource? (Missing
  this is the most common real-world API vuln.)
- Sessions/tokens: short-lived, scoped, revocable; `HttpOnly`+`Secure` cookies;
  validate signature and expiry server-side.

## 5. Secrets

Never in source, repo history, client code, or logs. Load from env or a secret
manager; keep them out of error messages. Add secret files to `.gitignore`. If a
secret is ever committed, it is compromised — rotate it, don't just delete it.

## 6. Use vetted crypto; never roll your own

- Passwords: a slow KDF — `argon2`, `bcrypt`, or `scrypt`. Never MD5/SHA-* alone.
- Random for tokens/ids/salts: a CSPRNG (`crypto.randomBytes`,
  `crypto.getRandomValues`), never `Math.random()`.
- Encryption: an authenticated mode (AES-GCM, libsodium/`AEAD`); don't invent
  schemes or reuse nonces.
- Compare secrets/MACs with a constant-time function, not `==`.

## 7. Dependencies and supply chain

Add dependencies deliberately; each is attack surface. Pin versions, run an audit
(`npm audit`, `pip-audit`, etc.), and prefer the standard library over a tiny
package for trivial needs. Don't copy code from the internet you can't read.

## 8. Fail safely and quietly

- Deny by default; fail closed (an error in an auth check must reject, not allow).
- Return generic errors to clients; never expose stack traces, SQL, versions, or
  internal paths. Log the detail server-side with a request id.
- Don't leak existence of resources through differing responses when sensitive.
- Set timeouts and size limits; reject oversized payloads (DoS via resource
  exhaustion is a vulnerability).

## 9. Server-side request and deserialization safety

- Don't fetch user-supplied URLs without allow-listing the host/scheme (SSRF
  reaches internal services and cloud metadata endpoints).
- Never deserialize untrusted data into live objects with formats that can
  instantiate types (pickle, Java native, unsafe YAML). Use data-only formats.

## Anti-patterns (insecure defaults to catch and reject)

String-built SQL/commands · `Math.random()` for tokens · MD5/SHA for passwords ·
secrets in code or logs · `eval`/`innerHTML` on untrusted input · client-trusted
authorization · `outline:none`-style "it works so ship it" · stack traces to the
client · unbounded request bodies · fetching arbitrary user URLs · `==` on secrets.

## Process: boundaries, controls, verify

1. **Map the trust boundaries**: where does untrusted data enter, and where does
   it reach a sink (DB, shell, filesystem, HTML, another service)?
2. **Apply the matching control** at each boundary (§1–§9). Name the control.
3. **Verify like an attacker**: for each input, ask "what if this is malicious,
   oversized, or crafted?" Test the abuse case, not just the valid one. If a
   finding is uncertain, treat it as real until disproven.
