# CI/CD for Diagnostic.ar

Two halves: **what the pipeline does** (reference), and **how to take a change
through it** (the runbook, at the bottom — start there if you are shipping
something today).

Accurate as of 2026-10-15.

---

## The pipeline at a glance

```
 TARS (developer)            GitHub Actions                     GHCR         nodo0
 ────────────────            ──────────────                     ────         ─────
 make ci ─► PR ─► main ─► tag vX.Y.Z ─► release.yml
                                        ├─ CI: checks, backend tests,
                                        │  E2E, compose stack smoke
                                        └─ 6 images: build, test inside,
                                           Trivy, non-root ─────────► push
                                                                       │
                                     cron, every 5 minutes: ops/deploy.sh staging
                                     new tag with every image? pull · up · smoke
                                     smoke failed? back to the previous release
```

Three rules keep it inside the account's Actions minutes, a monthly quota
(3,000 on this plan) shared by every repository of the account:

1. **Nothing runs on a push or a pull request.** `make ci` runs the same checks
   locally and is the gate for merging.
2. **GitHub works once per release**: CI, then the images. A release whose
   pinned commits did not move reuses those images instead of rebuilding them.
3. **Deploying costs no minutes.** nodo0 asks GitHub for new tags and pulls;
   nothing on GitHub reaches into it.

The cloud copy has its own, manual pipeline (`docs/CLOUD_CICD.md`).

---

## Topology this pipeline assumes

```
nodo0  (public, shared with other teams)          brainy  (compute)
├── traefik ── TLS                                 ├── HPO gateway   :8000
├── production  (project diagnosticar)             └── GenPhenAI    :18020
│   frontend, backend, postgres, tunnels ──────────────► brainy
└── staging     (project diagnosticar-staging)
    frontend, backend, postgres,
    hpo-recognizer, model, question-agent
```

**This repository deploys nodo0.** Staging runs the symptom recognizer, the
model and the question agent itself, built by the release from pinned commits
of other repositories (`.github/recognizer.env`, `.github/question-agent.env`).
Production still reaches brainy's services through SSH tunnels.

Production is **https://diagnosticar.infra.cluster.qb.fcen.uba.ar**. Note
`infra`, not `infa`; both resolve, but `infa` is a wildcard catch pointing at a
different machine.

---

## Continuous integration

### `make ci`: the gate for merging

`ops/ci-local.sh` runs every check of `ci.yml` on the developer's machine, in
the same order and with the same commands, plus the image builds and scans the
release does:

| Group | Gates on |
|---|---|
| lint, typecheck | eslint + `tsc --noEmit`, both workspaces |
| unit | frontend unit tests |
| backend | the backend suite against a throwaway Postgres |
| e2e | Playwright against the standalone build, model services stubbed |
| audit | `npm audit` on runtime deps, lockfile drift |
| secrets | gitleaks over the whole history (the same pinned image as CI); no tracked `.env` |
| images | builds both images, asserts non-root, Trivy HIGH/CRITICAL |
| stack | boots the compose stack and drives the real endpoints |

Run it on the exact commit that will merge, with a clean tree. `make test`
covers only part of it.

### `.github/workflows/ci.yml`

The same suite on GitHub, minus the image builds (the release builds and scans
the real images right after). It runs when `release.yml` calls it, before any
image is built, and by hand from the Actions tab. Four jobs:

| Job | Gates on |
|---|---|
| `Checks` | eslint + `tsc --noEmit` for both workspaces, frontend unit tests, `npm audit` on runtime deps, lockfile drift, gitleaks, no tracked `.env` |
| `Backend tests (Postgres)` | full backend suite against a Postgres service container |
| `E2E (Playwright)` | the standalone build, model services stubbed |
| `Compose stack smoke test` | boots the real compose stack and drives real endpoints |

Three deserve explanation:

- **`Backend tests` fails if integration tests skip.** They self-skip without a
  database, which is right locally and dangerous in CI — a broken service
  container would otherwise show as green. Check `# skipped 0`.
- **`Compose stack smoke test` restarts the backend** to prove migrations are
  idempotent. `migrate()` runs on every boot, so a non-idempotent statement
  breaks the *second* deploy, not the first.
- **gitleaks scans the whole history**, not the commits of one push: a secret
  removed in a later commit is still readable in the one that added it.

