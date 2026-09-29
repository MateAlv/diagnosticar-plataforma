# Panel de preguntas — diseño

Escrito 2026-09-28, antes de implementar. Parte de una auditoría con 146
capturas del estado actual (escritorio 1440×900 y Pixel 7, las dos vistas, todos
los estados) y del lenguaje visual que ya tiene la pantalla de resultados.

---

## 0. Para quién y en qué momento

| | Familia (vista por defecto) | Médico («Ver detalle médico») |
|---|---|---|
| Dispositivo típico | Celular, una mano | Escritorio, a veces con la familia al lado |
| Estado | Ansiedad, poca jerga, miedo a "responder mal" | Poco tiempo, quiere el término exacto y el porqué |
| Qué necesita del panel | Una cosa por vez, saber cuánto falta, permiso para no saber, ver que la lista no se rompe | Término HPO, qué gen sube con cada respuesta, efecto inmediato, poder volver al original |
| Qué no tiene que pasar | Leer un gen como veredicto; sentir que el orden es "la respuesta" | Tener que leer prosa para encontrar el dato |

Las dos vistas tienen **los mismos hechos a distinta profundidad** (principio de
`GENE_OUTPUT_DESIGN.md`). La vista es una preferencia recordada, no un rol.

## 1. Dirección elegida: tarjeta por pasos con "qué cambió"

Se evaluaron tres direcciones:
- **Tarjeta por pasos**, elegida.
- **Conversación tipo chat**, descartada: sugiere una consulta con un agente clínico, justo lo que el aviso regulatorio niega, e invita a preguntas que el producto no puede contestar.
- **Espacio partido con ranking en vivo**, postergada: para familias corona al primer gen como ganador.

Adentro, el panel se vuelve una superficie enfocada y por pasos. En esta primera
versión quedaba entre los genes y las especialidades; la sección 5 lo saca de ahí
y lo lleva a un panel lateral.

## 2. Estructura

```
┌ Panel (rounded-3xl, borde, shadow-sm) ─────────────────────────────┐
│ OPCIONAL · PODÉS DEJARLO CUANDO QUIERAS           ▰▰▱  Ronda 2 de 3 │ ← banda de encabezado
│ Afinar la lista con preguntas                                       │
│ ⓘ Este resultado no constituye un diagnóstico médico… (tira fina)   │ ← aviso regulatorio, textual
├─────────────────────────────────────────────────────────────────────┤
│ ┌ Qué cambió con tus respuestas ─────────────────────────────────┐ │ ← desde la ronda 2
│ │ SCNN1A ↑ 3.º→2.º   DNAH5 ↓ 2.º→3.º   CFTR = 1.º   Ver la lista ↑│ │
│ └─────────────────────────────────────────────────────────────────┘ │
│  ① ¿Se notó que la materia fecal es abundante y grasosa?     ✓     │ ← filas divididas, sin
│     Por ejemplo, que flota…                                         │   tarjeta dentro de tarjeta
│     [   Sí   |   No   |  No sé  ]   + Agregar un comentario         │ ← control segmentado
│  ────────────────────────────────────────────────────────────────  │
│  ② …                                                                │
│  ③ …                                                                │
├─────────────────────────────────────────────────────────────────────┤
│ [ Enviar respuestas · 2 de 3 ]        Terminar acá                  │ ← barra de acción
└─────────────────────────────────────────────────────────────────────┘   (fija abajo en celular)
```

### 2.1 Encabezado
- **Contenido.** Se conserva el ceja mono y el `h3`, igual que en la tarjeta de genes y la de especialidades.
- **Progreso.** Se suman **tres segmentos** con el mismo idioma del medidor de coincidencia (píldoras de 26×8 px, relleno `accent-text`, vacías en `border-strong`) y la leyenda «Ronda 2 de 3».
- **Ninguna ronda es obligatoria.** El texto «de 3» es el tope, no una meta.
- **Aviso regulatorio.** Va textual, en una **tira fina** con ícono (`text-xs`), ámbar como el aviso de la página: es el mismo aviso, en su color. El test pide que se vea mientras hay preguntas en pantalla, y va primero en el panel para que siempre esté en el viewport.

