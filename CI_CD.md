# CI/CD for Diagnostic.ar

Two halves: **what the pipeline does** (reference), and **how to take a change
through it** (the runbook, at the bottom — start there if you are shipping
something today).

Accurate as of 2026-09-18, `v0.4.0`.

---

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

Production is **https://diagnosticar.infra.cluster.qb.fcen.uba.ar**. Note
`infra`, not `infa`; both resolve, but `infa` is a wildcard catch pointing at a
different machine.

---

## Continuous integration

`.github/workflows/ci.yml` runs on every PR and weekly on `main`
(vulnerabilities appear without anyone pushing), and by hand from the Actions
tab. Not on push to `main`: a PR merges only when it is up to date with `main`
and green, and merges are squashed, so what lands is the tree already tested.
Six checks:

| Check | Gates on |
|---|---|
| `Checks` | eslint + `tsc --noEmit` for both workspaces, frontend unit tests, `npm audit` on runtime deps, lockfile drift, gitleaks, no tracked `.env` |
| `Backend tests (Postgres)` | full backend suite against a Postgres service container |
| `E2E (Playwright)` | the standalone build, model services stubbed |
| `Build & scan images (frontend)` / `(backend)` | Trivy HIGH/CRITICAL, asserts non-root |
| `Compose stack smoke test` | boots the real compose stack and drives real endpoints |

Three deserve explanation:

- **`Backend tests` fails if integration tests skip.** They self-skip without a
  database, which is right locally and dangerous in CI — a broken service
  container would otherwise show as green. Check `# skipped 0`.
- **`Compose stack smoke test` restarts the backend** to prove migrations are
  idempotent. `migrate()` runs on every boot, so a non-idempotent statement
  breaks the *second* deploy, not the first.
- **The image scan finds base-image CVEs, not just yours.** `npm audit` and
  Trivy disagree by design: `npm audit` reads your lockfile, Trivy reads
  everything in the image, including npm's own bundled dependencies. This is why
  both runner stages delete npm and run `apk upgrade` — see
  "Why the Dockerfiles delete npm" below.

`.github/dependabot.yml` sends routine updates monthly, one grouped PR per
ecosystem, not rebased automatically, and pins Next/React major versions, which
change the standalone layout the Dockerfile depends on. Security fixes still
arrive immediately.

**Actions minutes are an account-wide quota**, and in September 2026 this repo
spent all 3,000. Where they went: Dependabot PRs rebased and re-tested on every
push to `main` (39%), the suite re-run on `main` after each merge (23%), and six
jobs that each took seconds but were billed a whole minute (a job is rounded up
to the minute). The trigger, the grouping and the single `Checks` job above are
the fixes; keep new work inside an existing job unless it needs its own runner.

**There is no CodeQL workflow.** It was removed on 2026-09-14 — code scanning
needs GitHub Advanced Security, which a private repo on this plan does not
include, so the analysis ran and its results were discarded on every push. See
`HANDOFF.md` for the conditions under which to restore it.

### Branch protection

`main` requires all six checks, blocks force-pushes and deletions, and
requires changes to arrive by pull request. It does **not** require an approving
review — a solo owner cannot self-approve, and requiring one would block every
merge.

`enforce_admins` is **off**, so these rules do not restrain the repo owner:
an admin can still push directly to `main`. That is deliberate (no lockout), but
it means protection is a safety net, not a wall. Turn it on if a second
maintainer joins.

---

## Releases

Tagging `vX.Y.Z` triggers `.github/workflows/release.yml`. Per image:

```
Build (load, not push)  →  Trivy HIGH,CRITICAL  →  assert non-root  →  Push
```

**The order matters and was wrong until `v0.1.0`.** The workflow used to push
first and scan second, so a failed scan left a published tag that `ops/deploy.sh`
would happily pull. It now publishes only what has already passed. The second
build is a cache hit, so this costs nothing.

`fail-fast: false` on the matrix is also load-bearing: without it, one image
failing cancels the other mid-push, and a **half-published release** is worse
than a failed one — `deploy.sh` would find a mismatched pair.

**Three images per tag.** The backend reads every URL from `.env` at runtime,
so one image serves both environments. The frontend does not — `NEXT_PUBLIC_*`
values are compiled into the client bundle at build time — so it is built once
per environment:

