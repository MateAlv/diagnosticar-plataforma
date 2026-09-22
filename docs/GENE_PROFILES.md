# Gene profiles — how they are generated, and how to do better

Analysis run 2026-09-21 against `gen-explanation-module/genes_v4.db`. Every
number below was measured, not taken from the module's readme.

Goal: make the diagnosis output **richer and understandable by a human** — in
practice, by a worried parent in Argentina, not a geneticist.

**Distribution decision (Mate, 2026-09-21): the DB is never committed.** It is
built locally and copied to the server with `scp`. Consequences:
- `crear_db.py` **must become reproducible** — it is the build step now, not a
  historical artifact. Today it cannot run at all (see below).
- The build needs a recorded provenance: which HPO release, which day, which
  source files. Otherwise nobody can tell what is on the server.
- `.gitignore` must exclude `*.db`, and the deploy doc must state where the
  file lands and who copies it.

---

## How it is generated today

```
phenotype_to_genes.txt (HPO)   →  gene symbol list (~5.2k)
        ↓  per gene
NCBI Gene (Entrez E-utilities) →  name, chromosome, maplocation, summary, aliases
UniProtKB                      →  protein function, reviewed disease associations
OMIM                           →  phenotype/disease numeric ids
        ↓
one JSON file per gene  (NOT in the repo — this is the gap)
        ↓  crear_db.py
genes_v4.db  —  table `genes`, PK `simbolo`, + raw_json blob
```

Translation to Spanish happens inside `crear_db.py`, sentence by sentence,
through an **undocumented, unauthenticated Google Translate endpoint**
(`translate.googleapis.com/translate_a/single`), with 3 retries and a sleep
between blocks. Texts over 200 chars are split on sentence boundaries into
~300-char blocks and reassembled.

### Why it cannot currently be rebuilt

1. **The path constants are empty.** `CARPETA_JSONS = Path(r"")` and
   `OUTPUT_DB = Path(r"")`. The script exits immediately.
2. **The per-gene JSON source files are not present.** `crear_db.py` is really
   a *repair-and-compile* step over a directory of JSONs that someone else
   produced. **The script that queried NCBI/UniProt/OMIM in the first place
   does not exist in this module.** That fetch stage has to be rewritten before
   the DB is reproducible at all.
3. The translation path depends on an endpoint that can change or block at any
   time, with no key and no contract.

This is now the critical path: **if we ship by scp, we must be able to build.**

---

## Measured state of the data

| Check | Result |
|---|---|
| Rows | 5,228 |
| `raw_json` unparseable | 0 |
| With ≥1 associated disease (in Spanish) | 4,703 (**90.0%**) |
| With OMIM code | 5,188 (99.2%) |
| Empty `resumen_es` | 21 (0.4%) |
| Empty `funcion_proteina_es` | 125 (2.4%) |
| `resumen_es` still identical to English | 0 — translation completed |
| Untranslated English fragments mid-text | 52 (1.0%) |
| Uncleaned `(PubMed:…)` / `By similarity` | 6 (0.1%) |
| Suspiciously short `resumen_es` (<120 chars) | 5 (0.1%) |
| HTML entities / escapes | 0 |
| Markdown-wrapped reference URLs | 0 — a readme artifact only, data is clean |

`resumen_es` is a median of 581 characters; `funcion_proteina_es` 526.

Diseases per gene: 525 genes have none, 3,344 have one, 833 two, 300 three,
123 four, 103 five or more.

**Verdict: the data is in good shape.** The defects are real but small and
mechanically fixable. The bigger problems are coverage and register.

---

## Problem 1 — genes the model can return that we cannot explain

> **Superseded 2026-09-21 — read "The gene universe, settled" below.** This
> section measured against the HPO annotation files, which are *not* the
> model's gene list. Those 165 symbols are not rankable by the model, so they
> were never missing profiles. The original database was already complete. The
> reasoning about drift and about how to degrade when a gene has no profile
> still stands; the 3.1% figure does not.

**Measured: 165 of 5,267 gene symbols (3.1%) have no profile.**

The gene universe was taken from `phenotype_to_genes.txt`, and GenPhenAI ranks
over a fixed universe of ~5,229 symbols (`GENPHENIA_INFERENCE_MAX_TOP_K=5229`
in `services/genphenai/app/main.py`), uppercased.

These are **not** obscure genes:

- 29,673 of 1,096,033 gene–HPO annotation rows (**2.71%**) belong to a missing
  gene, so they are genuinely rankable.
- **109 of the 165 have more than 100 HPO annotations each.** None has only 1.
- Worst offenders by annotation count: `MED16` (624), `FAAP100` (554),
  `PTBP1` (513), `RNU5B-1` (486), `RNU2-2` (470), `MAU2` (458), `FEM1B` (451).

### Why they are missing

**Not an alias problem** — checked: 0 of 18 sampled missing symbols appear in
any existing row's `aliases`. These are true gaps.

The cause is **HPO release drift**. The annotation files on hand are HPO
release **2026-06-23**; the DB was built from an earlier release. Evidence:
126 symbols exist in the DB but *not* in the current HPO file (genes renamed or
withdrawn), while 165 in the file are absent from the DB (genes added). The two
lists have simply moved apart.

A few are non-coding RNA genes (`RNU5B-1`, `RNU2-2`) for which NCBI has no
narrative summary — those will stay thin no matter what we do.

### The gaps are mechanically fillable

`phenotype_to_genes.txt` carries `ncbi_gene_id` for every row, so no name
resolution is needed. Verified live against NCBI E-utilities for `MED16`
(id 10025), which returned everything the profile needs:

```
name: MED16 · description: mediator complex subunit 16
chromosome: 19 · maplocation: 19p13.3
summary: Enables nuclear thyroid hormone receptor binding activity…
otheraliases: DRIP92, GGNS, THRAP5, TRAP95
```

### What to do about a gene with no profile — ranked

1. **Fill the gaps (do this).** Re-run the fetch for the 165 missing
   `ncbi_gene_id`s and rebuild. It is a bounded, one-off job and it takes the
   miss rate to ~0. Requires the fetch stage to exist — see "cannot be
   rebuilt".
2. **Pin the HPO release and re-sync deliberately.** Record the release the DB
   was built from and re-run when HPO publishes. Drift is the root cause; this
   stops it recurring silently.
3. **Degrade honestly at runtime (do this too).** Even at ~0% miss, a gene can
   go missing after an HPO update. The UI must show the gene symbol, its score
   and the specialty **without** an explanation, and say plainly that no
   description is available — never a blank card, never a silent omission, and
   never an invented description. **Do not use an LLM to generate the missing
   profile on the fly:** a fabricated gene description shown to a family about
   their child is exactly the failure this project cannot have.
4. **Log every miss.** A counter of unexplained symbols tells us when drift has
   started, and feeds the next rebuild. Aggregate only — no patient linkage.

---

## Problem 2 — the register is wrong for the audience

This is the real obstacle to "human understandable", and no amount of coverage
fixes it. What a parent currently sees for `CFTR`:

> Este gen codifica un miembro de la superfamilia de transportadores del casete
> de unión a ATP (ABC). La proteína codificada funciona como un canal de
> cloruro… La activación del canal está mediada por ciclos de fosforilación del
> dominio regulador, unión de ATP por los dominios de unión de nucleótidos e
> hidrólisis de ATP.

Accurate, and useless to the intended reader. It is an NCBI summary written for
molecular biologists, machine-translated. Meanwhile the genuinely useful part
is already in the row and buried underneath:

> **Fibrosis quística** (OMIM 219700) — Un trastorno generalizado común de las
> glándulas exocrinas… enfermedad broncopulmonar crónica, insuficiencia
> pancreática…

### What to do

**Lead with the disease, not the biochemistry.** 90% of rows have a named
disease in Spanish; that is the field a family can act on. Proposed card order:

1. Gene symbol + associated disease name(s) — the headline.
2. One plain-Spanish sentence on what the gene does.
3. Location (`12q13.13`) and OMIM links, collapsed by default.
4. The full technical summary behind a "ver detalle técnico" disclosure.

**A plain-language rewrite is the one place an LLM is justified here** — but as
a *build-time* step, not at request time:

- Rewrite each `resumen_es` into 1–2 sentences at a lay reading level, offline,
  over 5,228 rows, via the codex adapter (`LLM_ACCESS.md`).
- Store it as a **new column** (`resumen_llano_es`), never overwriting the
  source text. The technical text stays as provenance.
- It is reviewable before shipping, deterministic at serve time, costs nothing
  per request, and cannot invent anything for a gene we have no data for.
