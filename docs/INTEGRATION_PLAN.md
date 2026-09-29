# Integration plan — three modules, four days

Locked 2026-09-19. Baseline: `main` @ `e4a49ec`, `v0.4.0`.

The goal is not to ship all three. It is to **establish whether each module is
correct**, fix what is cheap to fix, and integrate them one at a time in the
right place. Order is by ascending risk, so the easy win lands first and the
riskiest change gets the most evidence behind it.

## Ground rules

1. **Local only. No deploys.** Nothing goes to staging or production without
   Mate's explicit go-ahead — not even staging. `npm run dev:mock` and local
   containers are the whole playground for these four days.
2. **One branch per repo per module.** Modules are worked on in their own
   repos; the integration lands in `diagnostic.ar` on its own branch.
3. **Sequential, not parallel.** Each module is proven before the next starts.
4. **Correctness first.** These modules were written by other people. Every one
   gets read and tested by us before a line of integration is written.
5. **No new browser-facing model call.** Anything with a per-call cost or an
   LLM behind it goes through the authenticated Express backend with rate
   limiting — never a `NEXT_PUBLIC_*` URL the browser hits directly.
6. **`frontend/mocks/fixtures.json` changes first.** It is the contract both
   `dev:mock` and Playwright import; update it before the code or E2E lies.
