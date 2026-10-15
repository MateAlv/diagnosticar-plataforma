# Staging

A full copy of production on the same node, with its own database. It exists for one reason CI cannot cover: **it is the only place the
real HPO and GenPhenAI services are exercised before production.** CI stubs
them, so anything touching the model path is genuinely untested until it runs
here.

**https://staging.diagnosticar.infra.cluster.qb.fcen.uba.ar** — every release
tag deploys here by itself; `ops/deploy.sh staging --status` on nodo0 says
which one is running.

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
make ci ──► PR ──► main ──► tag vX.Y.Z ──► release.yml ──────────► GHCR
(local)                                    CI, then the 6 images     │
                                                                     ▼
                                nodo0, cron every 5 min: ops/deploy.sh staging
                                pull · up · smoke, or back to the previous release
```

Nothing is built on nodo0 and nothing reaches into it: the node asks GitHub for
new tags and pulls images CI already tested and scanned. `CI_CD.md` has the
whole pipeline.

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

A release deploys itself. Within five minutes of its last image reaching GHCR,
cron on nodo0 runs `ops/deploy.sh staging`, which checks out the tag, runs
`ops/staging.sh up vX.Y.Z` and `ops/staging.sh smoke`, and goes back to the
release that was running if the smoke test fails. Each tag is tried once; a
failed one is fixed forward with the next tag.

By hand, on nodo0 in `~/diagnostic.ar/diagnostic.ar-staging`:

```bash
ops/deploy.sh staging --status     # what runs, the newest tag, the end of the log
ops/deploy.sh staging v0.10.0      # deploy a published release now, also an older one
ops/deploy.sh staging --rollback   # back to the release before the current one
```

Its log and state are in `~/.local/state/diagnosticar/staging/`. Deploy through
`ops/deploy.sh`, not `ops/staging.sh up`, so it knows what runs and can go back.
A deploy does not start with less than 20 GiB free in Docker's root dir (`/data`)
or 5 GiB under `/home`; both disks are shared with other teams.

`ops/staging.sh up` with no tag builds the working tree on the node. Useful for
"does my branch survive the real model services", but it compiles on a host
running 65 containers and ships something no CI run ever scanned. Prefer a tag.

Until 2026-10-15 releases were also built by hand on TARS and loaded over SSH
(the `-manual` tags), while the account's Actions minutes ran out; the
procedure is in this file's history. The pipeline replaces it.

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

### What extraction may spend

Every extraction runs several calls to `claude-opus-5` on Mate's Claude Max
subscription — measured at US$0.34–1.89 of API-equivalent usage each, US$0.94
on average. A global budget in the recognizer caps how many run:

| `.env.staging` | Default | Meaning |
|---|---|---|
| `RECOGNIZER_GLOBAL_PER_5H` | 40 | extractions per rolling 5 hours, whole site |
| `RECOGNIZER_GLOBAL_PER_WEEK` | 1344 | the same rate over a week (40 × 168 / 5): no limit of its own |
| `RECOGNIZER_USER_PER_HOUR` / `_PER_DAY` | 20 / 60 | per account |

Mate's two requirements (2026-09-28): at least 40 extractions per 5 hours,
and ideally no more than 15% of the subscription — **when they conflict, the
40 wins.** At the measured cost, 40 extractions are ~US$38 of API-equivalent
usage per 5 hours; whether that is above 15% of a Max session is not
published and has to be measured: diagnostic.ar-api's
`docs/EXTRACTION_LIMITS.md` ("Calibration") has the procedure. If it is above,
the lever is the cost per extraction, not the cap.

The count lives on the `staging_recognizer_state` volume, so a redeploy does
not reset the week. How much is left:

```bash
docker exec diagnosticar-staging-hpo-recognizer-1 python -c "import urllib.request,json; print(json.loads(urllib.request.urlopen('http://127.0.0.1:8000/healthz').read())['extraction_budget'])"
```

When it runs out, the wizard says so and points to the symptom search, which
spends nothing.

### Gene ranking on staging runs on nodo0 too

For the same reason, staging has its own GenPhenAI: `model`, with the
GenPhenia model inside (ONNX on the CPU, ~90 MiB, no secret). It is the
checkpoint brainy serves — `model-v3.0.0` of diagnostic.ar-model, pinned by
sha256 in the API's `services/genphenai/model.lock` — so rankings do not
change; its image tests compare them with production's before it ships.

It starts **unrouted** (`MODEL_ROUTED` defaults to `false`). After
`ops/staging.sh up vX.Y.Z`, check it from inside the network:

```bash
docker exec diagnosticar-staging-model-1 \
  python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:18020/healthz').read().decode())"
