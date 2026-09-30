# Revisión de textos y experiencia de uso — 2026-09-30

Revisión de todo el frontend (landing, acceso, asistente, resultados, preguntas,
«Mis búsquedas», backoffice) con cinco criterios: texto incompleto o roto, mala
experiencia, no se entiende, no es bueno para un paciente, resta
profesionalismo. Se hizo leyendo cada texto visible en el código de `main`
(f758115) y mirando capturas del asistente en escritorio y en celular.

Cada hallazgo de prioridad 0 y 1 se verificó en el código; los que no se
pudieron verificar están marcados. Dos afirmaciones de la revisión quedaron
desactualizadas y se corrigen acá: **el extractor de staging sí descarta las
negaciones** (el reconocedor nuevo, desde v0.9.1; producción todavía usa el
viejo, que no), y la metodología de la landing describe el extractor viejo.

Rutas relativas a `frontend/src/` salvo que se indique.

---

## Prioridad 0 — errores reales, legales o de seguridad

| # | Dónde | Qué pasa | Qué hacer |
|---|---|---|---|
| 0.1 | `app/nuevo/page.tsx` 88-92, 789, 810, 815 | **Se inyectan tres síntomas de ejemplo en la búsqueda de un paciente real** («Fatiga persistente», «Dolor abdominal», «Cambios en peso») cuando se entra a `/nuevo?step=2|3` sin borrador — por ejemplo, al recargar después de «Regenerar». Además `HP:0004324` es «Aumento de peso corporal», no «Cambios en peso». | No precargar nada nunca. Sin borrador: lista vacía y «No pudimos recuperar los síntomas anteriores. Cargalos de nuevo o volvé a tu lista.» |
| 0.2 | `lib/especialidades.ts` vs. `specialist_recommendation.py` (API) | **Especialidades en inglés**: el servicio devuelve Audiology, Cancer, Gastrohepatology, Growth disorders, Haematology, Respiratory, Multispecialty, Ultra-rare disorders, Unknown, Viral research; ninguna está en el diccionario, así que se muestran tal cual — incluso «Unknown» o «Viral research» como «especialidad a consultar». Los fixtures del mock ocultan el problema. | Completar el mapa; excluir Multispecialty/Ultra-rare/Unknown/Viral research; nunca mostrar un nombre sin traducir; corregir los fixtures. |
| 0.3 | `app/nuevo/page.tsx` 1683-1754 | La **demo** (lo que ve cualquier visitante) muestra resultados **sin el aviso legal**: `{disclaimer}` solo se renderiza fuera de la demo (1957). | Mostrar el aviso también en la demo. |
| 0.4 | `app/diagnosticar/page.tsx` 449, 502-516 | La etiqueta **«Diagnóstico automático»** afirma justo lo que el producto no es, y el detalle de la persona muestra la especialidad **sin el aviso legal**. | «Resultado orientativo · no es un diagnóstico» y `RESULTS_DISCLAIMER` bajo la especialidad. |
| 0.5 | `app/sign-up/page.tsx` 294; `app/home/page.tsx` 548-549 | «Acepto los términos y condiciones **(mock)**»: se exige aceptar términos que no existen; **Términos y Privacidad apuntan a `#`**. Con historias clínicas de chicos, la Ley 25.326 pide una política real. | Páginas `/terminos` y `/privacidad` reales (qué se guarda —IP incluida—, cuánto, quién accede, cómo borrar) y enlaces en el registro. |
| 0.6 | `app/home/page.tsx` 113; `app/sign-up/page.tsx` 130-137 | Promesas falsas: «privacidad total» (se guardan IP y navegador sin plazo), «no pedimos datos identificatorios» (Google guarda nombre real y foto), «la opción de re-contacto es opcional» (no existe). | Reescribir con lo que realmente pasa y enlazar a la política. |
| 0.7 | `app/nuevo/page.tsx` 366-372, 744-752 | El **relato clínico queda en `localStorage`** con una clave global: sobrevive a «Cerrar sesión» y aparece precargado al próximo usuario de esa computadora. | Borrarlo al cerrar sesión; guardarlo por usuario y paciente; al volver, «¿Usar el texto que no llegaste a analizar?». |
| 0.8 | Todo el acceso | **No hay recuperación de contraseña.** Una familia que la olvida pierde sus búsquedas. Tampoco se puede borrar una persona ni la cuenta (derecho de supresión). | Flujo «¿Olvidaste tu contraseña?»; «Eliminar esta persona»; «Mi cuenta». |
| 0.9 | `app/` | **No existen `not-found.tsx` ni `error.tsx`**: se ven las páginas por defecto de Next, en inglés y sin salida. | 404 y error propios, con «Volver al inicio». |
| 0.10 | `app/nuevo/page.tsx` 996-1022 | Volver con «Atrás» desde resultados y buscar de nuevo **crea un integrante duplicado** con el mismo nombre. | Conservar el `patientId` y regenerar sobre ese paciente. *(No verificado a mano.)* |
| 0.11 | Errores crudos | Se muestran mensajes del servidor en inglés o técnicos: «Failed to fetch», `detail` de FastAPI («[object Object]» en un 422), «Invalid payload», «register-failed», errores del backoffice («Refusing to remove the last admin»). El login además nunca distingue 401/429/red, y **el `?error=` del login con Google se ignora**. | Nunca mostrar texto del servidor; mapear por código HTTP a mensajes propios con un próximo paso. |