### 2.2 Preguntas
- **Sin tercer nivel de tarjetas.** Son filas divididas dentro del panel, con número en círculo (①②③). El número pasa a ✓ cuando la pregunta tiene respuesta.
- **Texto de la pregunta.** 17 px, semibold, `leading-snug`. La ayuda va en 14 px, `text-subtle`.
- **Respuesta.** Un **control segmentado** de ancho completo: tres celdas iguales de 48 px, `whitespace-nowrap`, con «No sé» en una sola línea. Semánticamente es un `radiogroup`, con flechas del teclado.
  - El estado elegido es neutro para las tres opciones (relleno `accent-light`, borde y texto `accent-text`, ícono ✓). Ni verde ni rojo: responder "no" no es malo.
- **Enfoque.** Al responder, si la siguiente pregunta sin responder quedó fuera de vista, se desplaza suavemente hasta ella. Con `prefers-reduced-motion` el salto es inmediato, y nunca se mueve el foco del teclado sin acción del usuario.
- **Comentario.** Es un botón fantasma «+ Agregar un comentario», que abre un `textarea` con contador (280). Una vez escrito se muestra como cita debajo de la respuesta, con «Editar».

### 2.3 Capa médica (solo en «Ver detalle médico»)
Por pregunta, debajo del texto:
- **Chip del término** en mono: `HP:0001738 · Insuficiencia pancreática exocrina`, igual que los ids HPO del detalle del gen.
- **Por qué preguntamos:** el `rationale`, en 14 px.
- **Genes asociados** (desde 5.9): una sola fila, «Asociado a», seguida de chips de gen `CFTR #1` `SCNN1A #3` (los `genesIfYes`). Debajo va la nota: Un «Sí» se suma a los síntomas que usa el modelo.
  - No hay fila para el «No», porque un «No» no llega a ninguna lista. Tampoco se muestra en una ronda guardada antes, cuando el agente todavía mandaba genes para el «No».
- **Chips de gen.** Tienen el estilo de los de la tarjeta de especialidades, muestran el puesto actual en la lista y **abren el modal del gen**.
- **Origen del texto.** La advertencia «Algunas preguntas se generaron sin IA» se muestra solo acá.

### 2.4 Barra de acción
- **Texto del botón.** «Enviar respuestas · 2 de 3». Nunca se ve deshabilitado.
- **Si faltan respuestas** al tocarlo: desplaza a la primera sin responder, le pone una regla izquierda `accent-text` y el texto «Falta responder esta». Además, en la región viva, anuncia «Te falta responder 1 pregunta».
- **Al pie del panel.** La barra queda **fija abajo** mientras el panel está en pantalla (`sticky bottom-0` dentro del panel, fondo blanco con borde superior y sombra suave). Desde la sección 5 el panel es angosto en todos los anchos, así que la barra lleva solo el botón de enviar y «Terminar acá» va después de la última pregunta.
- **«Terminar acá».** Es un botón secundario. Pide una **confirmación en línea**: «¿Terminar ahora? Vas a ver el resumen con lo que respondiste». Terminar es final.

### 2.5 Espera (15–60 s)
- **Formulario.** Se reemplaza por **tres filas esqueleto** que respiran, con `motion-safe`.
- **Texto.** «Eligiendo las preguntas que más ayudan a ordenar la lista · 14 s», con el mismo contador de segundos que la espera del paso 2. Debajo, una sola línea que rota cada ~8 s:
  - «Tu lista original sigue guardada.»
  - «Puede tardar hasta un minuto y medio.»
  - «Mientras tanto podés ocultar este panel y mirar la lista.»
- **Accesibilidad.** `aria-busy`, y la región `role="status"` montada antes de la espera.

### 2.6 "Qué cambió" (desde la ronda 2 y al final)
- **Qué muestra.** Una tarjeta chica al principio de la ronda nueva: los genes que se movieron entre la lista anterior y la nueva (hasta 4, primero los que más se movieron) con píldoras `↑ 3.º→2.º`, `↓ 2.º→3.º`, más el que sigue primero si no se movió.
  - Un gen que la lista anterior no tenía lleva la píldora «nuevo» (5.10).
  - Los que quedaron fuera se nombran en una línea («Quedaron fuera de esta lista: …»), solo si estaban dentro del largo de la lista nueva.