`.github/dependabot.yml` sends routine updates monthly, one grouped PR per
ecosystem, and pins Next/React major versions, which change the standalone
layout the Dockerfile depends on. No check runs on those PRs either: run
`make ci` on the branch before merging one.

**Where the minutes went.** In September 2026 the account spent all 3,000:
Dependabot PRs re-tested on every push to `main` (39%), the suite re-run on
`main` after each merge (23%), and jobs that took seconds but were billed a
whole minute each (a job is rounded up to the minute). In October the cloud
copy's publishing ran on every merge in three repositories. Since 2026-10-15
nothing runs by itself: CI runs once per release, and cloud publishing is
manual everywhere. Keep new checks inside an existing job unless they need
their own runner.

**There is no CodeQL workflow.** It was removed on 2026-09-14 — code scanning
needs GitHub Advanced Security, which a private repo on this plan does not
include, so the analysis ran and its results were discarded on every push. See
`HANDOFF.md` for the conditions under which to restore it.

### Branch protection

`main` requires changes to arrive by pull request and blocks force-pushes and
deletions. It requires no status checks, since none run on pull requests: the
gate is `make ci`, kept by discipline rather than enforced by GitHub. It does
not require an approving review either — a solo owner cannot self-approve.

`enforce_admins` is **off**, so these rules do not restrain the repo owner.
Deliberate (no lockout), but it makes protection a safety net, not a wall.

---

## Releases

Tagging `vX.Y.Z` triggers `.github/workflows/release.yml`:

```
CI (ci.yml)  ─►  backend · frontend (production) · frontend (staging)
                 hpo-recognizer · model · question-agent
```

Every image follows the same order:

```
Build (load, not push)  →  tests inside the image  →  Trivy HIGH,CRITICAL  →  assert non-root  →  Push
```

The three images built from other repositories run their own test suites
inside the image; the backend and frontend were already tested by CI.

**The order matters and was wrong until `v0.1.0`.** The workflow used to push
first and scan second, so a failed scan left a published tag a node would pull.
It now publishes only what has already passed. The second build is a cache hit,
so this costs nothing.

**A half-published release is never deployed.** Each job pushes its own image,
and `fail-fast: false` keeps one failure from cancelling the others mid-push.
nodo0 deploys a tag only once every image it runs carries it. Re-run the failed
jobs, or fix forward with the next tag.

**Six images per tag.**

```
ghcr.io/matealv/diagnosticar-backend:X.Y.Z               both environments
ghcr.io/matealv/diagnosticar-frontend:X.Y.Z              production URLs
ghcr.io/matealv/diagnosticar-frontend-staging:X.Y.Z      staging URLs
ghcr.io/matealv/diagnosticar-hpo-recognizer:X.Y.Z        diagnostic.ar-api + spanish-symptoms-recognizer
ghcr.io/matealv/diagnosticar-model:X.Y.Z                 diagnostic.ar-api's GenPhenAI
ghcr.io/matealv/diagnosticar-question-agent:X.Y.Z        diagnostic.ar-api's Dockerfile + the agent
```

each also as `vX.Y.Z`, `X.Y`, `latest` and `sha-<full commit sha>`. Note the
**lowercase** registry path, which is not how the account name is spelled.

The backend reads every URL from `.env` at runtime, so one image serves both
environments. The frontend does not — `NEXT_PUBLIC_*` values are compiled into
the client bundle at build time — so it is built once per environment. The
matrix is keyed on `environment` alone; the image name, the four public URLs
and the cache scope are all derived from it, so a staging build cannot be
published under the production name by editing one line. A build whose
resolved API URL disagrees with its declared environment **fails** rather than
shipping an image that starts cleanly and posts to the wrong place — which is
exactly what happened on the first staging deploy. Setting `NEXT_PUBLIC_*` in
`.env` on the node has **no effect on an already-built image**; changing one
requires a new tag.

### Images reused across releases

The recognizer, the model and the question agent are built from commits of
other repositories, so each is also tagged by them:

```
diagnosticar-hpo-recognizer:api-<12>-recognizer-<12>    GATEWAY_COMMIT, RECOGNIZER_COMMIT
diagnosticar-model:api-<12>                             GATEWAY_COMMIT
diagnosticar-question-agent:api-<12>-agent-<12>         GATEWAY_COMMIT, QUESTION_AGENT_COMMIT
```

