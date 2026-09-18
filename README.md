# Diagnostic.ar

## Resumen:
El proyecto Diagnostic.ar tiene como objetivo revolucionar el diagnóstico de enfermedades poco frecuentes en Argentina, a través de una plataforma digital y gratuita que permite a los pacientes registrar sus síntomas de manera sencilla y segura. La plataforma utiliza un algoritmo interno para generar recomendaciones personalizadas, sugiriendo nuevos síntomas a observar y posibles estudios complementarios, con el fin de lograr un diagnóstico más rápido y preciso.
El proyecto está dirigido por el Grupo de Genómica Clínica de la Facultad de Ciencias exactas y Naturales de la Universidad de Buenos Aires, y se destaca por su enfoque colaborativo y su compromiso con la seguridad y la privacidad de los datos.
La plataforma es de acceso libre, permitiendo la participación de cualquier persona interesada.
Con un enfoque en la innovación, la accesibilidad y la excelencia científica, Diagnostic.ar busca mejorar la calidad de vida de los pacientes con enfermedades poco frecuentes y contribuir al avance de la medicina personalizada en Argentina.

## Descripción general de la arquitectura de software propuesta

Diagnostic.ar se propone como una plataforma web modular, compuesta por una interfaz de usuario, una API de aplicación, una base de datos transaccional y servicios especializados para procesamiento clínico-computacional. La separación por componentes permite evolucionar la experiencia web, la gestión de usuarios y pacientes, y los modelos de análisis de síntomas de forma independiente.

La interfaz web está desarrollada con Next.js, React y TypeScript. Desde esta capa las personas usuarias pueden registrarse, iniciar sesión, cargar síntomas o historia clínica en lenguaje cotidiano, revisar los términos HPO sugeridos, consultar orientaciones computacionales y gestionar distintas personas o sesiones. El frontend se comunica con la API principal para las funciones de autenticación y persistencia, y con servicios especializados para la extracción de HPO y el ranking diagnóstico.

La API principal está desarrollada en Node.js con Express y TypeScript. Esta capa concentra la autenticación, la gestión de usuarios, pacientes y diagnósticos, y la escritura de datos persistentes. El sistema contempla autenticación local con usuario y contraseña, integración opcional con Google OAuth, uso de tokens JWT en cookies, protecciones CSRF/CORS, límites de tasa para endpoints sensibles y envío de correos mediante SMTP cuando corresponda.

La base de datos principal es PostgreSQL. En el estado actual del sistema se almacenan usuarios, pacientes y diagnósticos, incluyendo historia clínica cargada, síntomas extraídos, términos HPO, genes priorizados por GenPhenIA y metadatos básicos de auditoría técnica. En la infraestructura de procesamiento existe además una base PostgreSQL separada para auditoría de extracciones, configurable según la política de retención y privacidad que se defina.

El procesamiento clínico-computacional se organiza en servicios separados, desarrollados principalmente en Python con FastAPI. Estos servicios reciben texto clínico en español, extraen o normalizan síntomas, los mapean a términos HPO y exponen endpoints para consultar el ranking de genes y especialidades sugeridas a partir de GenPhenIA/GenPhenAI. La arquitectura contempla caché con Redis para mejorar tiempos de respuesta y reducir reprocesamientos.

Para el despliegue se utiliza Docker Compose. En producción, según la infraestructura documentada, el sitio web, la API principal y PostgreSQL corren en el nodo público/operativo, mientras que los servicios de procesamiento intensivo y modelos corren en un nodo de cómputo separado. La publicación externa se realiza mediante Traefik con HTTPS, y la comunicación entre nodos se resuelve mediante túneles SSH reversos para exponer de forma controlada los servicios internos de HPO y GenPhenIA hacia la aplicación web.

Stack identificado en la infraestructura actual:

