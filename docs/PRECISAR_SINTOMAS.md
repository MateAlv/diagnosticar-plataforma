# Cuándo ofrecer «Precisar» un síntoma

Análisis del 2026-10-02. Define cuándo el paso 2 del asistente le ofrece a la
persona precisar un síntoma (cambiar, por ejemplo, «Convulsiones» por un tipo
más específico) y cuándo además lo señala con el aviso amarillo. La regla está
en `frontend/src/lib/hpo-terms.ts`; los conteos por término los calcula el
backend (`geneProfileRepository.ts`) a partir del árbol de `genes.db`.

## Resumen

| | Regla | Términos del HPO | Pacientes reales |
|---|---|---|---|
| **Chip «Precisar»** | al menos **2 hijos** con genes, **3 términos debajo** con genes y **50 genes** o más | 1.148 de 10.785 | aparece en el 85% de los casos, 3,2 síntomas por caso |
| **Aviso «síntomas muy amplios»** | lo anterior y **10 o más términos debajo**, solo mientras la lista tiene **menos de 8 síntomas** | 737 | aparece en el 22% de los casos, 1,5 síntomas cuando aparece |

Antes la regla era «100 genes o más y algún hijo», y el aviso salía siempre.
Ofrecía, por ejemplo, precisar «Pectus excavatum», cuyo único hijo es un caso
particular («región inferior del esternón») y no un tipo para elegir.

## La pregunta

Un término es «general» si está alto en el árbol HPO: tiene muchas formas más
específicas debajo. Hay tres maneras de medir eso, y una cuarta cosa que
importa:

- **Profundidad** (distancia a la raíz): descartada. Las ramas del HPO tienen
  largos muy distintos: «Convulsiones» está a profundidad 3 con 104 términos
  debajo; «Microcefalia», a 6 con 4.
- **Hijos**: cuántos términos directamente debajo alcanzan algún gen. Con uno
  solo no hay elección.
- **Términos debajo**: cuántos términos, a cualquier distancia, alcanzan algún
  gen. Es la mejor medida de «qué tan arriba está».
- **Genes**: cuántos genes alcanza el término. No dice dónde está en el árbol,
  pero sí cuánto ordena el ranking por sí solo.

Solo se cuentan términos que alcanzan algún gen: elegir uno sin genes le daría
al modelo un término que no conoce.

## Datos

- `genes.db` con el árbol (`scripts/add_term_tree.py` de
  diagnostic.ar-gene-profiles): 19.408 términos, 10.785 con al menos un gen.
  Los conjuntos de genes por término reconstruidos para el análisis coinciden
  exactamente con `termino_cobertura`.
- **Pacientes reales**: phenopacket-store 0.1.27, 10.374 casos publicados con
  sus síntomas (mediana 7 por caso) y, en los usados para el experimento, un
  único gen causal.
- **Modelo**: el de producción (checkpoint `ee10aa42…`), corriendo en local.

## Cómo se ven los términos

| Término | Genes | Hijos | Debajo | Chip | Aviso |
|---|---|---|---|---|---|
| Convulsiones | 1.560 | 12 | 104 | sí | sí |
| Anomalía de la morfología cardíaca | 1.078 | 17 | 175 | sí | sí |
| Talla baja | 952 | 4 | 20 | sí | sí |
| Hiperlaxitud articular | 349 | 4 | 14 | sí | sí |
| Hipotonía muscular | 1.509 | 9 | 12 | sí | sí |
| Escoliosis | 758 | 4 | 9 | sí | no |
| Discapacidad intelectual | 1.558 | 5 | 5 | sí | no |
| Retardo global del desarrollo | 1.671 | 4 | 4 | sí | no |
| Microcefalia | 1.052 | 2 | 4 | sí | no |
| Rigidez articular | 54 | 6 | 6 | sí | no |
| Neurofibromas | 10 | 2 | 4 | no (pocos genes) | no |
| Ectopia del cristalino | 36 | 2 | 2 | no (2 hojas) | no |
| Pectus excavatum | 234 | 1 | 1 | no (un solo hijo) | no |
| Aracnodactilia | 73 | 0 | 0 | no (hoja) | no |

En casos reales, los términos que más disparan el chip son Retardo global del
desarrollo, Retraso del lenguaje, Discapacidad intelectual, Hipotonía, Talla
baja, Convulsiones y Microcefalia: los síntomas con los que más se consulta.

## ¿Precisar mejora el resultado?