7. **Never `source` a venv named `.env/`** (the recognizer's is a directory),
   and never pass clinical text through a shell string.

---

## Day 1 — Gene explanation DB

Lowest risk, highest immediate user value: results gain a real Spanish
explanation of each gene instead of a bare symbol. No LLM, no new inference,
pure static lookup keyed on `simbolo` — the same key `/rank-genes` already
returns.

**Repo setup**
- `git init` in `gen-explanation-module/`, create the GitHub repo, first commit.
  It has **no history at all** today.
- **Decided 2026-09-21: the DB is never committed.** It is built locally and
  copied to the server with `scp`. `.gitignore` must exclude `*.db`. This makes
  the build scripts the deliverable, so **reproducibility becomes mandatory** —
  and `crear_db.py` cannot run today. See `docs/GENE_PROFILES.md`.

**Correctness**
- Re-verify the audit numbers (5,228 rows; 0 unparseable `raw_json`; 0.4%
  empty `resumen_es`; 10% with no associated diseases).
- ~~**Measure coverage against the real gene set.**~~ **Done 2026-09-21:
  165 of 5,267 symbols (3.1%) have no profile**, and they are not obscure —
  109 of them carry >100 HPO annotations each. Cause is HPO release drift, not
  aliases. Fillable from `ncbi_gene_id`, verified against NCBI. Full analysis
  and the recommended handling in `docs/GENE_PROFILES.md`.
- Spot-check ~10 genes against NCBI/OMIM for translation quality. The
  translation went through an undocumented Google endpoint; nobody has reviewed
  the Spanish output.
- Check for HTML entities, truncation, and the malformed markdown links visible
  in the readme sample (`[url](url)` nested inside the JSON reference fields).

**Improvements worth making now**
- Replace `ver_bd.py`'s 12-element tuple with a function returning a dict, and
  un-comment / convert its dead `__main__` block into a real test.
- **Rebuild the fetch stage.** `crear_db.py` only repairs-and-compiles a
  directory of per-gene JSONs that **does not exist here**; the script that
  queried NCBI/UniProt/OMIM was never part of this module. With the scp
  decision this is now the critical path, not a nicety.
- Add a `NOT NULL`/empty-string report so gaps are visible rather than silent.

**Integration**
- Serve it from the **Express backend**, not the browser: a new authenticated,
  rate-limited route (e.g. `GET /api/genes/:symbol`) reading the SQLite file
  read-only. This keeps the DB server-side and reuses the auth, rate limiting
  and `requireAdmin` patterns already in place.
- Decide SQLite-as-file vs. loading the rows into Postgres. SQLite read-only is
  simpler and avoids a migration; Postgres avoids shipping a binary and gives
  one datastore. **Recommendation: SQLite read-only first**, since it needs no
  migration and no change to the deploy.
- Frontend: extend the results screen to show summary, protein function and
  associated diseases per ranked gene, in Spanish. Respect the existing rule
  that everything user-facing is Spanish, and that this is **never presented as
  a diagnosis**.
- Add fixtures to `frontend/mocks/fixtures.json` and an E2E assertion.

**Done when:** the wizard shows a Spanish gene explanation for a mocked
`/rank-genes` result, coverage is a known number, backend tests and E2E pass
locally.

---

## Day 2 — Question agent, part 1: the Orphanet bridge

**This module cannot be integrated until a mismatch is resolved**, so day 2 is
spent on that rather than on wiring.

**The problem.** The agent's `POST /sessions` expects
`top_candidates: [{name, orpha_code, score}]` — Orphanet **disease** codes.
`/rank-genes` returns **gene symbols** (`CFTR`). We have no Orphanet codes to
give it.

**Options, to be decided with evidence:**
1. **Bridge gene → Orphanet disease.** `data/en_product6.xml` (Orphanet
   gene–disease associations) is already in the agent's repo. Measure how many
   of our ranked genes map to indexed diseases.
2. **Re-key the agent on HPO terms instead of diseases.** We *do* have HPO
   terms — they are the wizard's input to ranking. This may fit our data better
   and is worth costing, since the agent's questions are already HPO-anchored.
3. **Drive it from `case_text` alone**, letting it retrieve over the full
   corpus and ignoring our ranking. Weakest — it discards our model's signal.

**Recommendation: measure option 1 first**, because it preserves the agent's
design and needs no changes to its internals; fall back to option 2 if coverage
is poor.

**Also on day 2**
- Create a venv and get `pytest` **actually passing** — it currently fails at
  collection (`No module named 'langchain_core'`). Nobody has seen these tests
  green.
- Run `cli stats` to get the real indexed-disease count, and `cli index` to
  build Chroma once, recording how long it takes and how much disk it uses.
- Replace the PowerShell-only `scripts/*.ps1` with POSIX equivalents or a
  Makefile — we deploy Linux.
- **Resolve embeddings.** Codex provides none. Ollama is already on this box and
  already used by the current pipeline, making it the natural choice. Decide and
  record it.
- Prune `data/`: the agent reads `en_product4.xml` (and possibly
  `en_product6.xml`); `mondo.*`, `hp-full.*`, PDFs and drug tables are dead
  weight in an image.

**Done when:** tests pass locally, the Chroma index builds, the gene→disease
coverage number exists, and the keying decision is recorded here.

---

## Day 3 — Question agent, part 2: integration

**Where it belongs.** After the first ranking, before the final result — an
optional refinement loop. The user gets a ranking, answers a few questions, and
the ranking is recomputed with the additional HPO terms.

**Architecture**
- The agent runs as its **own container** (FastAPI, port 8010) alongside the
  existing services.
- **The browser must not call it directly.** It is LLM-backed and costs money
  per call, so Express proxies it: new authenticated, rate-limited routes, with
  the session tied to the authenticated account. This is a departure from how
  `/extract-hpo` and `/rank-genes` are reached today, and it is deliberate.
- Session state lives in the agent for now; persisting the Q&A into
  `diagnoses` is a **schema decision deferred** to a later pass. Note that
  answers are clinical data and fall under the same rules as everything else in
  that table.
- Use the codex adapter (`LLM_ACCESS.md`) for question generation. Expect
  latency well above 10s, so the UI needs an async/pending state — not a
  blocking spinner on a synchronous request.

**Safety, non-negotiable**
- Questions are **suggestions to discuss with a doctor**, never diagnostic
  steps. The existing disclaimer rules apply to every new screen, and an E2E
  test must assert it as the results screen already does.
- Keep the agent's own guardrails intact: certainty capped at 70 with
  unexplained phenotypes, certainty allowed to fall, "no concluyente" as a
  legitimate outcome.
- Cap iterations, and let the user skip the loop entirely at any point.

**Done when:** a local end-to-end run answers questions and produces a refined
ranking through `dev:mock`, with the disclaimer asserted and rate limiting
covered by a backend test.

### Status — 2026-09-26: backend side built

The agent was rewritten (v2, `MarBL00126/diagnosticar-question-agent`) and is
now keyed on HPO terms and genes, so the Orphanet bridge of day 2 is moot. It
is **stateless**: `POST /v1/rounds` receives the whole session every call.

What landed in this repository:

- **Routes** (`backend/src/routes/questions.ts`), all authenticated:
  `GET /api/questions/status` → `{enabled}`; `POST /api/questions/rounds`
  starts, answers or finishes a session; `GET /api/questions/:diagnosisId`
  returns it for resuming after a reload. The browser never reaches the agent.
- **Persistence, decided:** the session is stored with its diagnosis, in the
  nullable JSONB column `diagnoses.preguntas_respuestas`
  (`{version: 2, finished, rounds: [{round, mode, questions, answers,
  response}]}`), under the same ownership rules as the rest of the row. The
  agent's validated response is stored whole, including its `versions`, so a
  stored refinement can be traced to the knowledge base and model behind it;
  `versions` is not sent to the browser. Stored sessions are read with a
  schema more lenient than the agent's contract (version 1 sessions, with one
  mode for the whole session and `separates` on questions, are migrated on
  read); one that still cannot be read answers 409, not 500. Saves are
  compare-and-set against the value read, so two writers cannot overwrite each
  other's rounds.