- **It needs human review before going near production.** Simplifying clinical
  text is exactly where a plausible-sounding error hides. Review at minimum a
  stratified sample, and always keep the source text one tap away.

This also fixes the 52 rows with English fragments and the 6 with uncleaned
citations, since a rewrite pass regenerates the prose.

### What must not change

The output stays a **speciality to consult, never a diagnosis**. Naming a
disease associated with a ranked gene is the most dangerous text this product
would show, and it must be framed as "genes related to this condition are
studied in…", with the existing disclaimer intact on every screen that renders
it.

---

## Recommended order of work

1. **Rebuild the fetch stage** so the DB is reproducible, with provenance
   (HPO release + date) recorded in the DB itself. Everything depends on this.
2. **Fill the 165 missing genes** from their `ncbi_gene_id`s; re-measure.
3. **Serve it** behind the authenticated Express backend, read-only SQLite,
   with the honest "no description available" path and a miss counter.
4. **Reorder the card** to lead with disease — this alone is most of the
   readability win, with no LLM involved.
5. **Then** consider the offline plain-language rewrite column, with review.

Steps 1–4 involve no LLM at all. Step 5 is the only one that does, and it
happens at build time where it can be checked.

---

# Rebuild — done 2026-09-21

Repo: **`MateAlv/diagnostic.ar-gene-profiles`** (private), built from
`~/diagnostic.ar/gen-explanation-module`. The old scripts are kept under
`legacy/` for reference.

The fetch stage now exists. `python -m genesdb.build` goes from the HPO
annotation files to a finished database: NCBI Gene and UniProtKB for the gene
data, `phenotype.hpoa` + `hp.obo` for expected symptoms, then translation. A
`build_info` table records the HPO release, the build date, the gene count and
the NCBI miss count, so what is on the server can always be identified.

**Verified end to end** on `CFTR`, `MED16` and `FAAP100` — the latter two being
genes the old database was missing. Zero NCBI misses. Translations from the old
database are reused (~10,023 cached strings), so a rebuild does not re-translate
from scratch.

## Audience split, as asked

The disease is the headline for every reader. The biochemistry is a separate
layer that only a clinician sees, and only after asking:

| Column group | Who sees it |
|---|---|
| `enfermedades_es`, `sintomas_esperados`, `resumen_llano_es` | everyone — the default view |
| `tecnico_resumen_es/_en`, `tecnico_funcion_es/_en`, aliases, accessions | only `professional=True` |

```python
db.get("CFTR")                     # disease first, no biochemistry
db.get("CFTR", professional=True)  # adds the technical layer
```

`test_family_view_excludes_biochemistry` asserts the technical text cannot
appear in the family view, and **fails when the `professional` gate is removed**
— mutation-checked, so it is not a test that cannot fail.

**The professional view is a data boundary, not a UI toggle.** The backend must
decide who is a clinician; a frontend flag the browser can set would make the
distinction meaningless.

## Expected symptoms

Joined from `phenotype.hpoa` (HPO release 2026-06-23) via the OMIM codes
already on each gene, with names from `hp.obo`. Frequencies are parsed from all
three forms HPO uses — ratios (`106/111`), percentages, and frequency terms
(`HP:0040281` → *Muy frecuente*) — and normalised to a percentage so symptoms
sort most-frequent-first.

Measured: **12,935 diseases** carry phenotype annotations, 8,553 of them OMIM.
Cystic fibrosis (OMIM:219700) yields 31 symptoms, led by *Cloruro elevado en
sudor* (100%) and *Bronquiectasia* (95.5%).

**Phenotypes carrying the `NOT` qualifier are excluded**, so a symptom
explicitly recorded as *absent* in a disease is never shown as expected. That
inversion would be a clinically dangerous bug.

## Still to do

- **Full rebuild has not been run** — only 3-gene smoke tests. A complete run is
  ~5,267 genes against NCBI (3/s without a key) and UniProt, so expect roughly
  an hour, mostly rate-limited. Run it, then re-measure coverage.
- **`resumen_llano_es` is `NULL` for every row.** The column exists; the
  build-time plain-language rewrite has not been written. That is the remaining
  readability work and the only step needing an LLM.
- The 165 previously-missing genes should be gone after a full rebuild, since
  the universe now comes from the current HPO release — **confirm by
  re-measuring**, do not assume.
