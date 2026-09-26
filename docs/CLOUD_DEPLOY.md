# Desplegar diagnostic.ar en la nube

Guía para levantar una copia completa del sistema en AWS (u otra nube) con
Terraform. Está escrita contra lo que corre hoy en staging (v0.9.2); todo lo
que dice "medido" se midió ahí.

Antes de empezar, leé **Datos** al final. No es un trámite.

## Qué es cada pieza

```
navegador ──▶ proxy con TLS ──┬── /                 frontend   (Next.js)
                              ├── /api              backend    (Express) ──▶ postgres
                              │                                          └─▶ genes.db (solo lectura)
                              ├── /hpo-api          extractor  (FastAPI + LLM remoto)
                              └── /genphenai        model      (FastAPI + GenPhenia en CPU)
```

| Servicio | Imagen | Qué hace | RAM medida |
|---|---|---|---|
| `frontend` | se construye con tus URLs (ver abajo) | La web | ~46 MiB |
| `backend` | `ghcr.io/matealv/diagnosticar-backend` | Cuentas, pacientes, perfiles de genes | ~26 MiB |
| `db` | `postgres:15-alpine` | Datos de la app | ~31 MiB |
| extractor | `ghcr.io/matealv/diagnosticar-hpo-recognizer` | Texto libre → términos HPO, y el buscador de síntomas | ~465 MiB en reposo; imagen de 3,5 GB |
| `model` | `ghcr.io/matealv/diagnosticar-model` | Términos HPO → ranking de genes y especialidades | ~91 MiB; imagen de 456 MB |

**Nada necesita GPU.** El modelo corre su export ONNX en CPU (15-30 ms por
ranking); el extractor llama a un LLM remoto. Todo junto ronda 0,7 GB en
reposo más los picos del extractor: **una instancia de 1 GB no alcanza**;
apuntá a 2 GB o más. Verificá en la consola qué tipos entran en tu plan
gratuito.

## Repositorios

Todos privados, en la cuenta `MateAlv`:

| Repo | Para qué lo necesitás |
|---|---|
| `diagnostic.ar` | Frontend, backend, composes de referencia, esta guía |
| `diagnostic.ar-api` | El extractor (`services/api-gateway`) y `model` (`services/genphenai`) |
| `diagnostic.ar-model` | El release `model-v3.0.0` que `model` trae adentro |
| `diagnostic.ar-gene-profiles` | El release `db-v1.0.0`: la base `genes.db` |
| `spanish-symptoms-recognizer` | El código del extractor, que se construye junto con la API |

Si usás las imágenes ya publicadas en GHCR, en la práctica solo tocás
`diagnostic.ar` y bajás `genes.db`. Los otros repos hacen falta para
construir desde fuente.

## Las dos piezas que no están en git

Son archivos grandes publicados como **releases**, cada uno con su sha256.
Si el hash no coincide, el archivo no es el correcto: no lo uses.

**La base de genes** (`genes.db`, 66 MB):

```bash
gh release download db-v1.0.0 -R MateAlv/diagnostic.ar-gene-profiles --pattern 'genes-db.tar.gz' --pattern SHA256SUMS
sha256sum -c SHA256SUMS --ignore-missing     # genes-db.tar.gz: OK
tar -xzf genes-db.tar.gz                     # → genes.db
```

El backend la monta en `/app/data/genes.db`, solo lectura
(`GENE_PROFILES_DB_PATH`). Ver `docker-compose.genes.yml`.

**El modelo** ya viene dentro de la imagen `diagnosticar-model`. Solo lo
necesitás si construís esa imagen vos: `services/genphenai/fetch_model.sh`
en `diagnostic.ar-api` lo baja y verifica el hash fijado en `model.lock`.

## Imágenes

Las del backend, el extractor y `model` sirven para cualquier entorno: leen
todo de variables en tiempo de ejecución. Bajarlas de GHCR necesita un token
de GitHub con `read:packages` (`docker login ghcr.io`).

**El frontend no.** Las URLs `NEXT_PUBLIC_*` se compilan dentro del bundle,
así que la imagen publicada apunta al dominio de producción y la de staging
al de staging. Construí la tuya con tu dominio:

```bash
docker build \
  --build-arg NEXT_PUBLIC_API_URL=https://TU-DOMINIO/api \
  --build-arg NEXT_PUBLIC_API_BASE_URL=https://TU-DOMINIO/api \
  --build-arg NEXT_PUBLIC_HPO_API_URL=https://TU-DOMINIO/hpo-api \
  --build-arg NEXT_PUBLIC_GENPHENAI_URL=https://TU-DOMINIO/genphenai \
  -t diagnosticar-frontend-cloud frontend/
```

El contexto es `frontend/`, como en el servicio `frontend` de
`docker-compose.yml`. Cambiar estas variables después, en el entorno, no hace
nada: hay que reconstruir. En tiempo de ejecución el contenedor además
necesita `BACKEND_API_URL` (la URL interna del backend, p. ej.
`http://backend:4000/api`).