- Frontend: Next.js, React, TypeScript, Tailwind CSS.
- Backend de aplicación: Node.js, Express, TypeScript.
- Servicios de procesamiento: Python, FastAPI, spaCy/rapidfuzz/transformers, integración con Ollama/LLM y GenPhenIA.
- Bases de datos: PostgreSQL para datos de aplicación; PostgreSQL adicional para auditoría de extracciones cuando está habilitada.
- Cache: Redis en los servicios de procesamiento HPO.
- Infraestructura: Docker/Docker Compose, Traefik, TLS, túneles SSH reversos entre nodos.
- Seguridad de aplicación: JWT, cookies httpOnly, CSRF, CORS restringido, Helmet, rate limiting, variables de entorno para secretos.

Detalles a completar o confirmar antes de presentar el informe final:

- COMPLETAR: dominio público definitivo y nombre del ambiente productivo.
- COMPLETAR: nombres definitivos de los nodos/servidores que se quieren mencionar en el informe, o reemplazarlos por una descripción genérica.
- COMPLETAR: política de respaldo, retención y eliminación de datos clínicos y auditorías.
- COMPLETAR: política de acceso administrativo a bases de datos y registros.
- COMPLETAR: modelo/versión de LLM y versión de GenPhenIA que quedarán fijados para producción.
- COMPLETAR: alcance exacto de validación clínica del ranking diagnóstico y disclaimers aprobados por el equipo.

## Desarrollo local

```bash
cd frontend && npm install
npm run dev:mock     # frontend en :3000 con la API simulada en :4500
```

No requiere backend, base de datos ni GPU. Ingresá con cualquier email y una
contraseña de 8+ caracteres.

### Documentación

| Archivo | Contenido |
|---|---|
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup en una máquina nueva (requiere Node 22) |
| [TESTING.md](TESTING.md) | Estrategia de pruebas, modo mock, deuda de accesibilidad |
| [CI_CD.md](CI_CD.md) | Pipeline, releases, despliegue en nodo0 y staging |
| [STAGING.md](STAGING.md) | Acceso a staging, cómo se despliega y qué cosas muerden |
| [ops/NODO0_SAFETY.md](ops/NODO0_SAFETY.md) | Cómo trabajar en nodo0 sin romper los otros 13 proyectos |
| [HANDOFF.md](HANDOFF.md) | Estado actual y próximos pasos |
| [CLAUDE.md](CLAUDE.md) | Contexto para agentes de IA |

# Esquema web:
## Landing page (Home)
Diagnostic.ar: Una nueva forma de acompañar el camino hacia el diagnóstico.
Subtítulo: diagnostic.ar ayuda a las familias a registrar síntomas y obtener orientación personalizada, basada en ciencia y con privacidad total.


En Argentina, muchas familias atraviesan años de incertidumbre hasta obtener un diagnóstico preciso. Diagnostic.ar nace para ayudar a acortar ese camino.
Nuestra plataforma digital, gratuita y abierta a toda la comunidad, permite registrar síntomas de manera sencilla y segura. A partir de esta información, el sistema genera recomendaciones personalizadas, sugiriendo qué otros síntomas podría ser útil observar y qué estudios complementarios podrían acercar al diagnóstico correcto.
Con un enfoque en la innovación, la accesibilidad y la excelencia científica, Diagnostic.ar busca transformar el paradigma del diagnóstico de enfermedades poco frecuentes, apoyándose en la colaboración con las familias y en un compromiso absoluto con la seguridad y privacidad de los datos.

El proyecto es desarrollado por el Grupo de Genómica Clínica de la Facultad de Ciencias Exactas y Naturales de la Universidad de Buenos Aires

## Items de la LP
Menú: Nuestra metodología, Quiénes somos, Ayuda, Las EPoFs

Botón principal (CTA hero): Comenzar ahora

Botones secundarios: Crear cuenta, Iniciar sesión

=> Logos FCEN-UBA , QB, IQUIBCEN, Bitgenia?, LUCAI

## Comenzar ahora => lleva a pagina del agente previa (pap)
## Iniciar sesión => lleva a pagina del agente completa (pac)