- **Enlace.** «Ver la lista con tus respuestas» pone esa vista en la grilla (5.8) y lleva hasta ella. Con el panel acoplado la flecha es `←`, porque la lista está al lado; en cajón y hoja no lleva flecha: el enlace oculta el panel. Mientras se ve el aviso «Hay una lista con tus respuestas» (5.5), el enlace no se repite.
- **Tono.** Neutro: se mueve un **lugar en la lista**, nunca «más probable».
- **Sin atribución** (desde 5.9). Ningún movimiento se acredita a una respuesta: el modelo volvió a ordenar toda la lista con los síntomas confirmados. La tarjeta lo dice en una línea: «El modelo volvió a ordenar la lista con los síntomas que confirmaste.» Igual en las dos vistas, en la copia y en la impresión.

### 2.7 Final: "Para conversar en la consulta"
- **Qué pasa con el panel.** Pasa a ser **la salida**, no un apéndice.
  - Encabezado «Para conversar en la consulta».
  - El resumen en una tarjeta `accent-light` suave, en 16 px.
  - Luego las respuestas.
- **Vista familia.** Chips agrupados «Dijiste que sí» / «Dijiste que no» / «No sabías», con la etiqueta HPO y la nota como cita.
- **Vista médica.** Una tabla compacta: id HPO (mono), término, respuesta, nota y genes que movió.
- **Acciones.**
  - **«Copiar resumen»**: al portapapeles, en texto plano con el aviso incluido.
  - **«Imprimir»**: CSS de impresión que imprime solo este bloque, la lista de genes y el aviso.
  - La lista de la hoja, copiada o impresa, es siempre **la del modelo**. El orden con las respuestas se agrega después, rotulado «Orden con tus respuestas» con la aclaración de 5.8, solo si quien lee lo eligió en la grilla.
  - Es la primera parte de la "hoja para la consulta".
- **Motivo de cierre.** Con copy sin certeza, por ejemplo «Las preguntas que quedaban ya no cambiaban el orden de la lista».

### 2.8 Entrada
- **Tarjeta de entrada.** Más clara, sin agregar color:
  - Título «¿Querés afinar la lista?».
  - Tres hechos en chips: «3 preguntas por ronda», «hasta 3 rondas», «≈ 30 s por ronda».
  - La línea «Tu resultado original queda guardado y podés volver a él».
  - Un botón primario «Empezar las preguntas».
- **Segunda entrada.** Una línea bajo la frase «El sistema sugiere genes…», arriba de la grilla: «¿Querés afinar esta lista? **Respondé unas preguntas**», que lleva al panel. En celular la tarjeta queda a 6 pantallas con 20 genes; sin esta línea casi nadie la encuentra.
- **Con el panel lateral (sección 5).** Esta tarjeta es lo que muestra el panel al abrirse antes de empezar, con «Empezar las preguntas» fijo al pie. La línea de invitación abre el panel en vez de desplazar la página.

### 2.9 Grilla de genes refinada
- **Movimiento.** La píldora pasa a `↑ 3.º → 2.º` / `↓ 2.º → 3.º` / `= 1.º`, o «nuevo», en `nowrap`. Se mide siempre contra la lista que la página mostró antes de las preguntas (5.10).
  - Sube en `accent-text`; baja en `subtle`; nunca rojo.
  - La etiqueta accesible conserva la frase completa.
- **Alternar listas.** El enlace de "volver al original" pasa a ser un **control segmentado** `[Original | Con tus respuestas]` en la banda de encabezado de la grilla, junto a «Ver detalle médico».
  - **«Original» es la vista por defecto, siempre**, también justo después de una ronda (ver 5.8).
  - Cuando existe la lista con las respuestas, debajo del control va la línea «La lista con tus respuestas es orientativa: todavía estamos evaluando si mejora el orden.»
  - La elección se recuerda mientras dura la página, rondas incluidas, y no entre cargas.