Para medirlo sin depender de que alguien elija bien, se hizo al revés: en 800
pacientes reales se tomó un síntoma preciso cuyo padre directo cumple «hijos ≥ 2
y debajo ≥ 3», se lo reemplazó por ese padre y se comparó el puesto del gen
causal en los dos rankings. La diferencia es lo que vale saber el tipo.

| Grupo | Casos | Mejora | Empeora | Δ MRR | Top 10 (general → preciso) |
|---|---|---|---|---|---|
| Todos | 800 | 29% | 20% | +0,011 | 67,0% → 68,6% |
| 3–4 síntomas en el caso | 159 | 35% | 26% | +0,034 | 55,3% → 59,7% |
| 5–7 síntomas | 205 | 37% | 23% | +0,031 | 62,9% → 63,9% |
| 8–14 síntomas | 315 | 26% | 18% | −0,009 | 72,1% → 73,7% |
| 15 o más | 121 | 14% | 9% | 0,000 | 76,0% → 75,2% |
| Padre con menos de 50 genes | 75 | 17% | 20% | +0,014 | 81,3% → 82,7% |
| Padre con 50–150 genes | 117 | 29% | 15% | +0,015 | 73,5% → 75,2% |
| Padre con 500–1.000 genes | 186 | 33% | 18% | +0,023 | 63,4% → 67,7% |
| Padre con más de 1.000 genes | 192 | 30% | 26% | −0,001 | 58,9% → 59,9% |
| Padre con 10 o más debajo | 487 | 29% | 22% | +0,019 | 65,7% → 67,4% |

Lo que dicen los números:

1. **El efecto de precisar un solo síntoma es chico** en promedio: mejora el
   puesto en 29% de los casos y lo empeora en 20%. En el resto no cambia.
   Precisar es una mejora opcional, no algo que haya que exigir; por eso nada
   bloquea y siempre está «Dejarlo así».
2. **Importa cuando hay pocos síntomas.** Con 3 a 7, el gen correcto entra al
   top 10 hasta 4 puntos más seguido; con 8 o más el resto de la lista ya
   ordena y precisar uno no cambia nada. De ahí que el aviso desaparezca desde
   8 síntomas (el chip queda).
3. **Con menos de 50 genes no ayuda**: el término ya ordena por sí solo, y
   precisarlo empeora tan seguido como mejora. De ahí el piso de 50 genes. Es
   el papel de la cantidad de genes: no dice dónde está el término, pero sí si
   queda algo por ganar.
4. **Que empeore a veces es esperable**: muchos genes están anotados solo con
   el término general (en «Talla baja», el 79% de sus genes no tiene ningún
   tipo anotado). Si la persona precisa un tipo que esos genes no tienen
   registrado, el gen correcto puede bajar. Otra razón para ofrecer y no
   insistir.
5. **Los términos con más de 1.000 genes no rinden más** (Retardo global,
   Discapacidad intelectual): sus hijos son grados de severidad (leve,
   moderado, severo), que distinguen poco entre genes. Por eso el aviso
   depende de cuánto árbol hay debajo, no de cuántos genes tiene.

## Límites, y qué no se midió

- Los umbrales (2, 3, 10, 50, 8) son cortes razonables sobre estas curvas, no
  óptimos estadísticos: las diferencias entre grupos vecinos son de pocos
  puntos y con 800 pares tienen ruido.
- El experimento cambia un solo síntoma por caso. Precisar varios a la vez
  puede sumar más.
- El modelo se entrenó con casos sintéticos y en pacientes reales acierta el
  top 1 en el 43%: un modelo mejor puede cambiar cuánto vale precisar.
- Los casos publicados no son los de una familia que escribe en el asistente:
  tienen más síntomas y más precisos que los que carga una familia, lo que
  probablemente subestima el valor de precisar.

## Reproducir

Los scripts están en `docs/analysis/precisar/` y `results.json` es la salida
usada acá.

```bash
cd docs/analysis/precisar
GENES_DB=genes.db python3 metrics.py HP:0001250 HP:0000767      # conteos de un término
# El modelo de diagnostic.ar-api corriendo en local (services/genphenai, puerto 18022):
GENES_DB=genes.db PHENOPACKETS_ZIP=all_phenopackets.zip \
  MODEL_URL=http://127.0.0.1:18022 python3 experiment.py 800
```

Si cambian los umbrales, cambian también `frontend/tests/hpo-terms.test.mjs`
(que usa los términos de la tabla) y `e2e/refine-terms.spec.ts`.
