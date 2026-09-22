# Gene card — what to fix next

Written 2026-09-22 after the first run of `v0.5.0` on staging with real
GenPhenAI output. The pipeline works end to end; these are presentation and
data defects seen on the real results screen.

## The screen today

Each card renders: gene symbol, locus, the curated summary (clamped to four
lines), "se estudia en relación con", the symptom comparison, and the reading
links. Working, and too heavy to read.

---

## 1. The card is a wall of text that buries what matters

**The problem.** The summary dominates the card. On DYRK1A it runs 1,087
characters — a full paragraph about kinase autophosphorylation and Drosophila
homologues — before the reader reaches anything they can act on. Meanwhile the
part that *is* actionable, the symptom comparison, sits at the bottom in the
same weight and size as everything else.

Nothing on the card signals **why this gene is in the list**.

**Direction.** Invert the hierarchy. The reader's question is "does this match
my child?", not "what does this protein do":

- Lead with the **symptom comparison**, not the summary. That is the only part
  computed from *their* input.
- Give matches real visual weight — count, and the matched symptoms themselves.
  A card with 4 matches should look different at a glance from one with 0.
- Demote the summary: collapsed by default, or two lines maximum, opened on
  demand. It is context, not the headline.
- The disease under "se estudia en relación con" is the second most useful
  line and currently reads as a caption. It deserves more.
- Consider not rendering 50 full cards at all. A compact row per gene, expanded
  on click, would let someone scan the ranking instead of scrolling it.

**Constraint that does not bend.** The gene stays the headline over the
disease: the model predicts genes, not diseases. Conditions remain labelled
context, unranked and untruncated. See `GENE_OUTPUT_DESIGN.md`.

## 2. 117 summaries (2.2%) are still in English

**Measured**, not estimated: 117 of 5,228 `tecnico_resumen_es` values still
read as English — `TCF4`, `ABCD3`, `ACAT2`, `ADAMTS3` and others. TCF4 is
visible on the staging results screen right now, a full English paragraph on a
Spanish page.

These came through the rebuild's translation stage, which was interrupted twice
by the public endpoint blocking this machine. A few rows kept their source
text.

**Fix.** Re-translate just those 117 through the `claude` backend, the same way
the disease names were done. Cheap and bounded — one short run. The pass is
additive and resumable, so it only touches rows that are still English.

Worth adding a build-time check that counts English-looking summaries and fails
loudly, so this cannot ship again unnoticed.

## 3. Smaller things seen on the same screen

- **"Ver menos" appears on cards that were never expanded.** The toggle label
  is out of sync with the clamp state on first render for some cards.
- **Mixed-language line.** A Spanish summary ending in `[proporcionado por
  RefSeq, julio…]` next to an English one ending `[provided by RefSeq, Jul
  2016]` reads as broken even where the translation is fine. Consider stripping
  that provenance tail from the displayed text — it is metadata, not prose.
- **Genes with no matched symptoms** still render the full apparatus. They
  could be much quieter.

---

## Not a defect

The wizard completed end to end against the real HPO gateway and GenPhenAI, and
the earlier "session expired" was a one-off — not reproducible, and unrelated
to the RS256 change, which staging does not use (no keypair configured, so it
stays on HS256 for both signing and verification).