## Prioridad 1 — no se entiende o dice «diagnóstico»

**«Diagnóstico» donde el producto dice que no lo es.** Hay que decidir el
reemplazo una vez y aplicarlo en todo el sitio (propuesta: «búsqueda» para la
acción, «orientación» o «resultado orientativo» para lo que se obtiene):

- Título del paso 3 «Orientación diagnóstica» (`nuevo/page.tsx:85`) → «Resultados orientativos».
- «Nuevo Diagnóstico +», «Regenerar diagnóstico», «Todavía no tenés diagnósticos guardados», «Diagnóstico asistido para médicos y familias», «Entregamos devoluciones accionables: diagnósticos sugeridos…» (`diagnosticar/page.tsx`).
- «Del texto clínico al diagnóstico orientativo», «Transformando el diagnóstico con IA» (`home/page.tsx:148, 543`).
- Modal de cancelar: «…salir de este diagnóstico asistido» (`nuevo/page.tsx:2164-2166`).
- Metadata del sitio: «Plataforma de orientación diagnóstica para EPoFs» (`app/layout.tsx:35-36`).
- La ruta `/diagnosticar` → `/mis-busquedas` con redirección *(decisión de marca)*.

**Jerga y nombres internos.**

- «GenPhenAI», «GenPhenIA», «GenPhenia» aparecen en la UI (carga, errores, landing, «Resumen»): usar «el modelo de diagnostic.ar» o nada.
- Códigos HPO y etiquetas en inglés visibles para familias (sugerencias del buscador, chips, detalle de la persona): solo en la vista profesional.
- La metodología de la landing (pipeline, ontologías, NLLB-200, entropía, verosimilitud): tres pasos llanos y el detalle técnico plegado. Además describe el extractor viejo.
- Aviso legal: «métodos computacionales basada en información genómica y fenotípica» hace pensar que se usó el ADN de la familia. Propuesta: «Este resultado no es un diagnóstico. Es una orientación calculada a partir de los síntomas que cargaste y de datos científicos sobre genes. Consultá siempre con un profesional de la salud.» *(requiere OK; hay un E2E que valida el texto)*.

**Resultados.**

- El puntaje («puntaje 0.873», «puntaje bajo») solo se explica en un `title` que no se ve en celular. En la vista familia, ocultarlo (el puesto ya ordena); en la profesional, con coma decimal y ayuda visible.
- «3 de 4» en cada tarjeta: «Coincide con 3 de tus 4 síntomas».
- Las enfermedades del gen (el contenido más alarmante) aparecen sin encuadre previo en la vista familia; el aviso va después y en letra chica. Encuadrar antes y plegar.
- «Ver detalle médico» se lee como «más información sobre mi hijo»: llamarlo «Vista para profesionales de la salud».
- «Descargar resultados — Próximamente» es un botón muerto; hoy la única forma de llevarse algo es terminar las preguntas. Poner «Imprimir o copiar para la consulta» en la pantalla principal (reusando `buildConsultText`) con genes, especialidades, síntomas y aviso.
- Especialidades que no son especialidades: «Trastornos del desarrollo», «Enfermedades metabólicas», «Anomalías craneofaciales». Y nunca se sugiere «Genética médica», siendo que todo el resultado son genes.

