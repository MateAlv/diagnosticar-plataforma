# CI/CD hacia la copia en la nube

Cómo llega una versión nueva a la copia de diagnostic.ar en la nube
([`infra/cloud/`](../infra/cloud/README.md)), en cualquier proveedor: **cuando
alguien corre a mano el workflow `publish-cloud.yml` de uno de los repositorios,
GitHub Actions construye, prueba y publica en GHCR; la máquina lo baja sola, lo
verifica y, si falla, vuelve sola a la versión anterior.**

Hasta el 2026-10-15 corría solo con cada merge a `main`. Desde entonces es a
mano (pestaña Actions, o `gh workflow run publish-cloud.yml -R <repo>`): los
minutos de Actions son una cuota mensual que comparten todos los repositorios
de la cuenta.

Reemplaza desde el 2026-10-04 al despliegue anterior, que funcionaba solo en
AWS (por qué: [`CLOUD_CAMBIOS.md`](CLOUD_CAMBIOS.md)). No toca producción ni
staging en nodo0: esos siguen con su propio pipeline ([`../CI_CD.md`](../CI_CD.md)).

## Qué dispara qué

| A mano en… | Workflow | Construye y prueba | Publica en GHCR (`ghcr.io/matealv/…`) |
|---|---|---|---|
| `diagnostic.ar` (solo `backend/`, `frontend/`) | `.github/workflows/publish-cloud.yml` | backend + frontend (con URLs relativas); el frontend tiene que renderizar | `diagnosticar-cloud-backend`, `diagnosticar-cloud-frontend` |
| `diagnostic.ar-api` | `.github/workflows/publish-cloud.yml` | modelo + extractor (con el último `main` del reconocedor); tests dentro de cada imagen | `diagnosticar-cloud-model`, `diagnosticar-cloud-hpo-recognizer` |
| `spanish-symptoms-recognizer` | `.github/workflows/publish-cloud.yml` | extractor (con el último `main` de la API); tests dentro de la imagen | `diagnosticar-cloud-hpo-recognizer` |
| `diagnostic.ar-model` | — | Nada directo: el modelo y los embeddings que se usan están fijados en los `.lock` de la API; cambiar esa línea publica por el workflow de la API |
| `diagnostic.ar-gene-profiles` | — | Nada: `genes.db` es un release; se fija en `infra/cloud/stack/genes.lock` y se instala con `remote.sh install-genes` |

Ninguno corre solo: **una publicación ocurre cuando alguien la dispara**, sobre
el último `main` de ese repositorio. En `diagnostic.ar`, antes correr `make ci`
en ese commit: el workflow valida `infra/cloud/` y construye, pero no corre la
suite de tests.

## Cómo funciona

```
a mano ──▶ GitHub Actions (publish-cloud.yml)
                  ├─ 1. construye las imágenes y corre sus tests dentro de ellas
                  ├─ 2. las sube a GHCR con un tag propio (app-<sha>, api-<sha>, api-<sha>-rec-<sha>)
                  └─ 3. si todo pasó, mueve el tag `cloud` (el canal) a esas imágenes

cada máquina, cada 5 minutos (timer de systemd, `diagnosticar deploy`)
                  ├─ 4. pregunta a GHCR a qué digest apunta `cloud` en cada imagen
                  ├─ 5. si cambió: baja, reinicia, chequea (healthz, ranking NF1/SPRED1/NF2, /home)
                  ├─ 6. si los chequeos fallan: vuelve a los digests anteriores y no reintenta ese conjunto
                  └─ 7. escribe el resultado en https://<dominio>/deploy-status.json
```

- **Nadie entra a la máquina para desplegar.** GitHub no tiene credenciales de
  ningún proveedor ni acceso a la máquina; publica y nada más. Por eso la misma
  publicación sirve para copias en varios proveedores a la vez.
- **Cada imagen se fija por digest**, no por tag: lo que corre es exactamente lo
  que se probó, y volver atrás es volver a los digests anteriores.
- **Dos despliegues no se pisan:** la máquina los hace de a uno (`flock`).
- **Dos publicaciones del extractor tampoco.** El extractor lo publican la API y
  el reconocedor, cada uno con su commit y el último `main` del otro, así que sin
  control el canal quedaría con el que **termina** último, que puede traer código
  más viejo. Cada imagen del extractor lleva los dos commits como etiquetas, y
  antes de mover el canal `.github/scripts/cloud-channel-guard.py` (idéntico en
  los dos repos) los compara con los de la imagen publicada, usando la API de
  GitHub:

  | La imagen nueva, frente a la del canal | Qué hace |
  |---|---|
  | No está atrás en ningún repo | Mueve el canal |
  | Está atrás en uno y no aporta nada nuevo | No lo toca: el canal ya es más nuevo |
  | Está atrás en uno y adelante en el otro | No lo toca y dispara otra ejecución, que toma lo último de los dos `main` |

  El modelo, el backend y el frontend los publica un solo repo cada uno, y cada
  repo publica de a una ejecución a la vez, así que no tienen esta carrera.