## Crear cuenta => lleva a sistema de registro (con google y pwd)
    Aclarar que NO pedimos datos personales identificatorios, que el nombre de usuario puede ser de fantasia, y que la opcion de re-contacto es opcional. No compartimos datos, No mandamos spam.

## Nuestra metodología (o mejor Como funciona),
Pedir letra a Gian

## Las EPoFs
Despues te paso letra aparte

## Quiénes somos,
El grupo de genomica Clínica.... (pedir letra a jony, simil landing page del grupo con link al mismo, mencionar los 10 años de la EGC, etc.)

## Ayuda
Aca la idea es un tutorial de como usarlo

# pagina del agente previa (pap)
“Modo demostración” o “Probar sin registrarse”

Esta pagina tiene un funcionamiento limitado del Agente, o sea permite cargar sintomas, y en base a los mismos genera una recomendacion, pero NO permite ni grabar la sesion, ni tener sintomas de diferentes "personas", etc.
La idea es que sirva como "prueba", haga una devolucion y te "sugiera" => registrarte

Texto sugerido: " En este modo podés cargar síntomas y recibir una orientación inicial.
No guarda tu información ni permite manejar varias personas.
Si querés avanzar más, podés crear una cuenta gratuita."


# pagina del agente completa (pac)
Esta pagina es el corazon de lo que queremos y esta basada en GenPhenIA
Tiene las siguientes funcionalidades

CTA: Crear cuenta para continuar con esta persona.

i) Propmt para cargar la HC / Sintomas => estos son traducidos al LLM a terminos HPO
con esta traduccion ocurren varias cosas
    1) te devuelve la listoma de terminos HPO asignados y te permite editarlos (es importante que tenemos que mostrar tanto los asignados como SI como aunos clave diferenciales asignados como que NO estan)
    2) sugiere nuevos sintomas / prubeas de laboratorio a observar
    3) te dice si con la informacion es suficiente para una orientacion por area de diagnostico o no

ii) el sistema debe permitir "grabar personas" y poder trabajar con cada una
en cada una siempre queda grabado lo que se trabajo en promots anteriores (lista de terminos HPO asignados / descartados)
y con esto se actualizan 2)  nuevas sugerencias 3) orientacion diagnostica

## orientacion dianostica (hay que desarollar el algoritmo => gian)
La idea es que de acuerdo a los genes que GenPhenIA priorza lleguemos a un (sub)grupo de especualidad diagnostica
para esto vamos a en principio usar los paneles/clasificacion de bitgenia (que son listas curadas mandualmente), pero podemos mas adelante buscar opciones
Doy un ejemplo: Para "Desordenes Metabolico" hay 3-4 grupos:

1) Enfermedades Lisosomales:

Inlcuye cuadros clínicos metabólicos tales como: Trastornos del Espectro Zellweger, Adrenoleucodistrofia ligada al X, Enfermedad de Refsum, Síndrome de hiperornitinemia-hiperaramonemia-homocitrulinemia, Síndrome de Smith-Magenis, Sulfocisteinuria, Síndrome de Heimler, Mucopolisacaridosis (Síndrome de Sanfilippo), entre otras.

GENES
ABCD1, ACOX1, PEX7, PHYH, AGPS, GNPAT, ACOX1, AMACR, HSD17B4, PEX1, PEX10, PEX12, PEX13, PEX14, PEX16, PEX19, PEX2, PEX26, PEX3, PEX5, PEX6, HSD17B4, ABCC8, ACY1, ADAMTSL2, ADSL, AGA, ALDH5A1, ALDH7A1, AMT, ANTXR2, ARG1, ARSA, ARSB, ASAH1, ASPA, ATP13A2, BTD, CLN3, CLN5, CLN6, CLN8, COL2A1, COL11A2, CTNS, CTSA, CTSC, CTSD, CTSK, DHCR7, DPYD, DYM, ETFA, ETFB, ETFDH, FH, FOLR1, FUCA1, GAA, GALC, GALNS, GAMT, GBA, GCDH, GLA, GLB1, GNE, GNPTAB, GNPTG, GNS, GPC3, GUSB, HEXA, HEXB, HGSNAT, HPD, HRAS, HYAL1, IDS, IDUA, L2HGDH, LAMA2, LDB3, LIPA, MAN1B1, MANBA, MCOLN1, MFSD8, MOCS1, MOCS2, MYOT, NAGLU, NEU1, NPC1, NPC2, PGK1, PHYH, PPT1, PRODH, PSAP, QDPR, RAI1, SGSH, SLC17A5, SLC25A15, SLC46A1, SMPD1, SUMF1, SUOX, TCF4, TPP1.

