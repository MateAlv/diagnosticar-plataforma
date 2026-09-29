# The three incoming modules — inspection notes

Written 2026-09-19, after reading each module and running what could be run
locally. This is the factual baseline: what each module **is**, what it
actually produces, and what is wrong or missing. The sequencing lives in
`INTEGRATION_PLAN.md`; the LLM-access decision in `LLM_ACCESS.md`.

None of this has been deployed anywhere. Nothing below has run against
staging or production.

---

## Where the modules live

All three sit beside this repo on the dev box TARS, under `~/diagnostic.ar/`:

| Module | Path | Git remote |
|---|---|---|
| Gene explanation DB | `gen-explanation-module/` | **none — not a repo yet** |
| Question agent | `diagnosticar-question-agent/` | `MarBL00126/diagnosticar-question-agent` |
| Spanish symptom recognizer | `spanish-symptoms-recognizer/` | `GMBUST-FIUBA/spanish-symptoms-recognizer` |

Two neighbours are **not** modules and should not be confused with them:
`gen-back/` and `gen-front/` are the existing GenPhenIA API and frontend
release, and `ig-diagnoser/` is a separate symptom-questioning experiment
(`MateAlv/diagnostic-ar-symptom-questioning`).

---

## What the platform does today, and why it matters for all three

The wizard in `frontend/src/app/nuevo/page.tsx` calls the model services
**directly from the browser**:

```
frontend/src/app/nuevo/page.tsx
  → NEXT_PUBLIC_HPO_API_URL      /extract-hpo      text_es → phenotypes[]
  → NEXT_PUBLIC_HPO_API_URL      /hpo/es/search    autocomplete
  → NEXT_PUBLIC_GENPHENAI_URL    /rank-genes       hpo_ids → genes + specialties
```

The Express backend never calls them; it only **stores** what the browser
already computed (`symptoms_extracted`, `phenotypes`, `genphen_genes`,
`genphen_specialties`, `genphen_confidence`).

Three consequences that constrain every integration below:

1. **`NEXT_PUBLIC_*` is compiled in at build time.** Any new service the
   browser must reach needs its own repository variable *and* a new frontend
   image per environment. Adding a URL to `.env` on the node does nothing.
2. **Anything the browser calls is effectively public.** `/extract-hpo` and
   `/rank-genes` already answer 200 to anonymous callers. A module that costs
   money per call (any LLM path) must **not** be exposed this way — it has to
   sit behind the authenticated Express backend with rate limiting.
3. **The response shapes in `frontend/mocks/fixtures.json` are the contract.**
   Both `dev:mock` and the Playwright suite import that file, so any change to
   a shape must land there first or E2E lies to us.

---

## 1. Gene explanation DB (`gen-explanation-module/`)

**What it is.** A 34 MB SQLite database, `genes_v4.db`, plus two scripts. It
gives each gene a Spanish-language profile so a result can say *why* a gene
matters instead of only naming it.

**Verified contents** (queried directly, not taken from the readme):

| Check | Result |
|---|---|
| Rows in `genes` | **5,228** |
| Schema | `simbolo` PK + 8 columns + `raw_json`, index on `simbolo` |
| `raw_json` unparseable | **0** |
| `resumen_es` empty | 21 (0.4%) |
| `funcion_proteina_es` empty | 125 (2.4%) |
| `uniprot_accession` empty | 52 (1.0%) |
| Rows with no `enfermedades_asociadas_es` | 525 (10.0%) |
| Rows where `resumen_es` == English original | **0** — translation did complete |

Sources: NCBI Gene (Entrez), UniProtKB, OMIM, over genes drawn from
`phenotype_to_genes.txt`. Each row carries a bilingual JSON blob with summary,
protein function, associated diseases with OMIM codes, and reference links.

**This is the cleanest of the three and the lowest-risk to integrate.** It is
a static lookup keyed by gene symbol — exactly the key `/rank-genes` already
returns (`gene_symbol: "CFTR"`).

**What is wrong / missing:**

- **Not a git repository.** No history, no remote, no CI. Must be initialised.
- **A 34 MB binary in git** is a real decision: it bloats every clone forever
  and Git LFS or a build-time download may be preferable. See the plan.
- `crear_db.py` has **empty path constants** (`CARPETA_JSONS = Path(r"")`,
  `OUTPUT_DB = Path(r"")`) — it cannot be re-run as committed, so the DB is
  currently **unreproducible**. The source JSONs are not in the folder.