```
ghcr.io/matealv/diagnosticar-backend:X.Y.Z
ghcr.io/matealv/diagnosticar-frontend:X.Y.Z            production URLs
ghcr.io/matealv/diagnosticar-frontend-staging:X.Y.Z    staging URLs
```

plus `X.Y`, `latest`, and `sha-<full commit sha>`. Note the **lowercase**
registry path, which is not how the account name is spelled.

The matrix is keyed on `environment` alone; the image name, the four public
URLs and the cache scope are all derived from it, so a staging build cannot be
published under the production name by editing one line. A build whose resolved
API URL disagrees with its declared environment **fails** rather than shipping
an image that starts cleanly and posts to the wrong place — which is exactly
what happened on the first staging deploy, where the login failed because the
request reached production's API.

Setting `NEXT_PUBLIC_*` in `.env` on the node has **no effect on an
already-built image**. Changing one requires a new tag, not a restart.

### Why the Dockerfiles delete npm

Both runner stages end with:

```dockerfile
RUN apk upgrade --no-cache
... && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
```

A bare `node:22-alpine` carries ~11 HIGH/CRITICAL CVEs (including a CRITICAL in
`tar`) inside npm's own bundled dependencies, before any of your code is
installed. Neither runtime needs npm — the backend runs `dist/index.js`, the
frontend runs the standalone `server.js` — so npm was build tooling being
shipped to production. `apk upgrade` covers the Alpine packages (currently
openssl) that the published base image lags on.

`apk upgrade` is a **stopgap**: it pulls whatever is newest at build time, so
two builds of identical source can differ. Pin `FROM node:22-alpine@sha256:…`
when reproducibility matters more than convenience, and keep `apk upgrade` for
patches published after that digest.

---

## Deployment: pull-based

Nothing reaches into nodo0. A systemd timer asks GitHub every ten minutes
whether a newer release exists, and if so deploys it. No inbound access, no CI
runner and no repository credentials on the machine holding clinical data.

```
release tag ──► GHCR ◄── ops/deploy.sh (timer on nodo0)
                            │
                            ├─ pg_dump backup      (refuses to deploy if this fails)
                            ├─ docker compose pull
                            ├─ docker compose up -d --no-build
                            ├─ ops/smoke.sh
                            └─ on failure: roll back to previous tag, re-smoke
```

`ops/smoke.sh` checks behaviour, not liveness. It asserts `/api/patients`
returns 401 unauthenticated, that a cross-origin POST is rejected, that five
security headers are present and `X-Powered-By` is absent, and that `/home`
renders without mojibake. A container that starts with a broken database
connection or an accidentally public patients endpoint is a **failed deploy**.

### Production CD: how we intend to turn it on

**Nothing has ever deployed production through this pipeline.** Production
diagnostic.ar was deployed by hand and has been running for weeks from
`/home/<usuario>/nodo0-server/services/diagnostic.ar`. Everything below is the
intended path, written down before anyone walks it.

The staging work already proved most of it: the release workflow publishes
correctly, `ops/staging.sh` pulls and starts a stack, and `ops/smoke.sh` catches
real defects. What is untested is `ops/deploy.sh` itself — the backup, the
rollback, and the systemd timer.

#### What must be true first

1. **Staging has run the same tag.** Production should never be the first place
   an image executes.
2. **A restore has been rehearsed.** `ops/deploy.sh` takes a `pg_dump` before
   every deploy and refuses to proceed without one, but nothing has ever
   restored one. Until that is rehearsed, treat the backups as unverified —
   which means the rollback story is "roll back the image", not "roll back the
   data".
3. **The node can pull.** `docker login ghcr.io` as whoever runs the deploy, and
   a read-only PAT at `/etc/diagnosticar/github-token` for the release-lookup
   call in `latest_release()`.

#### Step 1 — dry run against staging, with the production script

```bash
ssh nodo0-diagnostic.ar
cd ~/diagnostic.ar/diagnostic.ar-staging
DEPLOY_STATE_DIR=$HOME/deploy-state-test \
ENV_FILE=$PWD/.env.staging \
  ops/deploy.sh v0.4.0
```