When a release finds that tag already published, `.github/scripts/reuse-image.sh`
gives the release's tags to that image and the job skips its build: the same
bytes, already tested and scanned, in seconds. The recognizer alone takes about
20 minutes to build. Moving a pin builds again. A reused image is not scanned
again, so it only picks up a newer base image when one of its pins moves.

What a release costs, estimated from earlier runs: about 25 billed minutes when
only this repository changed, about 50 when a pin moved and the recognizer
rebuilds.

### The question agent image

`diagnosticar-question-agent` comes from two private repositories pinned by
commit:

- the **Dockerfile** is `services/question-agent/Dockerfile` in
  `MateAlv/diagnostic.ar-api`, at `GATEWAY_COMMIT` in `.github/recognizer.env`
  (the same pin as the recognizer and the model), checked out into `api/` with
  `API_DEPLOY_KEY`;
- the **agent's code** is `MarBL00126/diagnosticar-question-agent`, at
  `QUESTION_AGENT_COMMIT` in `.github/question-agent.env`, checked out into
  `agent/` with `QUESTION_AGENT_DEPLOY_KEY`, a read-only deploy key its owner
  added, and passed to the build as the named context `agent`
  (`context: ./api`, `build-contexts: agent=./agent`).

The image carries both commits as labels, `org.opencontainers.image.revision.api`
and `org.opencontainers.image.revision.question-agent`. The Dockerfile installs
the agent's runtime dependencies with `-c constraints.txt`, the exact versions
committed in the agent's repository, so rebuilding the same two commits
installs the same packages. A pin that is not a full 40-character SHA fails the
release.

The tests run from the agent's checkout, mounted read-only: `tests/` at
`/tmp/tests` and `docs/` at `/tmp/docs`, which holds the contract example some
tests validate (without it they skip). Tests marked `live` call a real LLM and
are left out. `make ci` does not build this image — it needs both other
repositories.

The backend's `QUESTION_AGENT_TIMEOUT_MS` (100 s) must stay above the agent's
queue wait (10 s) + round budget (`PREGUNTAS_ROUND_BUDGET_S`, 75 s) + its
model-service timeout (10 s), plus a margin; compose sets both. See `STAGING.md`.

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

The Python images (recognizer, model, question agent) do the same with
`apt-get upgrade`: `python:3.12-slim` lags on Debian security fixes. BuildKit
caches that layer, so when Trivy flags an OS package that already has a fix,
the cached layer still holds the old one; rebuild it without the cache.

---

## Deployment: pull-based

Nothing reaches into nodo0: no CI runner, no inbound access, no credential that
can write to GitHub. The node holds clinical records and is shared with other
teams, and five accounts can push to this repository; a runner there would let
any of them run commands on it. So the node pulls.

cron runs `ops/deploy.sh staging` every five minutes as `<usuario>`:

```
git ls-remote --tags          newest vX.Y.Z, newer than every tag already handled?
docker manifest inspect       every staging image published under it?
disk                          20 GiB free for Docker, 5 GiB under /home?
git checkout vX.Y.Z           the release's own compose files and scripts
ops/staging.sh up vX.Y.Z      pull, then recreate the staging containers only
ops/staging.sh smoke          through Traefik, against the public staging host
  └─ failed: check out and start the previous release again, smoke it
```

- **Quiet when there is nothing to do.** It logs only what it does, to
  `~/.local/state/diagnosticar/staging/deploy.log`; the same directory holds
  what runs and what ran before.
- **Each tag is tried once.** A failed tag is not retried every five minutes;
  fix forward with the next one.
- **One deploy at a time** (`flock`), and only `diagnosticar-staging-*`
  containers change. It never prunes or removes images: the host's disk is
  shared, and freeing it is a human decision.
- **By hand:** `ops/deploy.sh staging --status`, `ops/deploy.sh staging vX.Y.Z`
  (also to go back to an older release), `ops/deploy.sh staging --rollback`.
  A tag deployed by hand does not make cron move it back: cron only acts on a
  tag newer than every tag it has handled.

`ops/smoke.sh` checks behaviour, not liveness. It asserts `/api/patients`
returns 401 unauthenticated, that a cross-origin POST is rejected, that five
security headers are present and `X-Powered-By` is absent, and that `/home`
renders without mojibake. A container that starts with a broken database
connection or an accidentally public patients endpoint is a **failed deploy**.

### Turning it on for staging

