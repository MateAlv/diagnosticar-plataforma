# Staging

A full copy of production on the same node, with its own database. It exists for one reason CI cannot cover: **it is the only place the
real HPO and GenPhenAI services are exercised before production.** CI stubs
them, so anything touching the model path is genuinely untested until it runs
here.

**https://staging.diagnosticar.infra.cluster.qb.fcen.uba.ar** — running
`v0.4.0` as of 2026-09-18.

---

## Getting in

Just the app login — no browser password. The Traefik basic-auth gate was
removed in `v0.4.0`: it was the only service on nodo0 using one, and it made
every visit a two-password ritual for the one person testing the project.

Removing it exposes nothing production does not already expose — production
serves `/hpo-api` and `/genphenai` unauthenticated today, both answering 200 to
an anonymous request. `X-Robots-Tag: noindex, nofollow` stays, so staging is
still absent from search results.

What still protects the data is the application itself: `/api/patients` and
every `/api/admin` route answer 401 to an anonymous caller, and the admin routes
re-read the role from the database on every request.

### Creating an admin

There is no bootstrap endpoint, deliberately: a route that mints the first
admin stays exploitable forever once one exists. The first admin is seeded from
a shell by someone who already has database access; every admin after that is
invited from `/admin/equipo`.

```bash
ssh nodo0-diagnostic.ar
cd ~/diagnostic.ar/diagnostic.ar-staging
COMPOSE_PROJECT=diagnosticar-staging ENV_FILE=.env.staging \
  ops/seed-admin.sh you@example.org --create
```

Both environment variables matter. Without them the script targets the default
compose project and `.env`, which is **production**.

It prints a temporary password once. At first sign-in the app forces a change,
then invalidates every session — including the one you are using — because that
password travelled through a terminal. Sign in again with the new one.

---

## How a change reaches staging

```
branch ──► PR ──► main ──► tag vX.Y.Z ──► 3 images on GHCR ──► ops/staging.sh up
           11 CI checks     release.yml                         on nodo0
```

Nothing is built on nodo0. Both environments pull images CI already scanned,
which is why a deploy cannot pick up a half-finished commit.

### The three images, and why there are three

```
diagnosticar-backend           both environments
diagnosticar-frontend          production URLs compiled in
diagnosticar-frontend-staging  staging URLs compiled in
```

The backend reads every URL from `.env` at runtime, so one image serves both.
The frontend does not: **`NEXT_PUBLIC_*` values are compiled into the client
bundle at build time.** An image built for production posts every request to
production's API no matter what the node's `.env` says.

This cost an evening to learn. Staging ran the production frontend, so logging
in failed with correct credentials — the request went to production's API,
where the staging account does not exist. Nothing in `.env.staging` can fix
that; the value is inside the JavaScript, baked in hours earlier by CI.

The staging build **fails loudly** if the `STAGING_NEXT_PUBLIC_*` repository
variables are unset, rather than falling back to production's and shipping an
image that looks fine and talks to the wrong environment.

### Deploying

```bash
ssh nodo0-diagnostic.ar
cd ~/diagnostic.ar/diagnostic.ar-staging
git pull
ops/staging.sh up v0.4.0     # a released tag — what production will run
ops/staging.sh smoke
```

Two modes:

- **`up vX.Y.Z`** pulls released images. Identical bytes to production. This is
  the rehearsal path and the default choice.
- **`up`** with no tag builds the working tree on the node. Useful for "does my
  branch survive the real model services", but it compiles on a host running 62
  containers and ships something no CI run ever scanned. Prefer a tag.

### Repository variables

Eight, four per environment. Set with `gh variable set`.

```
NEXT_PUBLIC_API_URL / _API_BASE_URL / _HPO_API_URL / _GENPHENAI_URL
STAGING_NEXT_PUBLIC_API_URL / ... / ...
```

They are compiled into the bundle, so **changing one requires a new tag**, not
a restart.

---

## What will bite you

### `$$` in an env file, and why it cost an evening

Staging no longer uses basic auth, but the shell trap that broke it applies to
any compose variable containing a hash.

Compose needs dollars **doubled** so interpolation leaves them alone. To bash,
`$$` is the **process id** — so `source`-ing such a file corrupts the value:
`equipo:$$apr1$$…` reached Traefik as `equipo:1865433apr11865433`. Traefik could
not parse the middleware, dropped it, and every route answered 401 with a
correct password.

Three different causes all presented as "wrong password" that evening: the
mangled hash, a middleware defined on one container while four routers
referenced it (Traefik reads labels per container and fails closed), and a
frontend image built with production's URLs. Regenerating credentials fixed
none of them.

**The habit that saves the time is reading the proxy's own account first:**

```bash
docker logs traefik_nodo0 --since 10m 2>&1 | grep -i staging
```

It said `middleware "diagnosticar-staging-auth@docker" does not exist` the whole
time.

Scripts here therefore read individual keys with `sed` rather than sourcing the
env file.

### `/health` is not reachable at the root

Traefik routes the backend on `PathPrefix(/api)`, so a request to `/health`
never reaches the container. The handler is mounted at **both** `/health` and
`/api/health`; `ops/smoke.sh` takes the path from `SMOKE_HEALTH_PATH`.

### `tr -dc </dev/urandom | head -c N` dies under `set -e`