## Configuración

Todo secreto se genera **nuevo** para la nube. No copies nada de staging ni
de producción.

**Backend** (ver `.env.example` y el servicio `backend` de los composes):

| Variable | Valor |
|---|---|
| `DATABASE_URL`, `POSTGRES_*` | Tu Postgres |
| `JWT_ACCESS_PRIVATE_KEY` / `JWT_ACCESS_PUBLIC_KEY` | Un par RSA nuevo (`openssl genrsa 2048`), cada uno en una línea con `\n` escapados. El backend firma RS256 con la privada; el extractor verifica con la pública |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Aleatorios, largos |
| `JWT_ACCEPT_LEGACY_HS256` | `false` |
| `FRONTEND_URL` | `https://TU-DOMINIO` |
| `GENE_PROFILES_DB_PATH` | `/app/data/genes.db` |
| `GOOGLE_*`, `SMTP_*` | Opcionales. Staging no los tiene |

No hay forma de crear el primer admin desde la web, a propósito. Se crea desde
una consola con acceso a la base: `ops/seed-admin.sh vos@ejemplo.org --create`.
El script asume docker compose (`COMPOSE_PROJECT`); si no lo usás, leelo y
hacé lo mismo contra tu Postgres.

**Extractor.** En staging usa una suscripción personal; en la nube usa una
**API key de Anthropic de la organización** (pedísela a Mate; no uses una
personal):

| Variable | Valor |
|---|---|
| `USE_RECOGNIZER` | `true` |
| `RECOGNIZER_PROVIDER` | `anthropic` |
| `RECOGNIZER_MODEL` | El mismo modelo que staging (`claude-opus-5`); confirmá el ID exacto en la consola de Anthropic |
| `ANTHROPIC_API_KEY` | La key de la organización |
| `REQUIRE_AUTH` | `true` — cada extracción cuesta plata; sin sesión, 401 |
| `JWT_PUBLIC_KEY` | La misma pública del backend |
| `TRUSTED_PROXIES` | La IP de **tu** proxy/balanceador, exacta. Sin esto el límite por IP ve a todos como uno solo |
| `ENABLE_SYMPTOM_EXTRACTION` | `false` (apaga el extractor viejo, que necesita GPU) |
| `STORE_REQUESTS`, `CACHE_ENABLED` | `false` — no guardar texto clínico |
| `RATE_LIMIT_PER_MINUTE`, `MAX_CONCURRENT_EXTRACTIONS` | `10` y `2`, como staging |

Chequeo antes de mandarle tráfico: `GET /healthz` tiene que decir
`extract_hpo.ready: true`; si no, `error` explica por qué.

**Model.** Nada secreto. `CORS_ORIGINS=https://TU-DOMINIO`. `GET /healthz`
tiene que decir `mode: in-process`, `checkpoint_sha256` empezando en
`ee10aa42` y `specialties_available: true`.

**Proxy.** Quitá el prefijo antes de pasar a cada servicio (`/hpo-api` y
`/genphenai` se quitan; así lo hace Traefik en staging, ver
`docker-compose.staging.yml`). TLS obligatorio.

## Terraform

- **El state guarda los secretos en texto plano.** Nunca lo commitees;
  usá un backend remoto cifrado (S3 con cifrado y bloqueo) o pasá los
  secretos por un gestor (SSM Parameter Store / Secrets Manager) y que la
  instancia los lea al arrancar.
- Nada de secretos en `*.tfvars` versionados.
- Abrí solo 443 (y 80 para redirigir). Postgres y los servicios internos no
  se exponen.

## Cómo saber que anda

1. `GET https://TU-DOMINIO/genphenai/healthz` → `in-process`, `ee10aa42…`.
2. Ranking de referencia: `POST /genphenai/rank-genes` con
   `{"hpo_ids":["HP:0000957","HP:0001067","HP:0009737","HP:0000316"],"top_k":3}`
   → `NF1`, `SPRED1`, `NF2`.
3. Registrate en la web, cargá una historia con una negación ("no presenta
   convulsiones") y confirmá que no aparece como síntoma presente.
4. `ops/smoke.sh https://TU-DOMINIO https://TU-DOMINIO`: revisa headers de
   seguridad, que la base responda y que ningún endpoint de pacientes quede
   abierto.

## Datos

- **Solo datos sintéticos.** La base de producción tiene historias clínicas
  de chicos reales. Nunca se copia a otro entorno, ni un dump, ni "unas filas
  para probar".
- Si algún día este entorno recibe datos reales, eso es información de salud
  bajo la Ley 25.326, y alojarla en la nube —posiblemente fuera del país— es
  una decisión del equipo, no de quien despliega.
- La salida nunca se presenta como diagnóstico. El aviso de la pantalla de
  resultados es un requisito, y un test E2E lo verifica.

## Lo que no tenés que tocar

nodo0 y brainy son servidores compartidos con otros equipos, y producción
corre ahí. Esta copia no depende de ninguno de los dos; no necesitás acceso a
ninguno.