Once, as `<usuario>` on nodo0. **Order matters:** cron deploys only a tag
newer than the one it has handled, so the state goes in before the tag that
should deploy is pushed. The values below are staging's on 2026-10-15.

1. **Look first, read-only.** These are what to compare against afterwards:

   ```bash
   docker ps -q | wc -l        # every container on the host
   docker ps --filter label=com.docker.compose.project=diagnosticar \
     --format '{{.Names}} {{.Status}}'      # production's uptimes
   df -h / /data | tail -2
   ```

2. **Put the staging checkout on a commit that has `ops/deploy.sh`.** Changing
   files does not touch the running containers; only `up` does.

   ```bash
   cd ~/diagnostic.ar/diagnostic.ar-staging
   git status --short          # only untracked files: .env.staging.bak-*, data/
   git fetch --tags origin && git checkout --detach origin/main
   ```

3. **Write the state**: what runs now, the commit it was deployed from, and
   the newest tag that must not deploy.

   ```bash
   state=~/.local/state/diagnosticar/staging
   mkdir -p "$state"
   echo v0.9.26-manual > "$state/current"
   echo d633abffe2eb98bb864fd8c1f68e1b2bdbec60db > "$state/current-ref"
   echo v0.9.2 > "$state/handled"
   ops/deploy.sh staging --status
   ```

4. **Install the cron line.**

   ```bash
   ( crontab -l 2>/dev/null; echo 'MAILTO=""'
     echo '*/5 * * * * $HOME/diagnostic.ar/diagnostic.ar-staging/ops/deploy.sh staging' ) | crontab -
   crontab -l
   ```

5. **Push the release tag** from the developer's machine (runbook, step 4).
   The first run builds every image, so it takes about half an hour (about 50
   billed minutes). Within five minutes of it going green the deploy starts:

   ```bash
   tail -f ~/.local/state/diagnosticar/staging/deploy.log
   ```

6. **Check afterwards**: `ops/deploy.sh staging --status`, the same container
   count as in step 1, production's uptimes unchanged, and a real search in a
   browser, through the follow-up questions.

If `--status` still says *not published yet* after the run went green, the
node's pull account cannot read one of the packages — most likely one the
release created for the first time, such as `diagnosticar-question-agent`.
Give that account read access in the package's settings on GitHub; the next
cron run deploys.

**The first deploy has no automatic way back.** `v0.9.26-manual` was built by
hand and loaded over SSH, so it is not on GHCR: if the first release fails its
smoke test, `ops/deploy.sh` cannot pull it back and logs `ROLLBACK FAILED`.
Its images are still on the node; bring them back by hand:

```bash
cd ~/diagnostic.ar/diagnostic.ar-staging
git checkout --detach d633abffe2eb98bb864fd8c1f68e1b2bdbec60db
COMPOSE_PROFILES=question-agent GENE_PROFILES_DB=$PWD/data/genes.db \
RELEASE_TAG=v0.9.26-manual FRONTEND_IMAGE=diagnosticar-frontend-staging \
docker compose -p diagnosticar-staging --env-file .env.staging \
  -f docker-compose.yml -f docker-compose.staging.yml \
  -f docker-compose.genes.yml -f docker-compose.deploy.yml \
  up -d --no-build --pull never
ops/staging.sh smoke
```

From the second release on, the previous release is on GHCR and the way back
is automatic.

To stop it, remove the line with `crontab -e`. Staging keeps running whatever
it runs.

### Production: what is left

**Nothing has ever deployed production through this pipeline.** Production
runs images built by hand from `/home/<usuario>/nodo0-server/services/diagnostic.ar`,
owned by another account, and has for weeks. To bring it in:

1. **Decide who deploys it**: the account that owns production's checkout,
   with read access to GHCR, or a checkout of production moved to an account
   that can have both.
2. **Rehearse a restore** of a `pg_dump` into staging (see *Backup restore*).
   Until then the way back from a bad migration is unverified.
3. **Add `production` to `ops/deploy.sh`**: its two images (backend,
   frontend), project `diagnosticar` with `docker-compose.prod.yml` and the
   deploy overlay, a `pg_dump` before every deploy that refuses to continue if
   it fails, and only tags staging already ran. Production should move when a
   person says so (`ops/deploy.sh production vX.Y.Z`), not on every tag.
4. **Deploy one tag by hand**, watching it, before anything automatic.

