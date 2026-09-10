# CI/CD for Diagnostic.ar

## Topology this pipeline assumes

```
nodo0  (public)              brainy  (compute)
├── frontend  (Next.js)      ├── HPO gateway   :8000  ─┐  separate repo:
├── backend   (Express)      └── GenPhenAI    :18020  ─┘  diagnostic.ar-api
├── postgres
└── traefik  ──── TLS ────┐
                          └── reverse SSH tunnels ──► brainy
```

**This repository deploys nodo0 only.** The HPO and GenPhenAI services live in
[`diagnostic.ar-api`](https://github.com/MateAlv/diagnostic.ar-api) and are
deployed separately on brainy. They are treated here as an external dependency:
CI stubs them, and `ops/smoke.sh` does not gate on them, so a GPU node reboot
cannot block a frontend deploy. If you want the pipeline to also verify brainy,
add a health probe against `/healthz` on both services as a **non-blocking**
step — blocking on it would couple two independently-deployed systems.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main`, every PR, and weekly
(vulnerabilities appear without anyone pushing).

| Job | Gates on |
|---|---|
| `static` | eslint + `tsc --noEmit` for both workspaces |
| `unit-frontend` | pure frontend logic |
| `backend-tests` | full backend suite against a Postgres service container |
| `e2e` | Playwright against the standalone build, model services stubbed |
| `audit` | `npm audit` on runtime deps (dev deps reported, not blocking) + lockfile drift |
| `secrets` | gitleaks, plus an assertion that no `.env` is tracked |
| `images` | builds both images, Trivy HIGH/CRITICAL, asserts non-root |
| `stack-smoke` | boots the real compose stack and drives the real endpoints |

Two of these deserve explanation:

- **`backend-tests` fails if integration tests skip.** They self-skip without a
  database, which is right locally and dangerous in CI — a broken service
  container would otherwise show as green.
- **`stack-smoke` restarts the backend** to prove migrations are idempotent.
  `migrate()` runs on every boot, so a non-idempotent statement breaks the
  *second* deploy, not the first.

`.github/workflows/codeql.yml` runs `security-extended` static analysis.
`.github/dependabot.yml` groups routine updates weekly and pins Next/React major
versions, which change the standalone layout the Dockerfile depends on.

## Releases

Tagging `vX.Y.Z` triggers `.github/workflows/release.yml`, which builds both
images, pushes them to GHCR tagged with the version and the commit SHA, and
Trivy-scans the published result.

`NEXT_PUBLIC_*` values are baked into the client bundle **at build time**, so
they are supplied as build args from repository variables — setting them in
`.env` on the node has no effect on an already-built image.

## Deployment: pull-based

Nothing reaches into nodo0. A systemd timer asks GitHub every ten minutes
whether a newer release exists, and if so deploys it. No inbound access, no CI
runner and no repository credentials on the machine holding clinical data.

```
release tag ──► GHCR ◄── ops/deploy.sh (timer on nodo0)
                            │
                            ├─ pg_dump backup
                            ├─ docker compose pull
                            ├─ docker compose up -d --no-build
                            ├─ ops/smoke.sh
                            └─ on failure: roll back to previous tag, re-smoke
```

`ops/deploy.sh` refuses to proceed if the pre-deploy database backup fails —
a migration runs on every backend boot, and that dump is the only way back from
one that goes wrong.

### Installing on nodo0

```bash
sudo git clone https://github.com/LUCAI-Bioinformatics/diagnostic.ar /opt/diagnostic.ar
cd /opt/diagnostic.ar
sudo cp .env.example .env && sudo $EDITOR .env      # fill in real secrets
sudo mkdir -p /var/lib/diagnosticar /etc/diagnosticar

# Only while the repository is private:
printf '%s' 'ghp_...' | sudo tee /etc/diagnosticar/github-token >/dev/null
sudo chmod 600 /etc/diagnosticar/github-token

sudo cp ops/systemd/diagnosticar-deploy.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now diagnosticar-deploy.timer
```

Operating it:

```bash
make deploy              # deploy the latest release now
make deploy TAG=v1.4.2   # deploy a specific tag
make deploy-rollback     # back to the previous tag
make smoke               # health-check without deploying
journalctl -u diagnosticar-deploy -f
systemctl list-timers diagnosticar-deploy.timer
```

## Staging

A full copy of production on the same node, under its own compose project name
and its own database volume, behind its own Traefik host with basic auth and
`X-Robots-Tag: noindex`.

```bash
cp .env.staging.example .env.staging && $EDITOR .env.staging
make staging-up            # build and deploy the working tree
make staging-up TAG=v1.4.2 # or deploy a released tag
make staging-smoke
```

Staging shares brainy's HPO/GenPhenAI tunnels, which is the point: it is the
only place the real model services are exercised before production.

Two rules:

1. **Synthetic data only.** Never restore a production dump into staging — that
   would put clinical data on a host with weaker access control, and there is no
   consent basis for it.
2. **Separate JWT secrets.** They are separate variables in
   `.env.staging.example` so a staging session can never authenticate against
   production. Do not collapse them.

## Recommended branch protection

CI is only a gate if it cannot be bypassed. On `main`, require:
`static`, `unit-frontend`, `backend-tests`, `e2e`, `audit`, `secrets`,
`images`, `stack-smoke`; require a PR review; disallow force pushes.

## Known gaps

- **No automated restore test.** `deploy.sh` takes a backup before every deploy,
  but nothing verifies one can be restored. A quarterly manual restore into
  staging is the cheapest way to close this.
- **Actions are pinned to tags, not commit SHAs.** Dependabot watches them. For
  a stricter supply chain, pin to SHAs.
- **No uptime monitoring.** The deploy smoke test covers the moment of release;
  it does not notice a database filling its disk at 03:00.
- **brainy is not covered.** `diagnostic.ar-api` needs its own pipeline; its
  `tests/` directory suggests the groundwork is there.