- It translates via an **undocumented Google Translate endpoint**
  (`translate.googleapis.com/translate_a/single`), unauthenticated and
  rate-limited. Fine as a one-off; not something to depend on.
- `ver_bd.py` returns a **12-element tuple** — unusable as an API. Its only
  test is commented out. Needs a real accessor returning a dict.
- No coverage guarantee: if `/rank-genes` returns a symbol absent from these
  5,228 rows, there is no fallback. **Coverage against the real gene set has
  not been measured** and is a task in the plan.

---

## 2. Question agent (`diagnosticar-question-agent/`)

> **Status, 2026-09-28: superseded by v2.** Everything below describes the
> v1 prototype as it arrived, and is kept as the record of what was found. v2 is
> a rewrite on branch `feat/agente-v2` of the same repository (it keeps the
> author's history and credits what survives): it takes HPO terms, asks up to 3
> rounds of 3 questions chosen by information gain and worded by an LLM inside
> guardrails, adds each confirmed symptom to what the diagnostic.ar model
> receives, and records "no" answers and negated findings for the consultation
> without changing the ranking. It runs as an internal service behind Express
> (`/api/questions/*`, see `docs/INTEGRATION_PLAN.md`) and is built from
> diagnostic.ar-api (`services/question-agent/Dockerfile`). On 501 real
> published patients the answers leave the ranking statistically unchanged; the
> full evaluation, including why an earlier simulated gain did not hold, is in
> that repository's `docs/EVALUACION.md`, `docs/IMPACTO.md` and
> `docs/NEGACIONES.md`.

**What it is.** `genphenai-repreguntas` v1.0.0 — a FastAPI + LangChain + Chroma
RAG service that asks the user follow-up questions to refine a ranking. It
indexes Orphadata disease→HPO associations (`data/en_product4.xml`) and
generates traceable questions, each carrying the HPO term it probes, which
candidate diseases it separates, and a clinical rationale.

**Endpoints:** `GET /health`, `POST /sessions`, `POST /sessions/{id}/answers`,
on port 8010. Session state holds clinical history, questions already asked,
HPO already probed, and the candidate list.

**Design points worth keeping.** The docs are unusually careful about the
things that matter here: certainty is capped at 70 when phenotypes go
unexplained, it may *fall* between iterations, the prompt forbids using
symptoms absent from retrieved context as supporting evidence, and the
expected terminal output is "Diagnóstico diferencial no concluyente" rather
than a forced answer. That matches our rule that the platform suggests a
speciality and never diagnoses.

**The blocking mismatch — this is the main finding.**

The agent's contract keys candidates on **Orphanet disease codes**:

```json
{"case_text": "...", "top_candidates": [{"name": "Alexander disease", "orpha_code": "58", "score": 0.81}]}
```

But diagnostic.ar's `/rank-genes` returns **gene symbols**, not diseases:

```json
{"results": [{"gene_id": "CFTR", "gene_symbol": "CFTR", "score": 0.412, ...}]}
```

**We have no Orphanet codes to send it.** A gene→Orphanet bridge is required
before this module can be wired at all. `data/en_product6.xml` (Orphanet
gene–disease associations) is already present in the repo and is the obvious
candidate; `genes_to_phenotype.txt` and `phenotype.hpoa` are there too. This
must be resolved before any integration work, and it is the first task for
this module in the plan.

**What is wrong / missing:**

- **Tests do not run as-is**: `pytest` fails at collection with
  `ModuleNotFoundError: No module named 'langchain_core'`. Needs a venv and
  `pip install -e ".[dev]"`. Not a defect — nothing is installed — but it
  means **the test suite has not been observed passing** yet.
- **Windows-only tooling**: every helper in `scripts/` is PowerShell
  (`.ps1`), and the README's install instructions are Windows
  (`.\.venv\Scripts\activate`). We deploy Linux containers. Needs POSIX
  equivalents or a Makefile.
- **Hard dependency on OpenAI**: `OPENAI_API_KEY` for both the LLM and the
  embeddings (`langchain-openai`). This is the module that most needs the
  codex adapter in `LLM_ACCESS.md` — and note embeddings are a *separate*
  problem from chat completion, since codex exposes no embeddings endpoint.
- **Chroma index must be built before first use** (`cli index`), and the
  collection name is derived from a corpus signature. That is a real
  deploy-time step with real disk cost, not a container that just boots.
- `data/` is ~large and includes many files the agent never reads (`mondo.*`,
  `hp-full.*`, PDFs, drug tables). Worth pruning before containerising.
- No Dockerfile, no CI.

---

## 3. Spanish symptom recognizer (`spanish-symptoms-recognizer/`)

**What it is.** The intended **full replacement** for the current text→HPO
step. A three-stage pipeline built on BSC's `bsc-bio-ehr-es`:

1. **Text parsing** — `sentences`, `chunks-sentences`, `sections-sentences`
   or `full-text`, controlling how much context NER sees at once.
2. **NER** — extracts phenotype mentions, either a local fine-tuned HF model
   or an LLM API (OpenAI / Anthropic / Gemini).
3. **Mapping** — mention → HPO code via ClinLinker / SapBERT / RoBERTa-biomedical
   similarity, optionally re-ranked by an LLM over the top-K candidates.

Trained on SympTEMIST plus a synthetic dataset; HPO Spanish labels come from
the HPO Internationalisation Effort's `hp-es.babelon.tsv`.

**Clean public API** — `PhenotypesRecognizer` in
`symptoms_recognizer/symptom_recognizer.py`:

```python
recognizer.recognize(text) -> list[tuple[mention, context]]
recognizer.map(mentions)   -> list[hpo_code]
recognizer.scan(text)      -> list[tuple[mention, hpo_code]]   # end to end
```

**Measured quality, from the repo's own benchmark** (`symptoms_recognizer/tests/README.md`,
8 clinical histories, after the authors corrected ground-truth HPO errors):