`ops/systemd/` holds a timer from the first design of this, written for a
root-owned checkout at `/opt/diagnostic.ar` and never installed. Whatever runs
production's deploy (that timer or cron) calls `ops/deploy.sh production`.

Why production is riskier than staging, concretely:

- **Staging shares the host with production.** A compose command that resolves
  to the wrong project name hits live clinical data. Every command carries an
  explicit `-p`.
- **Migrations run on every backend boot.** A bad migration breaks the deploy
  *and* the data. This is what the pre-deploy `pg_dump` is for, and why an
  unrehearsed restore is the biggest open risk in this repository.
- **Rollback restores the image, not the database.** If a migration corrupts
  data, going back to the previous tag does not undo it.

---

## Staging

A full copy of production on the same node, under its own compose project name
and its own database volume, behind its own Traefik host with
`X-Robots-Tag: noindex`. Everything about it — access, the traps, the model
services it runs — is in `STAGING.md`.

Two rules:

1. **Synthetic data only.** Never restore a production dump into staging — that
   would put clinical data on a host with weaker access control, and there is no
   consent basis for it.
2. **Separate JWT secrets.** They are separate variables in
   `.env.staging.example` so a staging session can never authenticate against
   production. Do not collapse them.

---

# Runbook: taking a change to staging

### 1. Develop against mocks

```bash
cd frontend && npm run dev:mock
```

No database, no GPU, no `.env`. Sign in with any email and an 8-char password.
Right for almost all UI work.

### 2. Run the gate on the exact commit

```bash
make ci
```

Fix until it passes. This is the only check before merging, so run it on what
will actually merge.

### 3. Open a pull request and merge it

`main` is protected, so this is the only route in. No check runs on GitHub.

```bash
git switch -c feat/my-change
# ... work, make ci ...
git push -u origin feat/my-change
gh pr create --fill
gh pr merge --squash
```

Merge several changes before releasing: each release costs Actions minutes,
each merge does not.

### 4. Tag a release

```bash
git switch main && git pull
make ci                                  # once more, on main as it is now
git tag -a v0.10.0 -m "v0.10.0 — <what changed>"
git push origin v0.10.0
gh run watch                             # release.yml: CI → images
```

Semver: patch for fixes, minor for features, major for anything that breaks the
API contract or the database schema in a non-additive way. To ship a new
recognizer, model or question agent, move its pin in `.github/recognizer.env`
or `.github/question-agent.env` first.

If the release fails, nothing deploys. Re-run the failed jobs if the failure
was outside the code, or fix forward and tag the next patch version. Do not
move a tag.

### 5. Watch staging take it

Within five minutes of the run going green:

```bash
ssh nodo0-diagnostic.ar diagnostic.ar/diagnostic.ar-staging/ops/deploy.sh staging --status
```

Then look at it in a browser at the staging host. If something is wrong that
the smoke test did not catch, go back:

```bash
ssh nodo0-diagnostic.ar diagnostic.ar/diagnostic.ar-staging/ops/deploy.sh staging --rollback
```

### 6. Production

Not through the pipeline yet; see *Production: what is left*.

---

## Backup restore

Nothing has ever restored a backup of production. Until a restore has been
rehearsed, treat the backups as unverified.

Rehearse on staging, never on production, with a dump **of staging**: take a
`pg_dump` of the staging database, recreate it empty (`ops/staging.sh
reset-db`), load the dump back with `psql` in the `db` container, and run
`ops/staging.sh smoke` and a real search to confirm the data is there. A
production dump must never land on the staging volume: that contradicts the
synthetic-data rule.

Do this quarterly. An unverified backup is not a backup.

---

## Known gaps

- **No automated restore test.** The largest remaining gap for a system holding
  clinical data. See above.
- **No uptime monitoring.** The deploy smoke test covers the moment of release;
  it does not notice a database filling its disk at 03:00.
- **No check on pull requests.** `make ci` is the gate, by discipline. A merge
  that skipped it is caught by the release's CI, before any image is built.
- **The way back has only run in a simulation.** `ops/deploy.sh`'s rollback was
  exercised against a fake checkout and a fake Docker, not the real stack.
- **Actions are pinned to tags, not commit SHAs.** Dependabot watches them. For
  a stricter supply chain, pin to SHAs.
- **`apk upgrade` makes builds non-reproducible.** Pin a base digest when that
  matters more than convenience.
- **brainy is not covered.** Production's model services there are deployed by
  hand.
