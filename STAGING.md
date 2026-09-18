# Staging

A full copy of production on the same node, behind basic auth, with its own
database. It exists for one reason CI cannot cover: **it is the only place the
real HPO and GenPhenAI services are exercised before production.** CI stubs
them, so anything touching the model path is genuinely untested until it runs
here.

**https://staging.diagnosticar.infra.cluster.qb.fcen.uba.ar** — running
`v0.3.1` as of 2026-09-18.

---

## Getting in

Two prompts, two unrelated credentials. This confuses everyone the first time.

| Prompt | What it is | Credential |
|---|---|---|
| Browser popup | Traefik basic auth, in front of the whole site | `equipo` / *see the team password manager* |
| App login page | The application's own accounts | your admin account |

The popup is not part of the application. It gates the host so staging stays
off the public internet and out of search indexes — without it,
`staging.diagnosticar…` is publicly reachable. It runs before any application
code, which is why it also covers `/api`, `/hpo-api` and `/genphenai`: without
it those paths would be an unauthenticated public route to the GPU node.

Both credentials live in the password manager, not in this repository. The
basic-auth password is also in `.env.staging` on the node
(`STAGING_SMOKE_PASSWORD`), readable only by `<usuario>`.

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
ops/staging.sh up v0.3.1     # a released tag — what production will run
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

### The two passwords

Every first-time user reports "the login is broken" when they mean the popup.
See the table above.

### `$$` in the basic-auth hash

`STAGING_BASIC_AUTH` holds an htpasswd line whose dollars are **doubled** so
compose interpolation leaves them alone. Two consequences:

- Generate it with `htpasswd -nb equipo 'pass' | sed -e 's/\$/\$\$/g'`. A single
  `$` gets eaten and every login silently fails.
- **Never `source` the file from a shell script.** To bash, `$$` is the process
  id: the hash reaches Traefik as `equipo:1865433apr11865433`, Traefik cannot
  parse the middleware, drops it, and every route answers 401 — with a correct
  password. `ops/staging.sh` reads the values it needs with `sed` for exactly
  this reason.

The failure points the wrong way. 401 reads as a bad password, so the instinct
is to regenerate the hash, which changes nothing. **Read Traefik's logs first**:

```bash
docker logs traefik_nodo0 --since 10m 2>&1 | grep -i staging
```

It says `middleware "diagnosticar-staging-auth@docker" does not exist` when the
hash is corrupt, which is the actual diagnosis.

### Traefik middleware must be defined on every service that references it

Traefik reads labels per container. A router whose middleware is defined on a
*different* container cannot resolve it and fails closed — 401 everywhere. All
four staging services therefore carry an identical
`traefik.http.middlewares.diagnosticar-staging-auth.basicauth.users` label.
Traefik accepts duplicate identical definitions.

### `/health` is not reachable at the root

Traefik routes the backend on `PathPrefix(/api)`, so a request to `/health`
never reaches the container. The handler is mounted at **both** `/health` and
`/api/health`; `ops/smoke.sh` takes the path from `SMOKE_HEALTH_PATH`.

### `smoke` needs the password in plaintext

An htpasswd hash cannot authenticate a request, so `.env.staging` carries
`STAGING_SMOKE_PASSWORD` alongside the hash. Both must be the **same** password
— they are generated together, and a mismatch shows up as a smoke suite that
401s on a perfectly healthy stack.

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