| Configuration | NER F1 | End-to-end F1 |
|---|---|---|
| NER gpt-4o-mini (general prompt) + MAP **claude-opus-5** | 0.496 | **0.752** |
| NER gpt-4o-mini (general) + MAP gpt-5.6-sol | 0.479 | 0.724 |
| NER gpt-4o-mini (general) + MAP claude-sonnet-5 | 0.500 | 0.719 |
| NER gpt-4o-mini (specific prompt) + MAP claude-opus-5 | 0.692 | 0.699 |

Read these carefully, because two things are easy to misread:

- **The NER stage is the weak link**, not mapping. Best end-to-end F1 is
  ~0.75 while NER F1 sits at ~0.50–0.69. The general-prompt NER scores *worse*
  at NER yet *better* end to end — it emits broader phenotype names that the
  mapper resolves more reliably.
- **The evaluation set is 8 clinical histories (~59 gold mentions).** A
  difference of two or three matches moves F1 by several points. These numbers
  rank configurations; they are **not** a production quality estimate, and we
  should not treat 0.75 as a measured platform figure.
- Earlier rows in that log are **invalid**: the authors found the ground truth
  itself had HPO codes wrongly associated and re-ran. Only the final table
  counts.

**What is wrong / missing:**

- **No measured comparison against the system it replaces.** The current
  pipeline (Qwen2.5 symptom extraction → NLLB translation → `es-index`
  matching) has never been scored on this benchmark. **We cannot claim an
  improvement until both are run on the same data** — this is the single most
  important test in the whole plan.
- **Shape mismatch with `/extract-hpo`.** `scan()` returns
  `(mention, hpo_code)`. `PhenotypeItem` requires `hpo_id`, `label`,
  `label_es`, `span_es`, `span_en`, `start_es`, `end_es`, `start_en`,
  `end_en`, `negated`, `confidence`, `matched_by`. Character offsets and
  **negation** are not produced by `scan()` at all.
- **Negation is a safety issue, not a formatting one.** The current phenotyper
  has a dedicated `services/phenotyper/negation.py`. "no presenta convulsiones"
  must not become a positive HP:0001250. The recognizer has no negation stage
  — this must be settled before it can replace anything.
- `symptoms_recognizer/entity-normalization/` is **dead code** by the module's
  own `AGENTS.md`: `_get_filters_pipeline()` returns `[]`, both filters are
  stubs, and nothing imports it. Do not wire it back in.
- **The venv lives at `.env/`** — a directory, despite the name. Never
  `source` it as a dotenv file.
- E2E "tests" are a comparison script (`tests/compare_models.py`) that calls
  paid APIs, not an assertive suite. There is nothing CI can run offline.
- Local-model paths (ClinLinker/SapBERT) mean **model weights to host**, GPU
  or slow CPU inference, and a cold-start cost. Which stage runs locally vs.
  via LLM is an unmade decision with direct cost and latency consequences.
- `tests/dataset/historia_*.{csv,txt}` is the ground truth and is
  **append-only by convention** — editing it silently invalidates every past
  comparison in the log.