2)  Enfermedades de Oxidacion de Acidos Grasos
Contempla la deficiencia múltiple de acil-CoA deshidrogenasa (MAD), Deficiencia de acil-CoA deshidrogenasa de cadena media (MCAD) y acilcarnitinas C6, C8 y C10 elevadas, Defectos en la cetogénesis y Trastornos en la vía de oxidación de ácidos grasos.

GENES
ACADM, ACADS, ACADSB, ACADVL, ACAT1, CPT1A, CPT2, ETFA, ETFB, ETFDH, DECR1, HADH, HADHA, HADHB, HMGCL, HMGCS2, MLYCD, NADK2, OXCT1, SLC22A5, SLC25A20, SLC52A1, SLC52A2, SLC52A3.


Funciones principales de PAC (resumido):
1) Carga de síntomas / historia clínica en lenguaje cotidiano
Campo de texto principal.
El sistema convierte a HPO.

2) Vista de HPO asignados
Debe mostrar:
HPO asignados como presentes (Sí)
HPO relevantes marcados como ausentes (No)
Capacidad de editar (agregar, eliminar, cambiar estado) Esto es clave para transparencia.

3) Sugerencias del agente
Nuevos síntomas que sería útil observar
Posibles estudios complementarios
Señales de alerta para consulta profesional

4) Orientación diagnóstica

##  Entonces hay que hacer:
1) pasar todo esto a un codio que evalue cuando GenPhenIA tiene un listado que se ajusta bien a uno de estos grupos => puede hacer la recomendacion
2) evaluar que cobertura de los 8k genes de OMIM tenemos en los paneles (para ver que nos estamos perdiendo)
3) ver si podems mejorar esta clasificacion

5) Manejo de múltiples personas
“Agregar persona”
“Ver personas registradas”
“Información guardada para cada persona”
“Historial de sugerencias y sesiones previas”

6) PDF para profesionales
El contenido que describís está excelente.

Una vez que GenPhenIA se siente con confianza con el panel => manda la "orientacion diagnostica" para el paciente (en la pagina)

Aca el LLM deberia
Explicar algo asi como: "de acuerdo a los sintomas de la personsa, se sugiere una orientacion diagnostica de "Enfermedades Lisosomales". Estas comprenden Desaordenes Metabolicos, que son evluadas principalemnte por un "Endocrinologo"

=> ademas aparece un boton CAT que dice algo como "Bajar PDF con informacion para el Profesional / Medico"

Disclaimer breve: “Este documento no constituye un diagnóstico médico. Es una orientación generada por métodos computacionales.”

## PDF con informacion para el Profesional / Medico
Aca va un pdf que dice algo asi como
El paciente ha declarado presenta los siguientes sintomas (Terminos HPO),
De acuerdo a ls mismos se sugiere un diagnostico orientativo de: ... (simil lo anterior)
Los principales genes asociados que se sugiere evaluar son (lista de genes)

para mas ifnormacion contactese con info@diagnosticar.qb.fen.uba.ar (o algun mail que pongamos paraa esto)

“Según los síntomas registrados, el sistema sugiere una orientación diagnóstica compatible con Enfermedades Lisosomales, un subgrupo dentro de los desórdenes metabólicos.
Estos cuadros suelen ser evaluados por especialistas como médicos endocrinólogos o genetistas clínicos.”

Disclaimer breve: “Este documento no constituye un diagnóstico médico. Es una orientación generada por métodos computacionales.”

### Notas
