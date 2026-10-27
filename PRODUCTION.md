# Production

**https://diagnosticar.infra.cluster.qb.fcen.uba.ar**, compose project
`diagnosticar` on nodo0.

Production runs the same images as staging, under its own names and host
(`docker-compose.prod.yml`). Every service runs on nodo0, and nothing goes
through an SSH tunnel to brainy. It never follows tags by itself: it moves
when a person runs `ops/deploy.sh production`, from a terminal, as
`<usuario>`, and it only takes the release staging runs at that moment.

```
nodo0, project diagnosticar
├── frontend         diagnosticar-frontend (production URLs compiled in)
├── backend          diagnosticar-backend
├── db               postgres:15, volume diagnosticar_postgres_data
├── hpo-recognizer   /hpo-api: extraction, Spanish symptom search, specialties
├── model            /genphenai: model-v4.0.0
└── question-agent   follow-up questions, reached only by the backend
```

---

## Shipping what staging runs

Once everything below is set up, this is the whole procedure:

```bash
ssh nodo0                                   # then become <usuario>
cd ~/diagnostic.ar-production
ops/deploy.sh production                    # type the tag it shows to confirm
```

It asks staging which release it runs (`/api/health` reports it), checks every
image is on GHCR, and asks you to type that tag. Then:

1. `pg_dump` of production into `~/backups/diagnosticar/`, mode 600. If the
   dump fails or cannot be read back, nothing is deployed.
2. Checks out the tag, pulls its five images and recreates the containers.
3. Runs the smoke test against the public host, including symptom search,
   extraction readiness and gene ranking.
4. If the smoke test fails, it goes back to the release that ran before.

`ops/deploy.sh production --status` says what runs and shows the end of the
log. `ops/deploy.sh production --rollback` goes back one release, asking the
same confirmation.

---

## Setting it up, once

Everything here runs as `<usuario>` on nodo0. The hand-built checkout in
`~/nodo0-server/services/diagnostic.ar` stays as it is: it is the way back
(see *Going back to the hand-built stack*).

### 0. Before anything

- **Close the old `.env`.** It is mode 664 under a home that is 775, so every
  account on nodo0 can read the database password and the signing secrets:
  `chmod 600 ~/nodo0-server/services/diagnostic.ar/.env`.
- **Staging runs a release with this file in it** and its smoke test passed.
  That release is the one production will take.

### 1. A checkout of the repository

The repository is private, so `<usuario>` needs its own read-only deploy key:

```bash
ssh-keygen -t ed25519 -N '' -C 'nodo0 <usuario> diagnostic.ar' -f ~/.ssh/id_ed25519_diagnosticar
cat ~/.ssh/id_ed25519_diagnosticar.pub
```

Add it in GitHub, MateAlv/diagnostic.ar → Settings → Deploy keys, **without**
write access. Then:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github-diagnosticar
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_diagnosticar
  IdentitiesOnly yes