This exercises the real script — backup, pull, restart, smoke, and the rollback
branch — against the staging stack and a throwaway state directory. It is the
only way to find out whether the rollback path works **before** needing it.

Expect to find something. The script has never run.

#### Step 2 — deploy production by hand once

Before automating, do it manually so the failure modes are observed by a person:

```bash
# on nodo0, as whoever owns the production deployment
cd /home/<usuario>/nodo0-server/services/diagnostic.ar
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
               -f docker-compose.deploy.yml pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
               -f docker-compose.deploy.yml up -d --no-build
ops/smoke.sh
```

Note production's checkout predates this pipeline and may not contain `ops/` or
the deploy overlay. Bringing it up to date is itself a change to a live service
serving families, so schedule it rather than doing it opportunistically.

#### Step 3 — install the timer

```bash
sudo mkdir -p /var/lib/diagnosticar /etc/diagnosticar
printf '%s' 'ghp_...' | sudo tee /etc/diagnosticar/github-token >/dev/null
sudo chmod 600 /etc/diagnosticar/github-token
sudo cp ops/systemd/diagnosticar-deploy.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now diagnosticar-deploy.timer
```

The timer asks GitHub every ten minutes whether a newer release exists. Nothing
reaches into the node: no inbound access, no CI runner, no repository
credentials on the machine holding clinical data. That property is the reason
for the pull-based design and should not be traded away for convenience.

#### Step 4 — watch the first automated deploy

```bash
journalctl -u diagnosticar-deploy -f
systemctl list-timers diagnosticar-deploy.timer
```

#### Why production is riskier than staging, concretely

- **Staging shares the host with production.** A compose command that resolves
  to the wrong project name hits live clinical data. Every command carries an
  explicit `-p`.
- **Migrations run on every backend boot.** A bad migration breaks the deploy
  *and* the data. This is what the pre-deploy `pg_dump` exists for, and why an
  unrehearsed restore is the biggest open risk in this repository.
- **Rollback restores the image, not the database.** If a migration corrupts
  data, rolling back the tag does not undo it.

#### What would make this safe enough to automate

In rough order of value:

1. Rehearse a restore from a `pg_dump` into staging.
2. Run `ops/deploy.sh` end to end against staging, including a deliberate smoke
   failure, to prove the rollback branch.
3. Add uptime monitoring. The smoke test covers the moment of release; nothing
   currently notices a disk filling at 03:00.
4. Only then enable the timer.

Until at least the first two are done, deploy production by hand.

### Installing on nodo0

