# Paso 2 — cargar síntomas

Escrito 2026-09-23. Decisiones tomadas y medidas antes de implementar; nada de
esto está construido todavía.

---

## 1. Un panel, no dos

Hoy el paso 2 se parte en mitades iguales: el relato clínico a la izquierda, los
términos HPO a la derecha. Las dos miden lo mismo y ninguna se presenta como la
principal, así que el lector tiene que decidir por dónde empezar — y la mitad
izquierda dice *"Opcional"* en su propio título.

**La lista de síntomas es el flujo.** Es lo único que el modelo recibe: el
request a `/rank-genes` lleva `hpo_ids` y nada más. El texto libre es una forma
cómoda de llegar a esa lista, no una entrada paralela.

Entonces:

- El buscador y los chips ocupan el ancho, arriba.
- El relato clínico pasa a ser una ayuda plegable — *"¿Tenés un informe médico?
  Pegalo y extraemos los síntomas"* — cerrada por defecto, abierta si el
  usuario ya escribió algo.
- Un solo botón primario. Hoy hay dos verdes llenos compitiendo («Buscar
  síntomas en el texto» y «Revisar y continuar»); el de buscar pasa a
  secundario, dentro del panel plegable.
- «Elegir síntomas de la lista» se va de la fila inferior, donde compite con
  «Revisar y continuar» y no se entiende en qué difiere del buscador. Entra al
  panel de síntomas como **«Explorar por sistema»**.

## 2. Avisar cuando un término aporta poco, y bajar por el grafo

> **Construido (2026-09-30), con un cambio sobre este diseño:** en vez de una
> fila con tres hijos, un diálogo que recorre el árbol completo (`Precisar` →
> `refine-term-dialog.tsx`), porque Mate pidió poder bajar varios niveles.
> Elegir un término en cualquier nivel reemplaza al síntoma y cierra el
> diálogo; «Ver tipos» baja un nivel. ~~Umbral: 100 genes y al menos un hijo
> con datos~~ — **reemplazado el 2026-10-02** por una regla según la posición
> en el árbol (2 hijos, 3 términos debajo, 50 genes; aviso con 10 debajo y
> menos de 8 síntomas), medida con pacientes reales en
> [`PRECISAR_SINTOMAS.md`](PRECISAR_SINTOMAS.md) (`frontend/src/lib/hpo-terms.ts`). La cobertura cuenta todos los
> descendientes, no tres niveles, así que "Convulsiones" da 1.560 y no 1.269.
> Datos: `hpo_terminos`, `hpo_hijos` y `termino_cobertura` en la base de genes
> (`scripts/add_term_tree.py` en diagnostic.ar-gene-profiles), servidos por
> `GET /api/hpo/terms` y `/api/hpo/terms/:id/children`.

### La métrica: cuántos genes toca el término

La intuición falla acá. *"Fiebre baja"* suena vago y **toca 1 solo gen**;
*"Micropene"* suena específico y **toca 214**. Lo que hace a un término útil no
es cuán clínico suena sino cuánto achica la búsqueda.

Medido sobre la base actual:

| Término | Genes que toca | Términos debajo |
|---|---|---|
| Fiebre baja | 1 | 0 |
| Dificultad para el lenguaje | 15 | 8 |
| Convulsiones febriles | 89 | 3 |
| Micropene | 214 | 0 |
| Convulsiones | **1269** | 51 |

La mediana de un término con datos es **3 genes**. Solo **250 de 8.854 (2,8%)**
tocan 100 genes o más, y apenas 4 tocan más de 1.000. La feature toca pocos
casos, y justo los que importan.

### Qué muestra

Cuando alguien elige un término que toca **≥ 100 genes** y tiene descendientes
con datos, aparece una fila bajo el chip:

> **Convulsiones** aparece en 1.269 genes. Si sabés de qué tipo, ayuda mucho:
> ¿febriles? ¿espasmos infantiles? ¿tónico-clónicas? · *Dejarlo así*

Reglas:

- **Nunca bloquea.** El chip ya está cargado; esto es una oferta, y *"Dejarlo
  así"* la cierra para siempre en esa sesión.
- **Sugiere solo descendientes que tengan datos** en nuestra base, ordenados por
  cuántos genes tocan. Ofrecer un término sin anotaciones empeora el input.
- **Como máximo tres**, y solo un nivel hacia abajo. Un árbol navegable es otra
  feature; esto es una pregunta.
- **Elegir un hijo reemplaza al padre**, no suma. Tener los dos es el doble
  conteo que ya arreglamos del lado de resultados.
- **Redactado como pregunta clínica, no como corrección.** No decir "tu síntoma
  es malo": decir qué haría la diferencia.

### Por qué del lado del input y no del output

En resultados esto aparece como *coincidencia parcial*: la familia dijo
"convulsiones" y las condiciones del gen describen "espasmos infantiles". Ahí
solo podemos informarlo. Acá se puede resolver, con la persona que sí sabe la
respuesta delante.

