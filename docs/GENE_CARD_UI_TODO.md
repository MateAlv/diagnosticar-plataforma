# Gene card — the redesign

Written 2026-09-22 after the first run of `v0.5.0` on staging with real
GenPhenAI output, revised the same day with the chosen direction, and **built
on `feat/gene-card-scannable-ranking`** — not yet deployed. What follows is the
reasoning behind the shape that now exists, kept because the constraints below
are the part worth re-reading before changing it again.

## The problem, seen on the real screen

Each gene rendered a full card: symbol, locus, curated summary (clamped to four
lines), "se estudia en relación con", the symptom comparison, and the reading
links. Every gene the model returned got one — `visibleGeneResults` is
`genphenResults` unsliced.

The result was a wall. On DYRK1A the summary runs 1,087 characters — kinase
autophosphorylation, Drosophila homologues — before the reader reaches anything
they can act on. The part that *is* actionable, the symptom comparison, sits at
the bottom in the same weight as everything else. Nothing signalled **why this
gene is in the list**, and you could not see more than one gene at a time.

That last point matters most. The guarantee the platform offers is *the correct
gene is among the top 20 in about 9 of 10 cases* — a statement about the
**set**. A screen that shows one gene at a time contradicts the very thing it
is promising.

## The shape: a scannable list that opens

**Collapsed by default — one compact row per gene.** The reader scans the
ranking, sees which genes engage with what they reported, and opens the one or
two worth reading. A row carries only what supports that choice:

```
  3  SPTBN1   2q24.3      ●●●○  3 de tus datos       Encefalopatía del desarrollo…
```

- rank, symbol, locus — the identity;
- **the match signal**, as both a count and something visible at a glance, so a
  row with 4 matches reads differently from one with 0 without being read;
- the leading condition as context, truncated, in subdued weight.

**Expanded on click — everything, in the reader's order.** The matched symptoms
first and named, then the frequent-but-not-reported list, then the conditions
in full, then the summary, then the links. Same content as before; inverted.

Rows expand independently and several can be open at once — comparing two
candidates is the actual task. The first row starts expanded, so the screen
does not open as an undifferentiated list.

## Rules that do not bend

- **The gene stays the headline.** The model predicts genes, not diseases. The
  condition on a collapsed row is truncated, subdued, and never the primary
  text. Expanded, conditions stay unranked and untruncated — ranking them would
  read as a differential the model did not produce. See `GENE_OUTPUT_DESIGN.md`.
- **The match count is ours, not the model's.** `/rank-genes` returns
  `matched_count: 0` and exposes nothing about why a gene ranked where it did.
  Our count is computed by comparing reported phenotypes against the gene's
  expected symptoms, and must be labelled as a comparison we made — never as
  the model's reasoning. Wording: *"coincide con lo que contaste"*, not *"por
  esto el modelo lo eligió"*.
- **Zero matches is not a negative signal.** 10% of genes carry no symptom data
  at all, so an empty comparison often means *we have nothing to compare*, not
  *this does not fit*. A row with no matches must not read as ruled out; absent
  data and absent match need different wording.
- **Not a self-assessment checklist.** The frequent-but-not-reported list stays
  framed as questions for a doctor.

## Fixed alongside

- **"Ver menos" on cards never expanded** — the toggle label was out of sync
  with the clamp state on first render.
- **Provenance tails.** `[proporcionado por RefSeq, julio…]` beside an English
  `[provided by RefSeq, Jul 2016]` read as broken. Stripped from display; it is
  metadata, not prose, and a test fails if the stripping is removed.

## Data defect, fixed

**809 texts across 781 genes were still in English** — 321 `tecnico_resumen_es`
and 488 `tecnico_funcion_es`. The two columns drift independently: a gene can
have a Spanish summary and an English function, or the reverse.

An earlier note here said 117, from a narrower keyword regex. The real
detector, `genesdb.translate_summaries.looks_english`, scores Spanish against
English function words and is the number to trust.

All 809 are translated (101 batches, 0 failed) and the pass was verified
additive: identical row and symptom counts, no other column touched.
`scripts/verify_db.py` now gates the scp and reports 0 untranslated. The new
database is **not yet copied to staging** — the one running there still has the
English text.

## Not a defect

The wizard completed end to end against the real HPO gateway and GenPhenAI, and
the earlier "session expired" was a one-off — not reproducible, and unrelated
to the RS256 change, which staging does not use (no keypair configured, so it
stays on HS256 for both signing and verification).