- **Reordenamiento.** Animación FLIP de las tarjetas, `motion-safe`, 250 ms, **solo cuando quien lee cambia de lista**. Una ronda que reordena la lista con respuestas en pantalla no anima.
- **Modal del gen.** En la vista con las respuestas suma una línea neutra, igual en las dos vistas: «Se movió cuando el modelo volvió a ordenar la lista con los síntomas que confirmaste.» No dice qué respuesta lo movió (5.9).
- **«No presenta».** Los hallazgos negados del relato y los «No» de las preguntas se muestran en las dos vistas, con «Quedan registrados para la consulta; hoy no cambian el orden de ninguna lista.»

### 2.10 Errores
- **Color propio.** Van en **pizarra con ícono ámbar**, no en la caja ámbar del aviso regulatorio.
- **Un solo botón.** Hay un solo «Probar de nuevo», y solo cuando reintentar puede servir.
- **Límite por hora.** Sin botón; dice cuándo volver.
- **Límite de la plataforma** (`global_limit`, 429 con `Retry-After`). «Diagnostic.ar llegó al máximo de preguntas por ahora. Tu resultado no cambió; podés seguir en unas 2 horas.» Igual que el límite por hora, sin botón hasta que pase la espera; a diferencia de él, no le atribuye el límite a quien pregunta.
- **Siempre** dicen «Tu resultado no cambió».

## 3. Corrección previa (P0)

`<main className="overflow-hidden">` (`page.tsx`) deja que `scrollIntoView`
desplace `main` sin forma de volver: al empezar las preguntas, el encabezado
de resultados queda 224 px por encima del viewport en celular. Se corrige con
`overflow-clip`, que recorta igual pero no crea un contenedor desplazable.
`page.tsx` tiene el mismo patrón latente en otro lugar.

## 4. Lo que no cambia

- **Tokens.** Mismos tokens y ningún color nuevo:
  - `accent-text` para primarios y "sí";
  - `accent-light` para rellenos confirmados;
  - punteado `accent-text` para "de las preguntas";
  - pizarra para lo secundario.
- **Radios.** `rounded-3xl` para las secciones, `rounded-2xl` para las cajas internas, `rounded-xl` para los controles y `rounded-full` para los chips.
- **Qué se retiene en la vista familia.** Genes, porcentajes, `rationale` y todo texto escrito en modo médico, aunque llegue.
- **Frases fijas.**
  - Todos los errores dicen «Tu resultado no cambió».
  - «No sé» aparece como respuesta válida.
  - Nada de rojo.
- **Accesibilidad.** Objetivos de 44 px o más; foco al encabezado de la ronda; axe limpio (serio y crítico).

## 5. El panel sale de la grilla: panel lateral que se muestra y se oculta

Decidido por Mate el 2026-09-28. Las preguntas dejan de ser una sección entre los
genes y las especialidades y pasan a un **panel propio al costado**, que se trae
a la vista y se oculta cuando uno quiere, sin perder el progreso. Todo lo de las
secciones 2.1–2.7 (encabezado, filas, control segmentado, capa médica, barra de
envío, espera, "qué cambió", resumen) sigue igual: cambia **dónde vive**, no
**qué muestra**.

### 5.1 Por qué al costado
- **Escritorio.** Los genes y las preguntas se ven a la vez: se responde a la derecha y la lista se reordena a la izquierda, sin ir y venir.
- **Celular.** La grilla deja de ser un camino obligado de seis pantallas hasta llegar a las preguntas: el panel se abre desde cualquier punto.
- **Ninguna vista.** Las preguntas no compiten con los genes por el espacio de la grilla.

### 5.2 Tres comportamientos según el ancho
| Ancho | Panel abierto | Panel oculto |
|---|---|---|
| ≥ 1280 px (xl) | **Acoplado**: columna derecha de 420 px dentro de la tarjeta de la página, `sticky` bajo el encabezado, alto de hasta `100dvh − encabezado − 32 px`, con scroll interno. La grilla pasa a dos columnas. | La grilla vuelve a ocupar todo el ancho. |
| 768–1279 px | **Cajón derecho** superpuesto, de `min(440px, 92vw)`, con fondo oscurecido. | — |
| < 768 px | **Hoja inferior** de `92dvh` con esquinas superiores redondeadas, manija visual y botón «Ocultar». | — |

