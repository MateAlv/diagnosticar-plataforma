# What we have per gene, and what to build with it

Written 2026-09-21. Every figure below was measured against the real database,
not read off the schema.

Audience is **both**: a family trying to understand what a result means, and a
clinician deciding whether it is worth pursuing. They need the same facts in a
different order and at a different depth — not two different products.

---

## Part 1 — what exactly we will have for each gene

### Per gene

| Field | Coverage | What it is |
|---|---|---|
| `simbolo` | 100% | `CFTR` — the HGNC symbol GenPhenAI returns |
| `nombre_completo` | 100% | *CF transmembrane conductance regulator* (English, from NCBI) |
| `ubicacion` | 99.3% | `7q31.2` — cytogenetic locus |
| `cromosoma` | 100% | `7` |
| `aliases` | 98.3% | `ABCC7, CF, MRP7` — historical names |
| `enfermedades` | **90.0%** | named diseases **in Spanish**, each with a description and an OMIM code |
| `sintomas_esperados` | **89.6%** | symptoms reported for those diseases, with frequencies |
| `resumen_llano_es` | pending | 1–2 sentences of plain Spanish — the rewrite pass |
| `tecnico_resumen_es/_en` | 99.6% | the NCBI summary, ES and EN |
| `tecnico_funcion_es/_en` | 97.6% | UniProt protein function, ES and EN |
| `ncbi_id`, `uniprot_accession` | 100% / 99% | for deep links |

Diseases per gene: 525 genes have none, 3,344 have one, 833 two, 300 three,
226 four or more. A disease description is a median of **409 characters** —
already the right length for a card.

### Expected symptoms — the most useful thing we have

Joined from `phenotype.hpoa` through each gene's OMIM codes. **4,686 of 5,228
genes (89.6%)** carry at least one, a **median of 19** per gene (mean 27, max
287).

Each symptom carries a **frequency**, normalised to a percentage from the three
forms HPO uses (`106/111`, `55%`, `HP:0040281` → *Muy frecuente*). Symptoms
marked `NOT` for a disease are excluded, so a phenotype recorded as *absent* is
never shown as expected.

### What we do **not** have, and must not imply

- **No variant-level information.** Nothing about *this patient's* genotype. We
  say a gene is associated with a phenotype pattern, never that anyone carries
  a variant in it.
- **No per-gene explanation of why the model ranked it.** `/rank-genes` returns
  `matched_hpo_ids: []`, `matched_count: 0`, `coverage: 0` — the model does not
  expose which inputs drove a gene. **Any "why this gene" we show must be
  computed by us and labelled as ours**, never presented as the model's
  reasoning.
- **No inheritance pattern, onset or prevalence** surfaced yet, though
  `phenotype.hpoa` carries onset and `en_product9_*.xml` carries prevalence.
- **10% of genes have no disease and no symptoms.** For those, the honest card
  is the gene, its function, and nothing more.

---

## Part 2 — the capability that makes the output usable

Today a family sees this, and nothing else:

```
1  CFTR      Score 0.412
2  SCNN1A    Score 0.387
```

A score is meaningless to a parent and nearly meaningless to a clinician. But
we already hold the patient's HPO terms — they are the wizard's input — and we
now hold each gene's expected symptoms. **Intersecting them is what turns a
ranked list into something a person can act on.**

Measured on a simulated cystic-fibrosis-like patient reporting *infecciones
respiratorias recurrentes, retraso del crecimiento, bronquiectasia, tos
crónica*:

```
CFTR    — matches 2/4 reported
          ✓ Bronquiectasia            (95% of patients with this disease)
          ✓ Retraso del crecimiento   (38%)
          ? Elevated sweat chloride   (100%)  ← not reported
          ? Decreased forced expiratory flow (71%)

DNAH5   — matches 2/4 reported
          ✓ Bronquiectasia            (83%)
          ✓ Infecciones respiratorias recurrentes
          ? Recurrent otitis media    (100%)  ← not reported
```

Two things fall out of this, and both are the product:

1. **What lines up.** "Two of the things you described are common in the
   conditions linked to this gene" — concrete, checkable, and it explains the
   gene's presence in the list without pretending to explain the model.
2. **What is missing and would be telling.** *Elevated sweat chloride* is
   present in 100% of CF patients and is literally the diagnostic test. A
   family that has not mentioned it can ask about it; a clinician sees
   immediately what would confirm or kill the hypothesis.

Point 2 is the highest-value output in this whole module, and it costs nothing
beyond a set intersection.

It also feeds the question agent directly: the highest-frequency expected
symptom that the patient has **not** reported is exactly the next question
worth asking.

### One dead affordance already in the UI

`frontend/src/app/nuevo/page.tsx` already renders `Match {matched_count}/{input_count}`
when `matched_count > 0`. GenPhenAI always returns `0`, so **that badge never
appears**. Our matching can fill it — but it must be labelled as our
phenotype overlap, not as the model's matching, because it is not.

---

## Part 3 — what to build

### The card, for both audiences

**Corrected 2026-09-21 after Mate's review. An earlier draft led with the
disease name; that misrepresents what the model does.**

The model predicts **genes** — top-20 contains the correct gene in ~90% of
cases. It does **not** predict diseases. The disease on a card is our own join:
gene → OMIM → disease name. Leading with *"Fibrosis quística"* would present
our annotation as the model's output, which is overclaiming in the one
direction that matters. The gene is the prediction; the disease is context that
helps a person understand what the gene is about.

So the gene stays the headline, and the disease sits directly under it as
clearly-labelled context:

```
┌────────────────────────────────────────────────────────┐
│ 1.  CFTR                            2 de 4 coinciden   │  ← the prediction
│                                                        │
│     Este gen da las instrucciones para fabricar una    │  ← resumen_llano_es
│     proteína que funciona como un canal en las         │
│     células…                                           │
│                                                        │
│     Se estudia en relación con                         │  ← labelled as context,
│       Fibrosis quística                                │    not as a prediction
│       Ausencia congénita de conductos deferentes       │
│                                                        │
│     Coincide con lo que contaste                       │
│       • Bronquiectasia          muy frecuente (95%)    │
│       • Retraso del crecimiento    frecuente (38%)     │
│                                                        │
│     Signos frecuentes que no mencionaste               │
│       • Cloruro elevado en sudor              (100%)   │
│       • Flujo espiratorio disminuido           (71%)   │
│       Preguntale a tu médico si corresponde evaluarlos │
│                                                        │
│     ▸ Ver detalle técnico                              │
└────────────────────────────────────────────────────────┘
```

The heading *"Se estudia en relación con"* does the work: it says these
diseases are associated with the gene without asserting the person has one, and
without implying the model chose them.

**Never rank the diseases** and never show only the first. A gene with four
associated diseases must show them as a set; ordering them reads as a
differential the model did not produce.

**Never lead with the raw score.** It invites a family to read rank 1 as "the
answer". The phenotype overlap is the honest primary signal; the score belongs
in the technical view where it can be interpreted.

### Saying what the model actually did

The platform should state its own accuracy plainly, once, near the list — not
bury it in a disclaimer:

> Este sistema sugiere **genes** para investigar, no enfermedades ni
> diagnósticos. En pruebas, el gen correcto aparece entre los 20 sugeridos en
> aproximadamente 9 de cada 10 casos.

Two things follow from that number and should shape the UI:

- **It is a top-20 claim, not a top-1 claim.** Showing five genes and stopping
  hides where the answer usually is. The list should make it easy to see all 20
  rather than presenting the top few as finalists.
- **Rank 1 is not "the answer".** Visual weight should not make it look like
  one. This is the strongest argument for leading with phenotype overlap rather
  than score: overlap is a reason, a score is a verdict.

### The professional view — a display preference, not an identity

**Decided 2026-09-21: there is no "become a doctor" step.** The platform serves
patients and clinicians alike, and asking someone to declare a profession would
be both a barrier and unverifiable theatre — a self-declared checkbox proves
nothing, so gating on it buys no safety while adding friction for the family it
inconveniences.

**Recommendation: neither fully agnostic nor a real role. Ship a toggle that
remembers, defaulting to the plain view.**

Reasoning:

- **Not agnostic.** Showing everything to everyone means either burying a
  family in *"superfamilia de transportadores del casete de unión a ATP"* or
  denying a clinician the protein function, accessions and locus that make the
  result checkable. Both audiences get a worse product.
- **Not a verified role.** We cannot verify it, and pretending to would be
  worse than not trying.
- **A toggle is honest about what it is:** a display preference, labelled as
  such. *"Ver detalle técnico"* per card, plus a persistent *"Vista
  profesional"* switch that remembers the choice for the session or the
  account.

Nothing behind the toggle is more sensitive than what it shows — it is public
reference data from NCBI, UniProt and OMIM. **The risk of the technical view is
confusion, not disclosure**, which is exactly the kind of risk a preference is
the right instrument for.

The default is the plain view, because a clinician who sees it understands
immediately what it is and flips the switch, whereas a family dropped into the
technical view has no idea what they are looking at.

#### What this means for the backend boundary

`professional=True` stays a **server-side parameter**, not because the data is
secret but because the two views should be assembled in one place with one
contract. The route takes the preference from the request, and the account may
persist it — but no code path should be able to leak `tecnico_*` into the plain
view by accident, which the existing mutation-checked test enforces.

If a verified clinician role is ever wanted — for features that genuinely need
one, such as writing to a patient record — that is a separate decision. The
account model already has `role` read server-side on every request, so the
groundwork is there. **Do not conflate that with this toggle.**

### Safety rules that do not bend

The platform suggests **a speciality to consult, never a diagnosis.** Adding
disease names to the output is the most dangerous change this product has made,
so:

- Frame every disease as *"genes relacionados con esta condición"*, never
  *"tenés esta condición"*.
- **Never rank diseases.** Listing one first reads as a diagnosis.
- Keep the existing disclaimer on every screen that renders a disease name, and
  extend the E2E assertion to cover the new card.
- The "not reported" symptoms are **questions for a doctor**, never a checklist
  to self-assess against. The wording must carry that.
- A gene with no profile shows the symbol and its score with *"sin descripción
  disponible"* — never a blank card, never an invented description.

---

## Part 4 — the order to build it

1. **Serve the profile.** Read-only SQLite behind an authenticated,
   rate-limited Express route, with the miss counter. No UI change yet.
2. **Reorder the card to lead with disease + plain summary.** Most of the
   readability win, no new computation.
3. **Add phenotype matching** — reported vs. expected. This is the highest
   value per line of code in the module, and it fills the dead `Match` badge.
4. **Add "frequent but not reported"**, worded as questions for a doctor.
5. **Ship the professional view** as a remembered display toggle, defaulting
   to the plain view.
6. **Feed the top unreported symptom to the question agent** as its next
   question.

Steps 1–4 need no LLM and no new data. The plain summary (step 2) needs the
rewrite pass reviewed first — see `PLAIN_LANGUAGE.md` in the gene-profiles repo.