`tr` keeps reading after `head` exits, dies on SIGPIPE, and takes the script
with it — silently, often after generating a password and before printing it.
Bit both `make-staging-env.sh` and `seed-admin.sh`. Use
`head -c 256 /dev/urandom | tr -dc ... | cut -c1-N`.

### Staging shares production's tunnel to brainy

Both bridge to the same reverse SSH tunnel on host ports `18100` and `18120`.
Read-only inference calls, so sharing is fine and no change is needed on
brainy — but **if the tunnel is down, both environments lose the model
services**. Check with:

```bash
ss -ltnH '( sport = :18100 or sport = :18120 )'
```

### Symptom extraction on staging runs on nodo0, not brainy

Because the tunnel is shared, turning the Spanish symptom recognizer on in
brainy's gateway would turn it on for production. Staging runs its own
gateway instead — `hpo-recognizer`, a CPU container in this compose project —
and a Traefik router one priority above `hpo-tunnel`'s takes only
`/hpo-api/extract-hpo`. Search and specialties still go to brainy.

It starts **unrouted** (`HPO_RECOGNIZER_ROUTED` defaults to `false`), so a
deploy runs the container without sending it traffic. To switch it on, in
`.env.staging`, in this order:

1. `STAGING_JWT_ACCESS_PRIVATE_KEY` / `STAGING_JWT_ACCESS_PUBLIC_KEY` — an RSA
   pair (`openssl genrsa 2048`), each on one line with `\n` escapes, and
   `STAGING_JWT_ACCEPT_LEGACY_HS256=true` for one access-token lifetime (15
   min) so open sessions survive; then set it back to `false`. The gateway
   verifies sessions with the public half, so the backend must sign RS256
   before anything is routed — otherwise every extraction is a 401.
2. `STAGING_CLAUDE_CODE_OAUTH_TOKEN` — from `claude setup-token`.
3. `STAGING_TRUSTED_PROXIES` — Traefik's own address on
   `internal-nodo0-web` (172.22.0.7 on 2026-09-24:
   `docker inspect traefik_nodo0`). Not the network's CIDR: other teams'
   containers share it, and trusting them lets any of them forge
   `X-Forwarded-For`. Without this the per-IP limit keys on Traefik and one
   caller throttles everyone — which is also what a stale address looks like,
   so re-check it when extraction starts returning 429s.
4. `HPO_RECOGNIZER_TAG` — the image tag to run.

Run `ops/staging.sh up vX.Y.Z`, then check the container before routing:

```bash
docker exec diagnosticar-staging-hpo-recognizer-1 \
  python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/healthz').read().decode())"
```

`extract_hpo.ready` must be `true`; when it is not, `error` says why. Then set
`HPO_RECOGNIZER_ROUTED=true` and `up` again. Routing back is the same variable
set to `false` — nothing has to be stopped.

Every account on nodo0 can reach the Docker socket, so any of them can read
the container's environment, token included. Prefer a token from an account
used for nothing else.

### Gene ranking on staging runs on nodo0 too

For the same reason, staging has its own GenPhenAI: `genphenai`, with the
GenPhenia model inside (ONNX on the CPU, ~90 MiB, no secret). It is the
checkpoint brainy serves — `model-v3.0.0` of diagnostic.ar-model, pinned by
sha256 in the API's `services/genphenai/model.lock` — so rankings do not
change; its image tests compare them with production's before it ships.

It starts **unrouted** (`GENPHENAI_ROUTED` defaults to `false`). After
`ops/staging.sh up vX.Y.Z`, check it from inside the network:

```bash
docker exec diagnosticar-staging-genphenai-1 \
  python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:18020/healthz').read().decode())"
```

`status` must be `ok`, `checkpoint_sha256` must start `ee10aa42`, and
`specialties_available` must be `true`. Then set `GENPHENAI_ROUTED=true` in
`.env.staging` and `up` again: a router one priority above
`genphenai-tunnel`'s takes `/genphenai`. With both routed, staging no longer
reaches brainy for anything but the incumbent's search and specialties.
Routing back is the same variable set to `false`.

### Data rules

- **Synthetic data only.** Never restore a production dump. It would put
  clinical data on a host with weaker access control and there is no consent
  basis for it.
- **Separate JWT secrets**, generated fresh by `ops/make-staging-env.sh`.
  Sharing production's would let a staging session authenticate against
  production.
- **SMTP is left unset**, so no test run can email a real person.

---

## Where everything lives

```
nodo0
├── ~<usuario>/diagnostic.ar/diagnostic.ar-staging   the checkout
│   └── .env.staging                                  mode 600, gitignored
├── ~<usuario>/.docker/config.json                   GHCR pull credential
├── ~<usuario>/.ssh/id_ed25519_github                read-only deploy key
└── /etc/ssh/sshd_config.d/10-allowusers.conf         AllowUsers <usuario> <usuario>
```

Reach it with `ssh nodo0-diagnostic.ar` (user `<usuario>`).
`ops/NODO0_SAFETY.md` covers how not to break the host — it runs 62 containers
across 14 compose projects belonging to other teams. **Read it before touching
anything there.**

## Still missing

- **The wizard has never been run on staging.** That is the entire point of
  staging and the first thing to do.
- **No backup of staging.** Acceptable — the data is synthetic and
  `ops/staging.sh reset-db` recreates it.
- **`ops/deploy.sh` has never run**, on either environment. The rollback path
  is reasoned about, not exercised.