- **Mode per round:** each POST's `mode` is what the agent is asked for, so
  the "Ver detalle médico" switch changes the wording from the next round on;
  every round, stored and returned, carries the mode it was written in.
  `genesIfYes`/`genesIfNo` (≤ 5 genes each) are clinician-mode only.
- **Readings:** every earlier answer is sent back with the reading the agent
  first gave it (`effective_answer`, `note_summary`), so a note is read once.
- **Evidence sent to the agent** is rebuilt from the saved diagnosis, never
  taken from the browser: present = the codes in `symptoms_extracted` (what
  `/rank-genes` actually received, manual additions included); absent = the
  `negated` entries of `phenotypes` not also present.
- **Guards:** two spend caps, counted in Postgres (`question_agent_rounds`:
  account id and time only, pruned after 7 days) so restarts and replicas
  share them — `QUESTION_AGENT_ROUNDS_PER_HOUR` per account (default 20) and
  `QUESTION_AGENT_GLOBAL_ROUNDS_PER_5H` for the whole deployment (default 50
  per rolling five hours), checked and recorded under one advisory lock so
  concurrent requests cannot both take the last slot. Only rounds sent to the
  agent count; one the agent refuses before starting (`busy`,
  `no-known-hpo-ids`) is given back. Also a per-minute request limit, one
  round in flight per account and backend process,
  `QUESTION_AGENT_TIMEOUT_MS` (default 100 s,
  above the agent's 10 s queue + 75 s round budget + 10 s model timeout), responses validated
  with zod and capped at 1 MB before buffering, upstream bodies never
  forwarded. A retried round with no answers, or the same answers or `finish`
  resent after a lost response, is replayed from the database, not re-asked.
- **Agent errors** reach the browser as: `no-known-hpo-ids` → 400
  `no_usable_symptoms`; `busy` / `model-unavailable` → 503 `unavailable` with
  the agent's `Retry-After` (at most 60 s); `invalid-request`, 401, 413, 500,
  network failures and contract breaks → 503 `unavailable`; timeout → 504
  `timeout`.
- **Error bodies** from `/api/questions/*` are `{error, code}`: `error` is the
  Spanish text to show, `code` is what the frontend branches on, so the
  wording can change without breaking it.

  | Status | `code` | When |
  |---|---|---|
  | 400 | `invalid_request` | The body does not have the expected shape |
  | 400 | `answers_mismatch` | Answers do not cover exactly the pending questions |
  | 400 | `no_usable_symptoms` | The diagnosis has no coded symptoms, or the agent knows none of them |
  | 404 | `not_found` | No such diagnosis, not the caller's, or a malformed id |
  | 409 | `finished` | The session already finished |
  | 409 | `conflict` | The session changed (another tab or process) during the round |
  | 409 | `unreadable_session` | The stored session cannot be read |
  | 429 | `rate_limited` | The account's hourly round cap or the per-minute request limit; `Retry-After` set |
  | 429 | `global_limit` | The deployment-wide cap (`QUESTION_AGENT_GLOBAL_ROUNDS_PER_5H`); `Retry-After` is when the oldest round in the five-hour window ages out |
  | 429 | `round_in_flight` | Another round is already running for the account; `Retry-After` set |
  | 500 | `internal` | Anything unexpected |
  | 503 | `disabled` | The feature is off (`QUESTION_AGENT_URL` unset) |
  | 503 | `unavailable` | The agent is unreachable, refused, or broke the contract |
  | 504 | `timeout` | No answer within `QUESTION_AGENT_TIMEOUT_MS` |
- **Infra:** compose service `question-agent` behind a profile (local and
  staging, off by default, not on `traefik_net` on staging); release job
  `publish-question-agent`, skipped until `.github/question-agent.env` pins a
  commit.

Still open: the frontend (separate branch), pinning the agent's commit and
deploy key, and a first run on staging — which needs Mate's go-ahead. The
compose service already uses the agent's own `PREGUNTAS_*` settings.

---

## Day 4 — Symptom recognizer

Highest risk by a distance: it **replaces** the current text→HPO path, which is
the front door of the entire product. Everything downstream depends on its
output.

**The one test that decides this**
- **Score the current pipeline and the recognizer on the same 8 histories.**
  The current path (Qwen2.5 extraction → NLLB translation → `es-index`
  matching) has never been run on this benchmark. Until both numbers exist
  side by side, **we cannot claim the replacement is an improvement**, and
  the module's own best end-to-end F1 is only ~0.75 on ~59 gold mentions.
- Treat that 0.75 as a ranking signal, not a production estimate. Two or three
  matches move it several points.

**Contract gaps to close before it can replace anything**
- `scan()` returns `(mention, hpo_code)`. `/extract-hpo` must return full
  `PhenotypeItem`s: `label`, `label_es`, `span_es`/`span_en`,
  `start_es`/`end_es`/`start_en`/`end_en`, `negated`, `confidence`,
  `matched_by`. **Offsets and negation do not exist in `scan()`.**
- **Negation is a patient-safety requirement, not formatting.** The current
  system has `services/phenotyper/negation.py`; "no presenta convulsiones" must
  not yield a positive HP:0001250. Either add a negation stage or keep the
  existing one in front. **This blocks replacement outright.**
- Decide which stages run locally vs. via LLM. Local weights (ClinLinker /
  SapBERT) mean models to host and cold-start cost; LLM means latency and the
  codex constraints. The benchmark's best config uses an LLM for mapping with
  `claude-opus-5`.

**Strategy**
- Implement behind a **feature flag in the API gateway**, so `/extract-hpo` can
  serve either implementation and they can be compared on identical input.
  Do **not** delete the existing pipeline in this pass.
- Do not touch `symptoms_recognizer/entity-normalization/` — dead code by the
  module's own `AGENTS.md`.
- Do not edit `tests/dataset/historia_*` — it is the append-only ground truth
  behind every past comparison.
- Note this lands in `diagnostic.ar-api` (brainy), which **has no CI pipeline
  at all**. Its `tests/` directory is groundwork; adding CI there is the
  obvious follow-on and is out of scope for these four days.

**Done when:** both implementations are scored on the same data, the negation
question is answered, and the flag lets us switch locally. **Replacement itself
is a separate, evidence-led decision — not a day-4 deliverable.**

---

## What is explicitly out of scope

- **Any deploy.** Staging and production both need Mate's explicit go-ahead.
- Deleting the current extraction pipeline.
- CI for `diagnostic.ar-api` (needed, but not these four days).
- ~~Persisting question-agent Q&A into `diagnoses` (schema decision).~~
  Decided 2026-09-26: `diagnoses.preguntas_respuestas`, see day 3's status.
- Solving codex authentication for containers on nodo0 — see `LLM_ACCESS.md`.
  Codex-backed paths are a **local story** until that is answered.

## Open decisions for Mate

1. **34 MB `genes_v4.db`** — commit, Git LFS, or fetch at build time?
2. **Gene DB storage** — SQLite read-only (recommended) or into Postgres?
3. **Question agent keying** — gene→Orphanet bridge, or re-key on HPO?
4. **Embeddings** — Ollama locally (recommended), or an API key for embeddings
   only? Codex cannot do it.
5. **Codex in production** — mounted credential, a proxy to TARS, or an API key
   after all?