### Lo que hace falta y no tenemos

`hpo_ancestros` sirve para subir (hijo → padre). Esta feature necesita bajar
(padre → hijos), que es la misma tabla leída por `ancestro_id`, ya indexada. Lo
que falta es **el conteo de genes por término**, que hoy se calcula con un JOIN
sobre `sintomas_esperados`. Conviene materializarlo en la build: una tabla
`termino_cobertura (hpo_id, genes)` de ~8.900 filas.

---

## 3. Revisión del análisis externo

Un repaso punto por punto del análisis pedido aparte. **Cuatro de catorce están
equivocados o ya resueltos**, y vale la pena registrar por qué.

### Correctos y valiosos

**«Nuevo diagnóstico» contradice el resto.** Cierto y es el más barato de
arreglar: la pantalla de resultados insiste en que no es un diagnóstico y el
flujo se llama así. «Nueva búsqueda» o «Nuevo análisis».

**No se pueden marcar síntomas ausentes.** Cierto, y para el ranking es de lo
que más aportaría — pero ver la nota sobre el contrato del modelo, más abajo.

**«Elegir síntomas de la lista» está mal ubicado** y **hay dos botones primarios
compitiendo.** Ambos ciertos; resueltos por el punto 1.

**El textarea ocupa media pantalla siendo opcional.** Cierto; resuelto por el
punto 1.

**Sinónimos coloquiales en el autocomplete.** Cierto y valioso. Las etiquetas
oficiales en español son formales ("Retraso en el medro"), y un padre escribe
"no sube de peso". Es trabajo de datos, no de UI.

**«Manejar negaciones».** Cierto, y es un problema de seguridad. Este documento
lo marcaba como error diciendo que ya se manejaban: el contrato de
`/extract-hpo` tiene un campo `negated` y el wizard lo filtra en tres lugares.
Probado el 2026-09-24 contra staging, el extractor **nunca** lo pone en `true`:
*"El paciente no presenta convulsiones"* vuelve como Convulsiones presente, en
12 de 12 frases de prueba. El frontend filtra bien un campo que nunca llega.
El arreglo es del extractor, en `diagnostic.ar-api`.

**Guía de cantidad.** Razonable, con la salvedad de que el número correcto no
es "5 o más" sino algo medido. No lo tenemos medido.

### Equivocados

**«Mostrá qué tan informativo es cada síntoma», con "Fiebre baja" como ejemplo
de término que no aporta.** La idea es buena y es la del punto 2, pero el
ejemplo está al revés: *"Fiebre baja" toca 1 gen* y *"Micropene" toca 214*. Un
indicador construido sobre la intuición de qué suena vago habría marcado
exactamente el término equivocado.

**«Faltan sexo, edad y antecedentes».** Sexo y fecha de nacimiento **ya se
capturan** en el paso 1 y son obligatorios (`canGoStep1`). Lo que falta no es el
campo: es que el modelo los reciba.

**«El textarea tiene texto cargado: ¿es un placeholder?».** Ni placeholder ni
default visual. `"Carga manual de síntomas sin historia clínica detallada."` es
un **fallback que se guarda como historia clínica** cuando el campo queda vacío
(`page.tsx:751`). Aparece en el screenshot porque la vista de resultados lo
muestra de vuelta. Que un texto generado por nosotros quede almacenado como el
relato de una familia es un problema real, pero es otro problema: el campo
debería guardarse vacío.

**«El gris claro probablemente no pasa AA».** Se midió: `--lu-subtle` (#64748b)
da **4,55:1** sobre la superficie gris y **4,76:1** sobre blanco. Pasa. La
deuda de contraste real es otra y está registrada en `CLAUDE.md`: el acento
`--lu-accent` a 3,74:1, para la que ya existe `--lu-accent-text`.

### El punto que el análisis no llega a hacer

Tres de sus recomendaciones —síntomas ausentes, sexo y edad, antecedentes—
comparten un bloqueo que no menciona:

> **El modelo solo recibe `hpo_ids`.**
> `body: JSON.stringify({ hpo_ids, top_k })`

No hay campo para el sexo, para la edad ni para una ausencia. Agregar un toggle
"presente / descartado" a los chips no cambiaría el ranking en absoluto: mejor
input entra por una puerta que no existe.

Así que la secuencia correcta es al revés de la sugerida. Primero hay que saber
si GenPhenAI puede recibir fenotipos negados y demografía —una pregunta para el
equipo del modelo, en el otro repositorio—, y recién después construir la UI que
los capture. Construirla antes es pedirle a una familia datos que tiramos.

**Lo que sí mejora el ranking hoy, sin tocar el contrato:** el punto 2. Cambiar
*Convulsiones* (1.269 genes) por *Espasmos infantiles* mejora el input dentro
del único campo que el modelo lee.
