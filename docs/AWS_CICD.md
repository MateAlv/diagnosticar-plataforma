# CI/CD hacia la copia en AWS

Cómo se despliega automáticamente la copia de diagnostic.ar en AWS
(`infra/aws/`, guía en [`CLOUD_DEPLOY.md`](CLOUD_DEPLOY.md)): **cada vez que
algo entra a `main` en uno de los repositorios, GitHub Actions construye lo que
cambió, lo prueba, lo sube a AWS y actualiza el servicio.** Si la copia queda
rota después, vuelve sola a la versión anterior.

Escrito el 2026-10-01. No toca producción ni staging en nodo0: esos siguen con
su propio pipeline ([`../CI_CD.md`](../CI_CD.md)).

## Qué dispara qué

| Cambio en `main` de… | Workflow | Construye | Verifica | Actualiza en AWS |
|---|---|---|---|---|
| `diagnostic.ar` (solo `backend/`, `frontend/`) | `.github/workflows/deploy-aws.yml` | backend + frontend (compilado con el dominio de AWS) | `ops/smoke.sh` contra la URL pública | la web y la API |
| `diagnostic.ar-api` | `.github/workflows/deploy-aws.yml` | modelo + extractor (con el último `main` del reconocedor) | tests dentro de cada imagen; healthz y un ranking de referencia | modelo y extractor |
| `spanish-symptoms-recognizer` | `.github/workflows/deploy-aws.yml` | extractor (con el último `main` de la API) | tests dentro de la imagen; healthz | extractor |
| `diagnostic.ar-model` | — | — | — | Nada directo: el modelo que se usa está fijado en `services/genphenai/model.lock` de la API; cambiar esa línea despliega por el workflow de la API |
| `diagnostic.ar-gene-profiles` | — | — | — | Nada: `genes.db` no está en git. Se sube a mano al bucket (ver `infra/aws/README.md`) |

Como el trabajo se hace en ramas y entra a `main` por pull request, **un
despliegue ocurre cuando se mergea un PR**. Los PR ya pasaron por el CI de cada
repositorio antes.

## Cómo funciona un despliegue

```
merge a main ──▶ GitHub Actions
                  ├─ 1. entra a AWS con OIDC (credenciales temporales, sin claves guardadas)
                  ├─ 2. construye las imágenes del repo y corre sus tests dentro de ellas
                  ├─ 3. las sube a ECR con un tag propio (app-<sha>, api-<sha>, api-<sha>-rec-<sha>)
                  ├─ 4. mueve el tag de esas imágenes en SSM (BACKEND_TAG, MODEL_TAG, …)
                  ├─ 5. pide a la instancia `diagnosticar deploy` (documento SSM fijo)
                  │       └─ la instancia baja solo lo que cambió y reinicia solo esos contenedores
                  ├─ 6. verifica contra la URL pública
                  └─ 7. si 5 o 6 fallan: vuelve los tags anteriores y redespliega
```

- **Cada imagen tiene su propio tag** (`BACKEND_TAG`, `FRONTEND_TAG`,
  `RECOGNIZER_TAG`, `MODEL_TAG` en `/diagnosticar/config/`). Así un repositorio
  actualiza sus servicios sin tocar los de los otros. Si un tag no existe, el
  servicio usa `IMAGE_TAG`, el conjunto que arma a mano
  `infra/aws/scripts/push-images.sh`.
- **Dos despliegues a la vez** (dos repos mergeando juntos) se turnan: la
  instancia los ejecuta de a uno (`flock`).
- **La lógica compartida** está en `.github/scripts/aws-deploy.sh`, idéntico en
  los tres repositorios.

## Seguridad

- **Sin claves de AWS en GitHub.** GitHub se identifica con OIDC y AWS le da
  credenciales temporales (una hora como máximo) para el rol
  `diagnosticar-github-deploy-<sufijo aleatorio>`. Solo pueden asumirlo los workflows que corren
  en **`main`** de los tres repositorios; una rama, un fork o un PR no.
- **El rol puede lo mínimo** (`infra/aws/main/github.tf`):
  - subir imágenes a los 4 repositorios de ECR;
  - leer la configuración no secreta y mover los 4 tags de imagen;
  - ejecutar en la instancia **un solo comando fijo**, `diagnosticar deploy`,
    a través del documento SSM `diagnosticar-deploy`.
- **No puede leer los secretos** (`/diagnosticar/secrets/*`) ni correr comandos
  arbitrarios en la instancia. Por eso no usa `AWS-RunShellScript`, que sería
  root en la máquina y, con eso, acceso a todos los secretos.
- **Los logs de GitHub no muestran secretos**: el deploy en la instancia solo
  imprime los nombres de las variables.
- `DEPLOY_READ_TOKEN` (en `diagnostic.ar-api` y `spanish-symptoms-recognizer`)
  solo lee código y releases de los otros repositorios privados; no tiene
  ningún acceso a AWS.

## Puesta en marcha (una vez)

Los workflows están **apagados** mientras no exista el secreto
`AWS_DEPLOY_ROLE_ARN`: se pueden mergear sin que pase nada (un primer job,
`configured`, lo comprueba y saltea el deploy).

1. **AWS** (quien maneja la copia, con el perfil `diagnosticar`):
   ```bash
   cd infra/aws/main
   terraform apply            # crea el acceso OIDC, el rol, el documento SSM y /diagnosticar-ci/*
   terraform output -raw github_deploy_role_arn
   ```
   El nombre del rol lleva un sufijo aleatorio que pone AWS, así que el ARN no
   se puede adivinar, y Terraform lo marca como sensible: ningún `plan` ni
   `apply` lo imprime, solo este comando, a propósito. Copialo directo a
   GitHub o pasalo por un canal privado; no lo pegues en chats, issues ni
   documentos. Si alguna vez se expone, se rota recreando el rol
   (`terraform apply -replace=aws_iam_role.github_deploy`) y actualizando el
   secreto en los tres repositorios.