```bash
sudo git clone https://github.com/MateAlv/diagnostic.ar /opt/diagnostic.ar
cd /opt/diagnostic.ar
sudo cp .env.example .env && sudo $EDITOR .env      # fill in real secrets
sudo mkdir -p /var/lib/diagnosticar /etc/diagnosticar

# The GHCR packages are private, so the node needs a read-only PAT:
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

---

## Staging

A full copy of production on the same node, under its own compose project name
and its own database volume, behind its own Traefik host with basic auth and
`X-Robots-Tag: noindex`.

```bash
cp .env.staging.example .env.staging && $EDITOR .env.staging
make staging-up            # build and deploy the working tree
make staging-up TAG=v1.4.2 # or deploy a released tag
make staging-smoke
make staging-down
ops/staging.sh reset-db    # wipe staging data (prompts first)
```

The two modes matter:

- **`make staging-up` with no tag builds your working tree.** This is the "does
  my branch survive the real model services" path — the reason staging exists.
- **`make staging-up TAG=vX.Y.Z` pulls a released image.** This is the rehearsal
  path: identical bytes to what production would run.

Staging shares brainy's HPO/GenPhenAI tunnels, which is the point: it is the
only place the real model services are exercised before production.

Two rules:

1. **Synthetic data only.** Never restore a production dump into staging — that
   would put clinical data on a host with weaker access control, and there is no
   consent basis for it.
2. **Separate JWT secrets.** They are separate variables in
   `.env.staging.example` so a staging session can never authenticate against
   production. Do not collapse them.

---

# Runbook: taking a change to production

This is the intended path end to end. Steps 1–3 are the normal loop; 4 onward
happen when you decide to ship.

### 1. Develop against mocks

```bash
cd frontend && npm run dev:mock
```

No database, no GPU, no `.env`. Sign in with any email and an 8-char password.
Right for almost all UI work.

### 2. Run the gates locally before pushing

```bash
make test        # lint, typecheck, backend (throwaway Postgres), frontend, e2e
```

Cheaper than discovering the same failure in CI five minutes later.

### 3. Open a pull request

`main` is protected, so this is the only route in. All six checks must pass.
No approving review is required, so you can merge your own PR once green.

```bash
git switch -c feat/my-change
# ... work ...
git push -u origin feat/my-change
gh pr create --fill
gh pr checks --watch
gh pr merge --squash
```

### 4. Exercise it on staging

**Before tagging.** Staging is where the real HPO and GenPhenAI services are
first involved — CI only ever sees stubs, so this is the first honest test of
anything touching the model path.

```bash
# on nodo0
cd /opt/diagnostic.ar && git pull
make staging-up          # builds the working tree
make staging-smoke
```

Look at it in a browser at the staging host. Then, if the change touches the
database, **rehearse the restore** (see "Backup restore" below).

### 5. Tag a release

```bash
git switch main && git pull
git tag -a v0.2.0 -m "v0.2.0 — <what changed>"
git push origin v0.2.0
gh run watch                       # release.yml: build → scan → push
```

Semver: patch for fixes, minor for features, major for anything that breaks the
API contract or the database schema in a non-additive way.

If the release fails, **nothing is published** — that is the point of scanning
before pushing. Fix forward and move the tag only if nothing has consumed it;
otherwise cut the next patch version.

### 6. Rehearse the release on staging

```bash
# on nodo0
make staging-up TAG=v0.2.0
make staging-smoke
```

This runs the exact bytes production will run. Skipping it means the first
execution of that image is on the machine holding real clinical records.

### 7. Deploy to production

The timer picks up the new release within ten minutes on its own. To go now:

```bash
make deploy TAG=v0.2.0
```

`deploy.sh` backs up the database, pulls, restarts, smoke-tests, and **rolls
back automatically** if the smoke test fails. Watch it:

```bash
journalctl -u diagnosticar-deploy -f
```

### 8. Verify, and know the way back

```bash
make smoke
curl -sI https://diagnosticar.infra.cluster.qb.fcen.uba.ar/home
```

If something is wrong that the smoke test did not catch:

```bash
make deploy-rollback
```

Rollback restores the **previous image**, not the previous database. A
migration that corrupted data needs the `pg_dump` from
`/var/lib/diagnosticar/backups/`, which is why the backup gates the deploy.

---

## Backup restore

`ops/deploy.sh` writes `pre-<tag>-<timestamp>.sql.gz` before every deploy and
refuses to deploy if it fails. **Nothing has ever restored one.** Until a
restore has been rehearsed, treat the backups as unverified.

To rehearse, into staging, never production:

```bash
# on nodo0
gunzip -c /var/lib/diagnosticar/backups/pre-v0.1.0-*.sql.gz \
  | docker compose -p diagnosticar-staging exec -T db \
      psql -U diagnosticar -d diagnosticar
```

Then `make staging-smoke` and confirm the data is actually there. Note this
contradicts the synthetic-data rule if the dump came from production — so
rehearse with a **staging** dump, or accept that a production dump must be
destroyed immediately afterwards and never left on the staging volume.

Do this quarterly. An unverified backup is not a backup.

---

## Known gaps

- **No automated restore test.** The largest remaining gap for a system holding
  clinical data. See above.
- **No uptime monitoring.** The deploy smoke test covers the moment of release;
  it does not notice a database filling its disk at 03:00.
- **Actions are pinned to tags, not commit SHAs.** Dependabot watches them. For
  a stricter supply chain, pin to SHAs.
- **`apk upgrade` makes builds non-reproducible.** Pin a base digest when that
  matters more than convenience.
- **The rollback path has never been executed.** It is reasoned about and
  reviewed, not run in anger. Rehearse it on staging before you need it.
- **brainy is not covered.** `diagnostic.ar-api` needs its own pipeline; its
  `tests/` directory suggests the groundwork is there.