- **Cajón y hoja.** Son diálogos modales (Radix Dialog, ya en el proyecto): atrapan el foco, se cierran con Esc o tocando el fondo y devuelven el foco al lanzador.
- **Panel acoplado.** Es un `<aside>` complementario: no atrapa el foco, y Esc lo oculta solo si el foco está adentro.
  - **Alto.** Ocupa desde su borde superior hasta el pie de la pantalla y nunca pasa del final de los resultados. Así, al final de la página no queda empujado bajo el encabezado con el aviso adentro.
  - **Al abrirse.** Si entra menos del 70 % de su alto, la página se mueve lo justo para que lo tenga entero.
- **Animación.** Entra con un deslizamiento de 220 ms, `motion-safe`; con movimiento reducido aparece sin animación.

### 5.3 El lanzador
Una píldora fija abajo a la derecha. En celular va centrada y respeta el área segura.
- **Estilo.** Relleno `accent-text`, texto blanco, 52 px de alto, sombra suave.
- **Visibilidad.** Solo se ve con el panel oculto, y bajo las mismas condiciones que antes: función habilitada, no demo, resultado sin error ni baja confianza, `diagnosisId` presente.
- **Qué dice según el estado:**
  - sin empezar: «Afinar la lista» y el detalle «3 preguntas por ronda»;
  - con preguntas pendientes: «Seguir con las preguntas», con los tres segmentos y «Ronda 2 de 3»;
  - esperando la próxima ronda: «Preparando preguntas…» con un indicador. Cuando llegan, cambia a «Preguntas listas» sin abrirse solo;
  - terminado: «Ver el resumen para la consulta».
  - Mientras se arma el resumen dice «Armando el resumen…». Si el último pedido falló con el panel oculto, el detalle pasa a «Hubo un problema · tu resultado no cambió».
- **Otras entradas.** La línea de invitación arriba de la grilla y el botón «Afinar con preguntas» de la banda del panel de genes **abren el panel**; ya no desplazan la página.
- **Accesibilidad.** `aria-expanded` y `aria-controls`.

### 5.4 Encabezado del panel
Ceja, título, progreso, y la acción **«Ocultar»** (no «Cerrar»: cerrar suena a
terminar), con la aclaración «Tus respuestas quedan guardadas». La aclaración es
la ceja misma, junto al botón, y lo describe para los lectores de pantalla.
Debajo, la tira del aviso regulatorio, siempre visible mientras el panel está
abierto. El aviso del pie de la página queda siempre en su lugar.

### 5.5 Qué pasa con la lista mientras tanto
- **La grilla no cambia sola.** Después de una ronda sigue mostrando la lista del modelo; el orden con las respuestas queda disponible en el control «Original | Con tus respuestas» (5.8). Si quien lee eligió esa vista, la grilla la sigue ronda a ronda, sin animación.
- **Escritorio.** La lista queda al lado del panel; el enlace del recibo «Ver la lista con tus respuestas» cambia la vista.
- **Celular y tableta.** Al llegar una ronda, el panel muestra arriba «Hay una lista con tus respuestas · Verla». Ese aviso oculta la hoja o el cajón, pone esa vista y lleva a la grilla. El lanzador queda en «Seguir con las preguntas». En tableta el cajón también tapa la lista, así que lleva el mismo aviso.
- **En celular**, el botón «Afinar con preguntas» de la banda del panel de genes no se muestra: el lanzador está abajo y los controles de la banda quedarían apilados de a tres. Desde `md` vuelve.

### 5.6 Lo que se va
- La tarjeta de entrada entre los genes y las especialidades: la reemplazan el lanzador y las dos entradas de 5.3.
- El test que fijaba el panel entre genes y especialidades. Lo reemplazan tests de abrir, ocultar y retomar por ancho.