- **Ver el resultado en GitHub (opcional):** con la variable de repositorio
  `CLOUD_URLS` (URLs separadas por espacios), cada workflow suma un job `report`
  que espera hasta 15 minutos a que `/deploy-status.json` muestre la versión
  nueva, y falla si la máquina la rechazó.

## Seguridad

- **Publicar** usa el `GITHUB_TOKEN` de cada ejecución (`packages: write`): no
  hay secretos nuevos.
- **Leer los otros repositorios** (el código del reconocedor, los releases de
  modelo y embeddings) usa `DEPLOY_READ_TOKEN`, un token *fine-grained* de solo
  lectura de contenido, en `diagnostic.ar-api` y `spanish-symptoms-recognizer`.
  **Vence** el 2027-10-02; vencido, esos dos workflows fallan al arrancar y las
  máquinas siguen con la última versión.
- **Bajar las imágenes** (privadas) usa un token *classic* con solo
  `read:packages`, guardado en la máquina (`remote.sh set-secret REGISTRY_TOKEN`).
  Si vence, la máquina sigue con lo que tiene y `deploy-status.json` no cambia; se
  reemplaza con el mismo comando.
- **Permisos de los paquetes:** `diagnosticar-cloud-hpo-recognizer` lo publican
  dos repositorios; en su *Package settings → Manage Actions access*,
  `diagnostic.ar-api` es Admin (lo creó) y `spanish-symptoms-recognizer` tiene
  Write.

## Lo que sigue siendo manual

| Qué | Por qué | Cómo |
|---|---|---|
| Crear o cambiar la máquina (tamaño, firewall) | Raro, y conviene revisar el plan | `terraform plan` / `apply` en `infra/cloud/providers/<proveedor>` |
| Cambios en `infra/cloud/stack/` (compose, Caddyfile) | Viajan por SSH, no por imágenes | `remote.sh open` → `install-stack` → `close` |
| Secretos: el token de Claude, el de GHCR | Nunca pasan por GitHub | `remote.sh set-secret …` |
| `genes.db` | Es un release, no está en git | `genes.lock` → `install-stack` → `install-genes` |
| Embeddings de HPO del extractor (cuando cambia ClinLinker, la lista HPO o el script generador) | Se generan una vez por versión, no en cada build | Ver abajo |

### Los embeddings de HPO

El extractor compara lo que escribe la persona con un vector por cada uno de los
19.932 términos HPO en castellano. Vienen hechos, no se recalculan en cada build:

- se generan **una vez por versión** en `diagnostic.ar-model`
  (`hpo-embeddings/`), con el mismo entorno del extractor, y se publican como
  release `hpo-embeddings-vX.Y.Z` (los embeddings, la lista de términos y un
  manifest con el origen y el hash de cada archivo, en un solo paquete);
- **solo un merge que cambie `hpo-embeddings/embeddings.lock` los publica**, y una
  versión ya publicada no se vuelve a generar;
- todo build baja la versión fijada en `services/api-gateway/embeddings.lock` de
  la API (`fetch_embeddings.sh`), la verifica contra el hash que el release
  publica, y **se niega a construir** si el paquete se hizo con otro encoder, otra
  lista HPO u otro script generador que los de ese build.

Para cambiarlos: un PR en `diagnostic.ar-model` que cambie `embeddings.lock` y
suba `VERSION`; al mergearlo se publica el release. Después, un PR en
`diagnostic.ar-api` con el tag nuevo en `services/api-gateway/embeddings.lock`.

## Decisiones y lo que cuestan

- **Siempre lo último de cada `main`.** El release de nodo0 fija qué commits de la
  API y del reconocedor van juntos (`.github/recognizer.env`); acá no: la copia
  corre lo último de cada repositorio, aunque esa combinación no se haya probado
  junta antes. Aceptable para una copia de prueba; los tests dentro de la imagen y
  los chequeos de la máquina son la red.
- **Sin escaneo de vulnerabilidades en el camino.** El release de nodo0 escanea
  cada imagen con Trivy; acá todavía no (pendiente).
- **Hasta 5 minutos de demora** entre que se publica y la máquina lo toma.
- **Minutos de GitHub Actions**, de la cuenta dueña de los repositorios.
  Aproximado por publicación: `diagnostic.ar` 5–8 min; la API y el reconocedor
  ~10–15 min.
- **GHCR** no cobra por estas imágenes privadas dentro de la cuota de la cuenta.

## Archivos

| Repositorio | Archivo | Qué es |
|---|---|---|
| `diagnostic.ar` | `.github/workflows/publish-cloud.yml` | Backend y frontend |
| `diagnostic.ar-api` | `.github/workflows/publish-cloud.yml` | Modelo y extractor |
| `spanish-symptoms-recognizer` | `.github/workflows/publish-cloud.yml` | Extractor |
| `diagnostic.ar` | `infra/cloud/stack/diagnosticar.sh` | El deploy en la máquina: canal → digests, chequeos, vuelta atrás, `deploy-status.json` |
| `diagnostic.ar` | `infra/cloud/stack/cloud-init.yaml.tftpl` | Los timers de deploy (5 min) y backup (06:00 UTC) |
