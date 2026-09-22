# Gene profiles — where we are, and what is next

Updated 2026-09-21. Read this first if you have lost the thread.

## What this work is for

A diagnosis result currently shows a family `CFTR — Score 0.412` and nothing
else. The goal is to turn that into something a patient or their doctor can
actually act on: what the gene does, what conditions it is studied in relation
to, which of their reported symptoms line up, and which frequent signs they did
*not* mention — the last being the most useful output, because it is a concrete
question to take to a doctor.

The model predicts **genes**, not diseases. Everything about diseases is our
own annotation and must be presented as context, never as the prediction.

## Done

- **Private repo** `MateAlv/diagnostic.ar-gene-profiles`. The database is never
  committed — built locally, copied to the server with `scp`.
- **The build was rewritten from scratch.** The original `crear_db.py` could
  not rebuild anything: its path constants were empty and the NCBI/UniProt
  fetch stage never existed in the module.
- **Gene universe corrected.** The model ranks over exactly 5,228 genes, from
  its checkpoint vocabulary. Building from the HPO annotation files instead —
  which an earlier version did — silently dropped 126 genes the model can
  return.
- **Expected symptoms** per disease with real frequencies, joined from
  `phenotype.hpoa`. 89.6% of genes have at least one, median 19.
- **Phenotype matching** — `match_symptoms()` intersects the patient's reported
  HPO terms with a gene's expected symptoms and returns both the overlap and
  the frequent unreported ones.
- **Audience split.** `tecnico_*` columns are only returned on
  `professional=True`, enforced server-side and mutation-tested.
- **Plain-language rewrite** — build-time pass into `resumen_llano_es`, batched
  25 genes per call, with a validator that rejects anything reading as medical
  advice.
- **Official Spanish HPO labels** instead of machine translation: 97.6%
  coverage, better wording, and ~20,000 fewer calls per build.
- **Builds resume** from disk caches after an interruption or a block.
- 34 tests, no network.

## Deployed to staging 2026-09-22

`v0.5.0` is live at https://staging.diagnosticar.infra.cluster.qb.fcen.uba.ar
and the wizard has now run end to end against the **real** HPO gateway and
GenPhenAI — the first time that has happened. Production was untouched:
container uptimes identical before and after (3 and 6 weeks), host steady at 62
containers across 15 projects.

The database transferred intact (md5 `699120d8…`, 62,107,648 bytes both sides)
and mounts read-only with no load warning. SMOKE PASS on all 13 checks.

**What the first real run showed is in `GENE_CARD_UI_TODO.md`:** the card was a
wall of text that buried the symptom comparison, and text was still in English.
Neither blocked the pipeline; both were visible to a user. Both are now fixed
and waiting to ship.

The English count was first reported here as 117 summaries (2.2%), measured
with a keyword regex too narrow to see most of it. The real figure was **809
texts across 781 genes** — 321 summaries and 488 protein-function fields. The
two columns drift independently, which is why the function field was invisible
to the first count. All 809 are translated; `scripts/verify_db.py` now reports
0 and gates the copy.

## In flight

**The database is built and verified**: 5,228 genes, 0 NCBI misses, 100% of the
model vocabulary, 126,395 expected symptoms across 6,420 diseases, every one of
them with an official Spanish name.

Two language passes are running over it:

- **Plain-language rewrites** — turning each technical summary into two
  sentences a family can read.
- **Disease-name translation** — 39% of names came back English when the free
  translation endpoint blocked the build.

Both run through the `claude` CLI. The `codex` subscription hit its usage limit
partway through the first attempt, which is why `genesdb/llm.py` now supports
either backend behind one contract: exhausting one quota should not stop the
work for hours.