**Preguntas.**

- «Afinar la lista» promete una mejora que la evaluación no sostiene (neutral en pacientes reales) y la grilla sigue mostrando la lista original. Reencuadrar como «Sumar información para la consulta».
- Tres entradas simultáneas a la misma acción, con textos distintos: dejar una.
- Tiempos contradictorios: «≈ 30 s por ronda» y «hasta un minuto y medio».
- Hecho en este cambio: cuando el LLM no está disponible, el panel ahora lo dice en las dos vistas («Preguntas en modo simple»).

**Carga de síntomas.**

- «Revisar y continuar» queda deshabilitado si se pegó texto pero no se tocó «Buscar síntomas en el texto», sin explicar por qué. Analizar al continuar, o decirlo.
- Paso 1: cinco campos obligatorios sin marcar y «Continuar» deshabilitado sin decir qué falta. Sexo, localidad y país no se usan en la búsqueda: volverlos opcionales (localidad, además, es un dato que identifica).
- El buscador de síntomas no se puede usar con teclado (las sugerencias solo responden a `onMouseDown`).
- La guía de ayuda nombra «Contanos el caso», un panel que no existe, y un «paso siguiente» que es el mismo paso.
- «Tipos más comunes primero» en el diálogo de precisar: el orden es por genes asociados, no por frecuencia en la población. «Elegí el que mejor lo describa».

**«Mis búsquedas» y acceso.**

- La pestaña por defecto es «Resumen», un texto promocional con funciones que no existen («Onboarding guiado… usuarios no técnicos»). Abrir en la lista.
- Después de ingresar se vuelve a la landing; ir a la lista de búsquedas.
- «¡Cuenta creada!» aparece aunque el email ya existiera, y no redirige.
- «Integrantes» supone una familia; para un médico son pacientes. «Mis búsquedas» / «Persona».
- Mientras cargan los datos aparece un instante «Todavía no tenés…», y si falla la carga se lee `localStorage` en silencio.

## Prioridad 2 — pulido y profesionalismo

- «Home» / «Regresar al home» → «Inicio».
- Marca: «Diagnostic.ar» / «diagnostic.ar» / «D I A G N O S T I C . A R» (texto con `tracking`); siglas «EPoFs» / «EPOF» → fijar «Diagnostic.ar» y «EPOF».
- «sólo» con tilde en varios lugares → «solo».
- Puntos suspensivos «...» y «…» mezclados; comillas rectas y «» mezcladas.
- Masculino genérico donde quien consulta suele ser madre: «No hace falta estar seguro» → «No hace falta tener certeza»; «Si no estás seguro» → «Si tenés dudas».
- «Hace 400d» → «Hace 400 días» o fecha absoluta.
- Backoffice: especialidades sin traducir en el gráfico (y probablemente vacío: la consulta lee un array y se guarda `{top_specialties}` — *no verificado*); «Consultas (30 d)» fija aunque el selector diga 7 o 90 días; «production» sin traducir; «Salir» vs «Cerrar sesión».
- Accesibilidad: modales del asistente sin `role="dialog"` ni trampa de foco (el de precisar sí la tiene); pasos 1-2-3 sin nombre; campos sin `<label>`; pestañas sin roles; `AyudaPopover` como `role="tooltip"` con contenido interactivo.
- Celular: en la landing el menú desaparece sin alternativa; en «Mis búsquedas» el detalle queda debajo de toda la lista; en el asistente se pierden ~112 px de ancho por márgenes.
- Código muerto: `components/ui/DataTable.tsx`, `components/ui/Modal.tsx`.

## Orden sugerido

1. Prioridad 0, en este orden: 0.1 (síntomas falsos), 0.2 (especialidades en inglés), 0.3–0.4 (aviso legal), 0.11 (errores crudos), 0.7 (borrador en el navegador), 0.9 (404/error).
2. Una decisión de vocabulario («búsqueda», «orientación», «persona») y un barrido de «diagnóstico» y de los nombres internos.
3. Legal: términos y privacidad reales, recuperación de contraseña, borrado.
4. Resultados: ocultar el puntaje en la vista familia, encuadrar las enfermedades, «Imprimir o copiar para la consulta».
5. El resto de prioridad 1 y el pulido.