- Wire into Express: read-only SQLite, authenticated, rate-limited, with the
  honest "no description available" path and a miss counter.

---

# The gene universe, settled 2026-09-21

Mate asked whether GenPhenAI can return ~8,000 genes, which would have meant
~2,500 missing profiles rather than the 165 reported above.

**It cannot. The model ranks over exactly 5,228 genes.**

The authoritative source is the model's own vocabulary, not any HPO file:

```
/home/<usuario>/FIUBA/trabajo-profesional/GenPhenAI/
  genphenia_inference/checkpoints/graphens_best_model/genes.json     5,229 entries
  GENPHENAI_RN_ARQUITECTURA_ENTRENAMIENTO.md                         classifier.weight (5229, 512)
```

The training document gives the architecture directly — `out_channels: 5229`,
`logits: [batch_size, 5229]`, `classifier.weight: (5229, 512)`. The classifier
has one output per vocabulary entry, so **the model is architecturally
incapable of returning a symbol outside that list.** `genes.json`'s first entry
is `-`, a placeholder class, leaving **5,228 real genes** — which is exactly the
row count of the original database. The 8,000 figure does not correspond to
anything in this system.

`GENPHENIA_INFERENCE_MAX_TOP_K=5229` in the gateway is therefore the full
output space, not a cap that hides anything.

## This corrected a real defect in the rebuild

Measured against the model vocabulary:

| Source of the gene list | Genes | Against the model |
|---|---|---|
| Model `genes.json` | 5,228 | — |
| Original `genes_v4.db` | 5,228 | **complete, 0 missing** |
| HPO `phenotype_to_genes.txt` (2026-06-23) | 5,267 | **omits 126**, adds 165 unrankable |

So the earlier "165 missing genes" reading was **backwards**. Those 165 are in
the current HPO release but are *not* in the model's vocabulary, so the model
can never return them — they were never missing profiles. The original database
was already complete for its purpose.

The real risk was the rebuild: by taking its universe from the HPO files it
would have **dropped 126 genes the model can actually rank** (`ABCC4`, `ACADL`,
`ACOX2`, `AGTR2`, `BMP10`…), introducing a gap that did not previously exist.

**Fixed.** `--model-genes genes.json` makes the checkpoint vocabulary the source
of truth. The 126 carry no HPO annotation and therefore no `ncbi_gene_id` in
those files, so their symbols are resolved through NCBI esearch — **all 126
resolve**, verified, and `ABCC4`/`ACADL` now build with full profiles.
`build_info.gene_universe` records which list a database was built from.

**Standing rule: build with `--model-genes`.** Without it the build silently
uses the HPO universe and loses those 126. And when GenPhenAI is retrained, the
vocabulary changes — the new `genes.json` must be copied over and the database
rebuilt, or the two drift apart again.

---

# Plain-language rewrite — implemented 2026-09-21

`genesdb/plain_language.py`, a **build-time** pass writing `resumen_llano_es`.
The technical text is never overwritten, so the professional view keeps its
provenance and the family view gets prose it can read.

Measured on `CFTR` — 13s per gene through the codex CLI, and the register is
right:

> Este gen contiene las instrucciones para fabricar una proteína que funciona
> como un canal para el paso de sales. Esa proteína regula la entrada y salida
> de sales y agua en los tejidos que recubren el cuerpo y sus órganos.

versus the source: *"un miembro de la superfamilia de transportadores del casete
de unión a ATP (ABC)… ciclos de fosforilación del dominio regulador"*.

**A validator rejects anything that reads as medical advice** — `diagnóstico`,
`pronóstico`, `tratamiento`, `cura`, `terapia`, "su hijo tiene" — or that
exceeds 300 characters. A rejected rewrite leaves the column NULL rather than
storing something unreviewed. Tests cover each forbidden category.

Doing this at build time is the whole point: it is reviewable before it ships,
free at request time, and cannot fabricate text while a family is reading.

**Still required: human review before this goes anywhere near production.**
Simplifying clinical text is exactly where a plausible-sounding error hides, and
no validator catches a fluent, confident, wrong sentence. Review a stratified
sample at minimum, and keep the technical text one tap away.

Cost at full scale: ~5,228 genes × ~13s ≈ 19 hours single-threaded. Worth
batching several genes per call, and it is resumable — reruns skip genes that
already have a rewrite unless `--overwrite` is passed.
