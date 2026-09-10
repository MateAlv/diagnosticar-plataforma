# Testing Diagnostic.ar

Diagnostic.ar stores symptoms, clinical histories and gene rankings about real
people, many of them children. The suite is weighted accordingly: the tests that
matter most are the ones proving one family cannot read another family's
records, and that the result screen never presents a computation as a diagnosis.

## Running everything

```bash
make test          # lint, typecheck, backend (with a throwaway Postgres), frontend, E2E
```

Individually:

```bash
make lint typecheck
make test-backend    # starts and tears down a Postgres container for you
make test-frontend   # pure unit tests, no services
make test-e2e        # Playwright against the standalone production build
```

## Frontend-only development (no backend, no database, no GPU)

```bash
cd frontend
npm run dev:mock          # http://localhost:3000, API mocked on :4500
```

Sign in with **any** email and any password of 8+ characters
(`demo@diagnosticar.test` / `demo1234` comes pre-seeded with two patients).

`mocks/server.mjs` stands in for all three services on one port — the Express
API, the HPO gateway and GenPhenAI — because their paths do not collide.
`scripts/dev-mock.mjs` injects the `NEXT_PUBLIC_*` base URLs at launch rather
than writing `.env.local`, so nothing on disk changes and a plain `npm run dev`
still talks to whatever your `.env` says.

It is deliberately **faithful, not permissive**: it enforces the same CSRF
double-submit, the same origin check, the same `text_es` 10 000-character cap,
and the same "non-UUID id is a 404 before authentication runs" ordering as the
real stack. A request that would 403 in production 403s here too.

Exercising failure states:

```bash
MOCK_FAIL=extract npm run dev:mock      # HPO gateway returns 502
MOCK_FAIL=rank    npm run dev:mock      # GenPhenAI returns 503
MOCK_FAIL=save    npm run dev:mock      # saving a patient returns 500
MOCK_FAIL=auth    npm run dev:mock      # login returns 500
MOCK_LATENCY_MS=1500 npm run dev:mock   # see every spinner
```

State is in memory and resets on restart. Nothing here touches a database, so
it is safe to run anywhere — and for the same reason it must never be deployed.

Response bodies live in `frontend/mocks/fixtures.json`, which the Playwright
suite imports too. **That file is the single source of truth**: if an HPO or
GenPhenAI response shape changes in `diagnostic.ar-api`, change it there once and
both the dev mock and the E2E tests follow.

## The layers

| Layer | Where | Needs | What it protects |
|---|---|---|---|
| Unit (backend) | `backend/tests/tokens.test.mjs`, `config.test.mjs`, `security.test.mjs` | nothing | JWT signing/verification, password hashing, CSRF and origin checks, rate limiting, config guard rails |
| Integration (backend) | `backend/tests/api-*.test.mjs` | Postgres | Real routes over the real middleware chain against the real schema |
| Unit (frontend) | `frontend/tests/*.test.mjs` | nothing | Pure logic, e.g. specialty translation |
| E2E | `frontend/e2e/*.spec.ts` | production build | Rendering, the wizard end to end, accessibility, security headers |

### Backend integration tests

They connect to `TEST_DATABASE_URL` (falling back to `DATABASE_URL`). **When
Postgres is unreachable they skip rather than fail**, so `npm test` still works
on a laptop with no database. CI treats a skip as a failure — see the "Fail if
the integration tests silently skipped" step in `ci.yml`, which exists precisely
because a broken service container would otherwise look like a green build.

Each `api-*.test.mjs` file runs in its own process, which matters: the rate
limiter keeps state in a module-level `Map`, so tests that deliberately exhaust
the signup limit would otherwise poison every other test in the run.

`api-ownership.test.mjs` is the file to read first. Every route that takes an
`:id` is probed with a well-formed id belonging to a different user, and the
expected answer is always `404` — never `403`, which would confirm the record
exists.

### E2E

Playwright runs against `output: "standalone"` via
`frontend/scripts/serve-standalone.mjs`, not `next start`. Next explicitly does
not support `next start` with standalone output, and testing it would test an
artifact that never ships.

The HPO gateway and GenPhenAI live on **brainy** and need a GPU, so CI stubs
them via `e2e/fixtures/services.ts`, which reads `mocks/fixtures.json` — the same
file the dev mock server uses. Those shapes mirror `diagnostic.ar-api`
(`services/api-gateway/app/schemas.py`, `services/genphenai/app/main.py`), so a
contract change on that side shows up here as a failing test instead of a blank
screen in production. **If you change either service's response shape, update
`mocks/fixtures.json` in the same week.**

Two projects run: `chromium` (desktop) and `mobile` (Pixel 7). The desktop
navigation is `hidden md:flex`, so nav assertions skip on mobile by design.

To point the suite at a deployed environment instead of a local build:

```bash
E2E_BASE_URL=https://staging.diagnosticar... npx playwright test
```

## What is deliberately covered

Beyond the obvious happy paths, the suite pins behaviour that has already broken
or would break silently:

- **Cross-tenant access** — reading, writing, listing and deleting another
  user's patients and diagnoses, plus a diagnosis id requested under the wrong
  patient id.
- **Token lifecycle** — forged tokens, `alg:none`, key confusion between the
  access and refresh secrets, expiry, tokens for deleted users, and revocation
  via `token_version`.
- **Right to erasure** (Ley 25.326 art. 16) — deleting a user removes their
  patients and diagnoses; deleting a patient cascades to diagnoses.
- **Malformed input as a 4xx, never a 500** — non-UUID ids, oversized bodies,
  broken JSON, over-length fields, NUL bytes in pasted clinical text.
- **No internals in any error body** — no stack traces, file paths or Postgres
  error text.
- **Login is not an account-existence oracle** — unknown user and wrong password
  return identical responses.
- **Spanish rendering** — accents survive a database round trip and page render;
  no English specialty name reaches the results screen.
- **The disclaimer is present** on the results screen.
- **No secret in the client bundle** — only `NEXT_PUBLIC_*` may reach the browser.

## Accessibility debt

`e2e/a11y.spec.ts` gates on serious and critical WCAG A/AA violations, with one
documented exception in `KNOWN_A11Y_DEBT`:

> **`color-contrast`** — the accent colour used for outline buttons, secondary
> links and small print does not reach the WCAG AA 4.5:1 ratio against the light
> surface. Affects `/home`, `/login`, `/sign-up` and the wizard.

This is unfixed because the remedy is a brand decision: darken `--lu-accent`, or
introduce a separate `--lu-accent-text` used only for text on light backgrounds.
A companion test holds the line at the current node count so the problem cannot
spread while it waits. **Remove the allowlist entry once the palette is fixed.**

Given the audience — families under stress, often on a phone, sometimes using a
screen reader — this is worth scheduling rather than carrying indefinitely.

## Adding tests

- A new API route needs an entry in `api-ownership.test.mjs` proving it is not
  readable across tenants, and one in `api-hardening.test.mjs` proving a
  malformed `:id` returns 404.
- A new user-visible screen needs a render check and an axe scan.
- A change to an HPO/GenPhenAI response shape needs the fixture updated.
