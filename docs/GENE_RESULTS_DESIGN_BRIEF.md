
---

# The design that came back

Canvas: https://claude.ai/artifact/WVCbTZvYfh3jyGFX6GMFHt — six artboards
(four mobile screens, desktop with the professional view on, and a spec sheet).
Approved as the direction on 2026-09-22.

## What it decided

- **Three groups, not a ranking.** *Se relacionan con lo que contaste* / *sin
  relación* / *todavía no podemos compararlos*, with the model's position
  demoted to a grey `#3 de 20` at the margin — no circle, no medal. This is the
  only treatment faithful to a guarantee about the set of 20.
- **A four-segment meter as the primary signal**, one segment per thing the
  family reported. The denominator is theirs, so the claim is checkable.
- **The three states differ by fill, grey and dashes**, never by colour alone,
  so they survive printing and colour blindness. Nothing is red: no result on
  this screen is bad news.
- **The disease name is off the row entirely.** The gene identifies it;
  conditions appear only inside, plural, labelled *sin orden de relevancia,
  puede estar incompleta*. This is what stops the TCF4 defect telling a parent
  their child's problem is type 2 diabetes — and it holds even after the
  backend is fixed.
- **"Para preguntar en la consulta" in amber**, worded as questions for a
  professional, with an explicit line that they are not to self-assess.
- **A "hoja para la consulta"** as the screen's actual output, since the point
  of the screen is a conversation with a doctor.

## What the backend now provides for it

`reportados_cubiertos` — which reported phenotypes a gene engages, as HPO ids.
The meter's numerator. **Not `coincidencias.length`**: ARX matches 9 annotated
symptoms that trace back to 2 of the 4 things reported, and showing 9 would
overstate the overlap.

## Verified against the codebase

- `--lu-accent: #0d9488` is real, in the `medphenai` theme.
- The contrast figures are right to two decimals: `#0d9488` 3.74:1,
  `#115e59` 7.58:1, `#92400e` on `#fffbeb` 6.84:1.
- `--lu-accent-text` is not invented — `frontend/e2e/a11y.spec.ts` already
  names introducing it as the fix for known issue 1. The design supplies the
  value.
- The three-group split holds on real data (6 / 1 / 0 for the sample ranking).

## One contrast failure the spec did not catch

`#94a3b8` on white is **2.56:1**. It carries the `#1 de 20` rank text at
10.5px in `Main.dc.html` and `Anatomia.dc.html` — 11 instances — and fails
WCAG AA, which needs 4.5:1 at that size.

`#64748b` is already in the palette at 4.76:1 and reads as the same weight of
grey. Use it for the rank text. Do not ship the ranking with a new
`color-contrast` violation: `a11y.spec.ts` pins the current node count
precisely so this debt cannot spread.