**PR [#34](https://github.com/MateAlv/diagnostic.ar/pull/34)** carries the
backend route and the results card.

## Next, in order

1. **Finish the rebuild and verify it.** Row count should be 5,228. Confirm the
   126 previously-unreachable genes are present with full profiles.
2. **Run the plain-language pass** over the finished database (~1 hour).
3. **Review it by hand** — the protocol is in the repo at
   `docs/PLAIN_LANGUAGE.md`: ~150 rows in four passes, weighted to where errors
   concentrate. **This gates everything downstream**; no rewritten text ships
   unreviewed.
4. ~~**Serve it from Express**~~ **Done 2026-09-21.** `GET /api/genes/:symbol`
   reads the SQLite file through `node:sqlite` (no new dependency — the runtime
   is already Node 22). Authenticated, because the request carries the
   phenotypes a patient reported. `?view=professional` adds the technical
   layer; a mutation-checked test fails if it leaks into the default shape. A
   missing gene or a missing database degrades to "sin descripción disponible"
   rather than failing the request. 10 tests, no Postgres, no network.
5. ~~**Rebuild the results card**~~ **Done — PR #34.** Gene as the headline,
   diseases as labelled context, phenotype matches, and "frequent signs you did
   not mention" worded as questions for a doctor. 101 E2E passing, up from 83.
6. **Professional view** as a remembered display toggle, defaulting to plain.
7. **Feed the top unreported symptom to the question agent** as its next
   question.

Steps 4–5 need no LLM and no new data, and are where the user-visible value is.

## A finding that belongs to the platform, not this module

**`diagnostic.ar-api`'s Spanish HPO labels are stale.** The wizard's `label_es`
values come from `data/hpo/hp-es.tsv`, converted by `scripts/build_hpo_es.py` —
the same official babelon file this module now uses. The committed copy is from
**April** and is **972 terms short, with 416 labels changed** upstream since,
including corrections such as *interleuquina* → *interleucina*.

Two consequences:

- Users see outdated Spanish for some symptoms, and no symptom name at all for
  972 newer HPO terms.
- **If only one side is refreshed, the same HPO term will be named one way in
  the wizard and another on a gene card.** They must be updated together.

Nothing automates the refresh, which is why it drifted. Worth a small scheduled
job or at least a documented step; the fetch script in the gene-profiles repo
(`scripts/fetch_hpo_translations.sh`) does the download and refuses a truncated
file.

This is a separate change to the API repo and should not be smuggled into the
gene-profiles work.

---

# Deploying the database

The database is **not** in any repository and **not** baked into the image. It
is built locally and copied to the host, then bind-mounted read-only:

```bash
# on TARS, in gen-explanation-module
python -m genesdb.build --data-dir ../diagnosticar-question-agent/data \
    --model-genes /path/to/graphens_best_model/genes.json \
    --out genes.db --reuse genes_v4.db
python -m genesdb.plain_language --db genes.db --backend claude
python -m genesdb.translate_codex --db genes.db --backend claude

scp genes.db nodo0-diagnostic.ar:~/diagnostic.ar/diagnostic.ar-staging/data/genes.db
```

Then bring the stack up with the overlay, pointing at that path:

```bash
GENE_PROFILES_DB=/path/to/genes.db docker compose \
  -f docker-compose.yml -f docker-compose.genes.yml up -d
```

**The mount lives in its own overlay, not the base compose file**, and that is
deliberate. A bind mount whose source file is missing does not fail — Docker
creates a **root-owned directory** at that path, on the host, inside the
checkout. Anyone running `make up` without the database would get a stray root
directory they cannot delete, and a SQLite error that explains nothing.

With the mount in an overlay, you opt in once you actually have the file.
Without it the platform runs normally and the results screen shows each gene
with no description — descriptions enrich a result, they never gate it, and an
E2E test covers that path. The overlay also uses `${GENE_PROFILES_DB:?...}`, so
forgetting the variable fails immediately with a message instead of mounting
something unintended.

The file is rebuilt wholesale rather than migrated, so a deploy is a copy and a
restart. Rolling back means copying the previous file back; there is no schema
migration to reverse.