EOF
git clone github-diagnosticar:MateAlv/diagnostic.ar.git ~/diagnostic.ar-production
cd ~/diagnostic.ar-production
git checkout --detach vX.Y.Z                # the release staging runs
cp ~/nodo0-server/services/diagnostic.ar/.env .env
chmod 600 .env
```

The gene descriptions are a file, not part of any image. Copy the one staging
uses into `data/genes.db` (from TARS: `scp genes.db nodo0:` and move it in as
`<usuario>`). Without it production runs and genes show no description.

### 2. The secrets the new services need

```bash
ops/make-production-env.sh
```

It adds to `.env`, without printing them or touching any key already there:
the RS256 key pair the backend signs sessions with and `hpo-recognizer`
verifies them with, the question agent's internal token, `TRUSTED_PROXIES`
(Traefik's address) and `JWT_ACCEPT_LEGACY_HS256=true`. It leaves one value for
a person, the Claude credential, which is a decision:

- `CLAUDE_CODE_OAUTH_TOKEN`, from `claude setup-token`: a subscription, as
  staging and the AWS copy use. Shared with staging, it shares the quota too.
- `ANTHROPIC_API_KEY`, an organisation key, with `RECOGNIZER_PROVIDER=anthropic`
  and `PREGUNTAS_LLM_PROVIDER=anthropic`. It can be capped by spend in
  Anthropic's console.

The extraction limits default to staging's (`STAGING.md`, *What extraction may
spend*); the same variables in `.env` change them for production.

### 3. Pulling from GHCR

The images are private. Log in once with a classic token that has only
`read:packages`, from the same account whose token staging uses (never a
personal account):

```bash
docker login ghcr.io -u <account>
```

### 4. Prove a backup restores

```bash
ops/production.sh backup
ops/production.sh rehearse-restore "" vX.Y.Z
```

The second command restores the newest dump into a throwaway Postgres with no
network and its data in memory, counts users, patients and diagnoses against
production's, runs the migrations of `vX.Y.Z` on the copy and counts again. It
must end in `RESTORE REHEARSAL PASS`. It touches no volume, and production's
database only to count rows; the copy disappears when it ends.

Repeat it every quarter. An unverified backup is not a backup.

### 5. The first deploy

```bash
ops/deploy.sh production
```

Watch it. This first one also removes `diagnosticar-hpo-tunnel-1` and
`diagnosticar-genphenai-tunnel-1`, which the new compose file no longer has.
From then on production no longer uses brainy.

If the smoke test fails here there is no earlier release to go back to; use
*Going back to the hand-built stack*.

### 6. After the first deploy

- **After 15 minutes** (one access-token lifetime), set
  `JWT_ACCEPT_LEGACY_HS256=false` in `.env` and run `ops/deploy.sh production`
  again with the same tag.
- **Check the model** from a diagnostic.ar-api checkout:
  `python3 services/genphenai/check_deployed.py https://diagnosticar.infra.cluster.qb.fcen.uba.ar/genphenai`
  must print `all checks passed`.
- **Do one real search** in a browser: text → symptoms → genes → specialties
  → questions → logout.

People who already have an account are asked once to accept the terms
(`/terminos`), the consent to process health data that staging already asks
for.

---

## Going back

**To the previous release:** `ops/deploy.sh production --rollback`.

The migrations only add columns and tables, so an older backend runs on a newer
schema. They also clear `diagnoses.source_ip` and `user_agent` (CLAUDE.md,
open issue 4), which no rollback brings back.

### Going back to the hand-built stack

Only for the first deploy. The old images, `diagnosticar-backend:latest` and
`diagnosticar-frontend:latest`, are still on the host; never prune them until
production has run from GHCR for a while.

```bash
cd ~/nodo0-server/services/diagnostic.ar
docker compose -p diagnosticar -f docker-compose.yml -f docker-compose.prod.yml up -d --no-build --remove-orphans
```

That brings back the two tunnel containers and the old backend and frontend,
and removes the three new services. It needs the SSH tunnels from brainy to be
up (`ss -ltnH '( sport = :18100 or sport = :18120 )'`).

### Restoring the database

The last resort, only if a migration damaged data. It replaces production's
data with the dump's, so everything written after the dump is lost. Rehearse
it first (step 4), with the same dump:

```bash
docker compose -p diagnosticar --env-file .env -f docker-compose.yml -f docker-compose.prod.yml \
  exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' \
  < ~/backups/diagnosticar/diagnosticar-<when>-before-<tag>-from-<previous>.dump
```

---

## Where everything lives

```
nodo0, as <usuario>
├── ~/diagnostic.ar-production                 the checkout, detached on a release tag
│   ├── .env                                   mode 600, gitignored
│   └── data/genes.db                          gene descriptions
├── ~/backups/diagnosticar/                    mode 700; one dump before every deploy
├── ~/.local/state/diagnosticar/production/   deploy state and log
├── ~/.docker/config.json                      GHCR pull credential
├── ~/.ssh/id_ed25519_diagnosticar             read-only deploy key
└── ~/nodo0-server/services/diagnostic.ar      the old hand-built checkout: the way back
```

The dumps are not rotated. Each is a few megabytes; check
`du -sh ~/backups/diagnosticar` now and then, since `/` is shared with every
team on the host.