2. **GitHub** (lo hace el dueño de los repositorios: en repos de una cuenta
   personal, solo él puede crear secretos). En *Settings → Secrets and
   variables → Actions → Secrets*:

   | Repositorio | Secreto `AWS_DEPLOY_ROLE_ARN` | Secreto `DEPLOY_READ_TOKEN` |
   |---|---|---|
   | `diagnostic.ar` | el ARN del paso 1 | — |
   | `diagnostic.ar-api` | el mismo | sí |
   | `spanish-symptoms-recognizer` | el mismo | sí |

   El ARN no es una credencial (sin la firma de GitHub desde `main` de estos
   repos nadie puede usarlo), pero se guarda como secreto para que no se lea
   en la configuración y quede tapado en los logs. Los workflows además tapan
   el número de cuenta de AWS en todo el log (`::add-mask::`), incluidos los
   nombres de las imágenes de ECR. **No vence**; solo cambia si se destruye y
   se recrea la infraestructura.

   `DEPLOY_READ_TOKEN`: un *fine-grained personal access token* de la cuenta
   dueña, limitado a `diagnostic.ar-api`, `diagnostic.ar-model` y
   `spanish-symptoms-recognizer`, con permiso **Contents: Read-only** y nada
   más. **Vence** en la fecha que elija quien lo crea (GitHub avisa por mail);
   vencido, los workflows de la API y del reconocedor fallan al arrancar y AWS
   sigue con la última versión hasta que se reemplace. Opcional: la variable
   `AWS_REGION` si no es `us-east-1`.
3. **Mergear** los PR de la rama `feat/aws-deploy` de cada repositorio.
4. **Probar**: en la pestaña *Actions* de cualquiera de los tres, *Deploy to
   AWS* → *Run workflow* sobre `main`.

## Cómo comprobar que anda

- En *Actions*, el run termina en verde y el paso *Smoke test* / *Health checks*
  muestra cada servicio `healthy` y el ranking `['NF1', 'SPRED1', 'NF2']`.
- `infra/aws/scripts/remote.sh status` muestra los contenedores con los tags
  nuevos (`app-…`, `api-…`).
- Para ver el rollback: un deploy que deja un servicio caído termina en rojo,
  el paso *Roll back* vuelve los tags anteriores y la copia sigue funcionando.

## Lo que sigue siendo manual

| Qué | Por qué | Cómo |
|---|---|---|
| Cambios de infraestructura | Raros, y conviene revisar el plan antes | `terraform plan` / `apply` en `infra/aws/main` |
| Cambios en `infra/aws/stack/` (compose, Caddyfile) | Viajan por S3, no por imágenes | `terraform apply` + `scripts/remote.sh deploy` |
| Secretos y la API key de Anthropic | Nunca pasan por GitHub | `infra/aws/scripts/make-secrets.sh` |
| `genes.db` | No está en git | subir al bucket + `remote.sh deploy` |

## Decisiones y lo que cuestan

- **Siempre lo último de cada `main`.** El release de nodo0 fija qué commits
  de la API y del reconocedor van juntos (`.github/recognizer.env`); acá no:
  AWS corre lo último de cada repositorio, aunque esa combinación no se haya
  probado junta antes. Aceptable para una copia de prueba; los tests dentro de
  la imagen y los healthz son la red.
- **Sin escaneo Trivy en el camino.** El release de nodo0 escanea cada imagen;
  acá se apoya en el escaneo de ECR al subir (`scan_on_push`) para no gastar
  minutos. Los hallazgos se ven en la consola de ECR.
- **Minutos de GitHub Actions.** Se descuentan de la cuenta dueña de los
  repositorios. Aproximado por despliegue: `diagnostic.ar` 5–8 min; la API y el
  reconocedor 15–30 min (el extractor es pesado; la caché de GitHub lo acorta).
  En septiembre de 2026 la cuenta agotó su cuota (ver `CI_CD.md`).
- **Costo en AWS**: subir imágenes a ECR no cobra transferencia; se paga el
  almacenamiento (se guardan las últimas 3 versiones de cada imagen).
- Los tags que crean los workflows no los maneja Terraform: después de un
  `terraform destroy` quedan en SSM y se borran a mano si hace falta.

## Archivos

| Repositorio | Archivo | Qué es |
|---|---|---|
| `diagnostic.ar` | `.github/workflows/deploy-aws.yml` | Workflow de backend y frontend |
| `diagnostic.ar` | `infra/aws/main/github.tf` | OIDC, rol, documento SSM, `/diagnosticar-ci/*` |
| `diagnostic.ar` | `infra/aws/stack/docker-compose.cloud.yml` | Un tag por imagen, con `IMAGE_TAG` de respaldo |
| `diagnostic.ar` | `infra/aws/stack/diagnosticar.sh` | El deploy en la instancia (con turno, `flock`) |
| `diagnostic.ar-api` | `.github/workflows/deploy-aws.yml` | Workflow del modelo y del extractor |
| `spanish-symptoms-recognizer` | `.github/workflows/deploy-aws.yml` | Workflow del extractor |
| los tres | `.github/scripts/aws-deploy.sh` | Mover tags, desplegar, verificar, volver atrás |