### 5.7 Resumen sin recomendaciones
Por decisión de Mate (2026-09-28), el resumen final no sugiere estudios ni pasos
clínicos en ninguna vista: solo repasa qué se preguntó, qué se respondió y cómo
se movió la lista.

### 5.8 La lista del modelo es la lista
Decidido el 2026-09-28, con una evaluación sobre 501 pacientes publicados: el
orden ajustado con las respuestas **no mejora** el del modelo; en el mejor de
los casos queda igual. El producto no puede presentarlo como una mejora.
- **Por defecto.** La grilla, el resumen, la copia y la impresión muestran siempre la lista del modelo.
- **Opcional.** El orden con las respuestas es una segunda vista que hay que pedir, con la aclaración de 2.9 a la vista.
- **Lenguaje.** Los avisos dicen que **hay** otra lista, no que la lista «se actualizó».
- **Qué no cambia.** El recibo «Qué cambió con tus respuestas» sigue en el panel, porque describe esa segunda vista.

### 5.9 Solo los «Sí» llegan al modelo
Decidido por Mate el 2026-09-28, a partir de la auditoría sobre pacientes reales.
- **Qué cambió.** El agente le manda al modelo de diagnostic.ar solo los hallazgos respondidos «Sí», como síntomas extra. La lista con las respuestas es el ranking del propio modelo con esos síntomas sumados.
- **Los «No».** Ni los «No» ni los hallazgos negados del relato cambian ninguna lista: quedan registrados para la consulta. Que el modelo tome en cuenta lo que se descarta queda como trabajo futuro, del lado del modelo.
- **En el contrato.** En modo médico `genes_if_no` llega vacío.
- **Consecuencias en pantalla:**
  - la capa médica muestra «Asociado a» y no «Si responde No» (2.3);
  - «Qué cambió» y el modal del gen no atribuyen movimientos a una respuesta (2.6, 2.9);
  - la tabla y la copia médica listan, por cada «Sí», los genes asociados;
  - la entrada dice que lo que se confirma con «Sí» se suma a lo que analiza el modelo y que los «No» y «No sé» quedan anotados para la consulta.

### 5.10 Los movimientos se miden contra la lista mostrada antes
Desde 2026-09-29 el agente vuelve a correr el modelo en cada ronda con los
hallazgos confirmados.
- **`model_rank`.** En `ranking[]` pasa a ser el puesto del gen **en esa misma lista re-ordenada**, no el de la lista original del modelo, así que la pantalla no lo usa para nada.
- **Movimientos.** Las píldoras de las tarjetas, el recibo «Qué cambió», la nota del modal del gen y el texto para copiar e imprimir comparan la lista con las respuestas contra **la lista que la página mostró antes de las preguntas**, es decir, el primer resultado de `/rank-genes`. Entre rondas, el recibo de una ronda compara contra la lista con respuestas de la ronda anterior.
- **Genes nuevos.** Uno que no estaba en esa lista lleva «nuevo» («Entra en la lista con tus respuestas, en el puesto N»).
- **Genes que salen.** Los que salieron se nombran en el recibo, solo los que estaban dentro del largo de la lista nueva: que una lista más corta deje afuera la cola no es noticia.
- **Especialidades.** Cambian entre rondas porque salen de cada nueva corrida. Siguen la vista elegida: «Original» muestra las del primer resultado; «Con tus respuestas», las de la última ronda. Ninguna pantalla muestra la confianza.

## 6. Verificación

Cada estado de la auditoría se vuelve a capturar en escritorio y Pixel 7 y en
las dos vistas, y se compara lado a lado. Además:
- Pasa la suite E2E existente, más estos tests nuevos:
  - validación visible;
  - "qué cambió";
  - copiar e imprimir;
  - confirmación de terminar;
  - control segmentado de la grilla;
  - FLIP sin movimiento con `reduced-motion`;
  - P0: el encabezado sigue alcanzable después de empezar;
  - panel lateral: abrir, ocultar y retomar sin perder respuestas; aviso a la vista con el panel abierto; acoplado, cajón y hoja según el ancho; las dos entradas; los estados del lanzador; límite de la plataforma.
- `make ci` completo.
