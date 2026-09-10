# Working on Diagnostic.ar

Everything below assumes a clean clone. Nothing in this repo needs the
production node, the GPU node on brainy, or a copy of any real data.

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node | **22.x** | `frontend/package.json` engines, both Dockerfiles and CI all target 22. Node 18 is end-of-life. |
| Docker + Compose v2 | any current | Backend integration tests spin up a throwaway Postgres; `make up` runs the whole stack. |
| Postgres | — | Not installed directly; it comes from Docker. |

If you manage runtimes with conda:

```bash
conda create -y -n diagnosticar -c conda-forge nodejs=22
conda activate diagnosticar
```

## Five-minute start (frontend only)

The fastest way to see the product working. No backend, no database, no GPU,
and **no `.env` needed** — the mock injects its own configuration.

```bash
cd frontend
npm ci
npm run dev:mock
```

Open http://localhost:3000 and sign in with **any** email and any password of
8+ characters. `demo@diagnosticar.test` / `demo1234` comes seeded with two
patients. See [TESTING.md](TESTING.md) for failure injection
(`MOCK_FAIL=...`, `MOCK_LATENCY_MS=...`).

## Full stack locally

```bash
cp .env.example .env      # then fill in the values
make up                   # frontend :3000, backend :4000, postgres :5432
make logs
```

The HPO and GenPhenAI services are **not** in this repo — they live in
[`diagnostic.ar-api`](https://github.com/MateAlv/diagnostic.ar-api) and run on
brainy. Without them the wizard's extract and rank steps will fail, which is
exactly why `dev:mock` exists.

## Tests

```bash
make test           # everything: lint, typecheck, backend, frontend, E2E
make test-backend   # starts and tears down its own Postgres
make test-frontend
make test-e2e       # Playwright against the standalone production build
```

First E2E run on a new machine also needs the browser binaries:

```bash
cd frontend && npx playwright install --with-deps chromium
```

Backend integration tests **skip** when Postgres is unreachable rather than
failing, so a bare `npm test` still works. `make test-backend` provides the
database so they actually run — check the summary says `# skipped 0`.

## Layout

```
frontend/     Next.js 16 + React 19 + Tailwind. mocks/ holds the dev-mode API.
backend/      Express + TypeScript + Postgres. tests/api-*.test.mjs are the
              cross-tenant access tests — read those first.
ops/          Pull-based deploy, smoke test and systemd units for nodo0.
.github/      CI, CodeQL, release. See CI_CD.md.
```

## Before you push

`main` has no branch protection yet, so CI is advisory rather than blocking.
Run `make test` locally first. See [CI_CD.md](CI_CD.md) for what CI checks and
what still needs configuring on the GitHub side.