```

`status` must be `ok`, `checkpoint_sha256` must start `ee10aa42`, and
`specialties_available` must be `true`. Then set `MODEL_ROUTED=true` in
`.env.staging` and `up` again: a router one priority above
`genphenai-tunnel`'s takes `/genphenai`. With both routed, staging no longer
reaches brainy for anything but the incumbent's search and specialties.
Routing back is the same variable set to `false`.

### Follow-up questions (question agent)

`question-agent` refines a saved ranking with up to three rounds of yes/no
questions. Only the backend calls it (`/api/questions/*`), so it has **no
Traefik labels and is not on `traefik_net`**: that network is shared with other
teams' containers, and every round spends LLM quota. It sits on the project's
default network, which is why `model` joins that network too — the agent
ranks through `http://model:18020`.

Every release builds its image and staging always runs it (the base compose
file's `question-agent` profile is reset in `docker-compose.staging.yml`). The
image comes from two pins: the agent's code (`MarBL00126/diagnosticar-question-agent`) at
`QUESTION_AGENT_COMMIT` in `.github/question-agent.env`, and the Dockerfile
(`services/question-agent/Dockerfile` in diagnostic.ar-api) at `GATEWAY_COMMIT`
in `.github/recognizer.env`, checked out with the `QUESTION_AGENT_DEPLOY_KEY`
and `API_DEPLOY_KEY` secrets (see `CI_CD.md`). It needs, in `.env.staging`:

1. `QUESTION_AGENT_TOKEN` — `openssl rand -hex 32`. The backend runs with
   `NODE_ENV=production`, so it refuses to boot with the URL set and no token
   of 32+ characters. Compose hands the same value to the agent as
   `PREGUNTAS_SERVICE_TOKEN`, the `X-Internal-Token` it expects.
2. `STAGING_CLAUDE_CODE_OAUTH_TOKEN` — the same one hpo-recognizer uses,
   passed to the agent as `CLAUDE_CODE_OAUTH_TOKEN` for its default
   `claude-cli` provider.
3. `QUESTION_AGENT_URL=http://question-agent:8010`.

`QUESTION_AGENT_TAG` pins its image apart from the release, to roll the agent
back alone. Switching it off is `QUESTION_AGENT_URL=` and a redeploy of the
running tag (`ops/deploy.sh staging vX.Y.Z`): the backend answers
`GET /api/questions/status` with `{"enabled": false}` and the UI hides the
feature.

The agent reads its settings from `PREGUNTAS_*` variables, set in
`docker-compose.yml`; the staging file only points
`PREGUNTAS_MODEL_SERVICE_URL` at `model`. `PREGUNTAS_LLM_PROVIDER` and
`PREGUNTAS_LLM_MODEL` default to `claude-cli` and `claude-opus-5`. The rest
(`PREGUNTAS_LLM_EFFORT`, `PREGUNTAS_LLM_TIMEOUT_S`,
`PREGUNTAS_MODEL_SERVICE_TIMEOUT_S`, `PREGUNTAS_MAX_CONCURRENT_ROUNDS`,
`PREGUNTAS_LOG_LEVEL`) reach the container only when `.env.staging` sets
them; otherwise the agent keeps its own defaults. The exception is
`PREGUNTAS_ROUND_BUDGET_S`, always set from `QUESTION_AGENT_ROUND_BUDGET_S`
(default 75), because the backend's timeout is sized against it:

> **Invariant:** `QUESTION_AGENT_TIMEOUT_MS` (default 100 s) must exceed the
> agent's worst case — its queue wait (10 s) + the round budget (75 s) + its
> model-service timeout (10 s), 95 s by default — plus a margin. If it does not, the backend gives
> up on a round the agent then finishes: the reader sees a timeout and the
> LLM quota is spent for nothing. Raise both together.

**Spend caps.** Every round spends the Claude subscription behind
`STAGING_CLAUDE_CODE_OAUTH_TOKEN`, so the backend caps them twice:
`QUESTION_AGENT_ROUNDS_PER_HOUR` per account (default 20) and
`QUESTION_AGENT_GLOBAL_ROUNDS_PER_5H` for the whole deployment, every account
together (default 50 per rolling five hours). Past either one a round is a 429
— `rate_limited` or `global_limit` — with `Retry-After` set to when the oldest
round in that window ages out, and the agent is not called. Only rounds sent to
the agent count: replays of a saved round, rejected requests and rounds the
agent refused before starting (`busy`, `no-known-hpo-ids`) do not. The rounds
are rows in the `question_agent_rounds` table (account id and time, nothing
clinical, pruned after 7 days), so a redeploy does not reset the budget; both
caps must be positive integers and cannot be switched off. The count is per
database: staging and production each have their own, so if both run the agent
on one subscription it can spend up to both budgets. To see how much of the
global budget is spent:

```bash
docker exec diagnosticar-staging-db-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c \
  "SELECT count(*) FROM question_agent_rounds WHERE created_at > now() - make_interval(hours => 5)"'
```

`PREGUNTAS_PORT` is fixed at 8010, which the backend URL and the compose
healthcheck (`GET /healthz`, with python since the image has no curl) both
rely on. To check it by hand:

```bash
docker inspect --format '{{.State.Health.Status}}' diagnosticar-staging-question-agent-1
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
├── ~<usuario>/.local/state/diagnosticar/staging/   deploy state and log
├── crontab of <usuario>                             */5 ops/deploy.sh staging
├── ~<usuario>/.docker/config.json                   GHCR pull credential
├── ~<usuario>/.ssh/id_ed25519_github                read-only deploy key
└── /etc/ssh/sshd_config.d/10-allowusers.conf         AllowUsers <usuario> <usuario>
```

Reach it with `ssh nodo0-diagnostic.ar` (user `<usuario>`).
`ops/NODO0_SAFETY.md` covers how not to break the host — it runs 62 containers
across 14 compose projects belonging to other teams. **Read it before touching
anything there.**

## Still missing

- **Nobody has run the whole wizard on staging by hand since v0.9.5-manual.**
  CI and the smoke test cover the paths, but a person should go through a real
  search once: text → symptoms → genes → specialties → questions → logout.
- **No backup of staging.** Acceptable — the data is synthetic and
  `ops/staging.sh reset-db` recreates it.
- **The way back has only run in a simulation.** `ops/deploy.sh` returns to
  the previous release when the smoke test fails; that branch was exercised
  against a fake checkout and a fake Docker (2026-10-15), not the real stack.
