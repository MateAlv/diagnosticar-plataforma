# diagnostic.ar en AWS — paso a paso

Una copia completa del sistema en una cuenta de AWS propia, con Terraform. Es la
implementación de [`docs/CLOUD_DEPLOY.md`](../../docs/CLOUD_DEPLOY.md): leé esa guía
primero, sobre todo la sección **Datos**. Esta copia es **solo para datos sintéticos**.

## Qué se crea

```
Internet ─▶ Elastic IP ─▶ EC2 t3.small (Amazon Linux 2023, 2 GB + 2 GB de swap, disco de 30 GB cifrado)
                           └─ docker compose
                              ├─ caddy           HTTPS (Let's Encrypt) en 80/443
                              │    /api/*        → backend ─▶ postgres, genes.db (solo lectura)
                              │    /hpo-api/*    → hpo-recognizer (extractor)
                              │    /genphenai/*  → model
                              │    resto         → frontend
                              └─ ...
```

| Pieza | Dónde | Archivo |
|---|---|---|
| State de Terraform | Bucket S3 privado, cifrado y versionado | `bootstrap/` |
| `genes.db`, el stack, los backups | Bucket S3 de artefactos | `bootstrap/`, `main/ssm.tf` |
| Imágenes | ECR privado; la instancia las baja con su rol, sin tokens de GitHub | `main/ecr.tf`, `scripts/push-images.sh` |
| Secretos | SSM Parameter Store (`/diagnosticar/secrets/*`), nunca en git ni en el state | `scripts/make-secrets.sh` |
| Configuración | SSM (`/diagnosticar/config/*`), la maneja Terraform | `main/ssm.tf` |
| Instancia, red, permisos | EC2, Security Group (solo 80 y 443), rol IAM | `main/ec2.tf`, `network.tf`, `iam.tf` |
| Alarma de gasto (opcional) | AWS Budgets, por mail | `main/budget.tf` |
| El stack | Compose + Caddyfile + `diagnosticar` (herramienta en la instancia) | `stack/` |

El dominio es `<ip-con-guiones>.sslip.io`: gratis, apunta solo a la Elastic IP, y
Let's Encrypt lo acepta. Se puede cambiar por uno propio más adelante.

No hay puerto 22: la instancia se maneja con SSM (`scripts/remote.sh`).

El agente de preguntas queda afuera (su repositorio no está accesible); el backend
apaga la función solo cuando `QUESTION_AGENT_URL` está vacío.

## Requisitos

- Un perfil de AWS CLI llamado `diagnosticar` (o `AWS_PROFILE=...` en cada comando).
- `terraform` ≥ 1.10, `docker` con BuildKit, `git`, `python3`.
- `gh` con sesión iniciada y acceso a los releases de `MateAlv/diagnostic.ar-model` y
  `MateAlv/diagnostic.ar-gene-profiles`.
- Los repos `diagnostic.ar-api` y `spanish-symptoms-recognizer` clonados al lado de este.
- ~15 GB libres para construir las imágenes.

Todos los comandos se corren desde `infra/aws/`.

## Fase 1 — Bootstrap (una vez; costo ≈ 0)

```bash
cd bootstrap
terraform init
terraform apply                                   # 2 buckets
terraform output -raw backend_config > ../main/backend.hcl
cd ..
```

El state del bootstrap queda local (`bootstrap/terraform.tfstate`, ignorado por git).
No tiene secretos; si se pierde, los buckets se pueden importar.

## Fase 2 — genes.db al bucket

```bash
BUCKET=$(terraform -chdir=bootstrap output -raw artifacts_bucket)
cd "$(mktemp -d)"
gh release download db-v1.0.0 -R MateAlv/diagnostic.ar-gene-profiles \
  --pattern 'genes-db.tar.gz' --pattern SHA256SUMS
sha256sum -c SHA256SUMS --ignore-missing          # genes-db.tar.gz: OK  (si no, NO seguir)
tar -xzf genes-db.tar.gz
aws --profile diagnosticar s3 cp genes.db "s3://$BUCKET/data/genes.db"
cd -
```

Para actualizarla más adelante: subir el archivo nuevo al mismo lugar y `scripts/remote.sh deploy`.

## Fase 3 — Secretos

```bash
scripts/make-secrets.sh
```

Genera nuevos `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` y un par RSA
para firmar las sesiones (RS256, así el extractor las verifica solo con la pública).
`CLAUDE_CODE_OAUTH_TOKEN` y `ANTHROPIC_API_KEY` quedan como `PLACEHOLDER` hasta la fase 7.
Nunca pisa uno existente: `POSTGRES_PASSWORD` queda fijado en la base cuando se crea.

## Fase 4 — Infraestructura (acá empieza el costo)

```bash
cd main
terraform init -backend-config=backend.hcl
terraform plan
terraform apply
terraform output url
cd ..
```

Al terminar, la instancia arranca, instala Docker y prepara el stack. Todavía no
corre nada: faltan las imágenes.

Todas las variables tienen valor por defecto. Para cambiar alguna (tamaño de la
instancia, presupuesto de Anthropic), copiá `main/terraform.tfvars.example` a
`main/terraform.tfvars` (ignorado por git). La alarma de gasto de Terraform es
opcional (`budget_email`): si la cuenta ya tiene una creada en la consola, no hace falta.

## Fase 5 — Imágenes

```bash
scripts/push-images.sh
```

Construye las cuatro imágenes desde el código, con los mismos commits que usaría un
release (ver el encabezado del script), corre los tests de `model` y del extractor
dentro de las imágenes, las sube a ECR y deja `IMAGE_TAG` apuntando a ellas. El
frontend se compila con el dominio de la fase 4. El extractor tarda ~30 minutos la
primera vez.

## Fase 6 — Arrancar y crear el primer admin

```bash
scripts/remote.sh deploy
scripts/remote.sh status                          # contenedores, memoria, healthz
```

El certificado HTTPS puede tardar un minuto la primera vez. Después:

1. Registrate en la web (`terraform -chdir=main output url`) con tu mail y **tu** contraseña.
2. `scripts/remote.sh seed-admin vos@ejemplo.org` → convierte esa cuenta en admin.

Así ninguna contraseña pasa por la terminal ni queda en el historial de AWS. Los
demás admins se invitan desde `/admin/equipo`.

## Fase 7 — Activar el extractor

Desde el 2026-10-02 la copia usa **la suscripción de Claude de Mate, como staging y
con sus mismos límites** (20 por cuenta por hora, 60 por día, 40 por todo el sitio
cada 5 horas). Por qué, y qué riesgos se aceptaron:
[`docs/LLM_EN_LA_COPIA_AWS.md`](../../docs/LLM_EN_LA_COPIA_AWS.md).

Lo hace Mate, que es el dueño del token, con el perfil `diagnosticar` de AWS. El
token sale de `claude setup-token`; si ya está en un archivo, se pasa por
redirección y nunca aparece en pantalla ni en el historial:

```bash
scripts/make-secrets.sh --set-claude-token < ~/ruta/al/token   # o sin "<": lo pide sin mostrarlo
scripts/remote.sh deploy
scripts/remote.sh status                          # /hpo-api/healthz → extract_hpo.ready: true
```

Hasta entonces la web funciona con el buscador de síntomas y el ranking; la
extracción desde texto libre responde que no está disponible.

**Con una API key en lugar de la suscripción:** `recognizer_provider = "anthropic"`
en `terraform.tfvars`, `terraform apply`, `scripts/make-secrets.sh --set-anthropic-key`
y `scripts/remote.sh deploy`. Ahí el techo semanal es `anthropic_weekly_budget_usd`
÷ 1,90 extracciones (US$20 por defecto → 10 por semana), porque cada extracción
cuesta ~US$0,94 (hasta ~US$1,90).

## Cómo saber que anda

```bash
URL=$(terraform -chdir=main output -raw url)
curl -s $URL/genphenai/healthz        # mode in-process, checkpoint_sha256 ee10aa42…, specialties_available true
curl -s -X POST $URL/genphenai/rank-genes -H 'Content-Type: application/json' \
  -d '{"hpo_ids":["HP:0000957","HP:0001067","HP:0009737","HP:0000316"],"top_k":3}'   # NF1, SPRED1, NF2
SMOKE_HEALTH_PATH=/api/health ../../ops/smoke.sh $URL $URL                            # SMOKE PASS
```

Y en la web: registrarse, cargar una historia con una negación ("no presenta
convulsiones") y confirmar que no aparece como síntoma presente.

## Memoria

```bash
scripts/remote.sh stats
```

Desde que el extractor usa la suscripción de Claude, cada llamada al modelo es un
proceso `claude` de ~260 MB. Por eso la copia corre una extracción a la vez, con
dos llamadas en paralelo (`MAX_CONCURRENT_EXTRACTIONS=1`, `RECOGNIZER_LLM_THREADS=2`,
techo de 1300 MB en `stack/docker-compose.cloud.yml`). En staging son 16 en paralelo
y una historia larga tarda la mitad. Con una instancia de 4 GB se pueden subir.

Con dos extracciones de historias largas a la vez: si quedan menos de ~300 MB libres o
el swap se usa todo el tiempo, pasar a `instance_type = "c7i-flex.large"` (4 GB) en
`terraform.tfvars` y `terraform apply`. La instancia se detiene y vuelve a arrancar
con el tamaño nuevo; los datos quedan.

## Despliegue automático (CI/CD)

Cada merge a `main` de `diagnostic.ar`, `diagnostic.ar-api` o
`spanish-symptoms-recognizer` construye, prueba y despliega lo que cambió, y
vuelve atrás solo si la copia queda rota. Cómo funciona, la seguridad y la
puesta en marcha: [`docs/AWS_CICD.md`](../../docs/AWS_CICD.md).

Con eso, `scripts/push-images.sh` queda para el primer despliegue o para
reconstruir todo a mano; un despliegue a mano reemplaza lo que hayan subido los
workflows (vuelve todas las imágenes a `IMAGE_TAG`).

## Operación

| Qué | Cómo |
|---|---|
| Actualizar el código | Automático al mergear a `main` ([`docs/AWS_CICD.md`](../../docs/AWS_CICD.md)). A mano: `scripts/push-images.sh` → `scripts/remote.sh deploy` |
| Cambiar el stack (compose, Caddyfile) | Editar `stack/` → `terraform -chdir=main apply` → `scripts/remote.sh deploy` |
| Ver logs | `scripts/remote.sh logs [backend|frontend|hpo-recognizer|model|caddy|db]` |
| Backups | Automáticos, todas las noches (06:00 UTC) a `s3://<artifacts>/backups/`, se guardan 14 días. A mano: `scripts/remote.sh backup` |
| Volver a la versión anterior | Poner el tag anterior en `/diagnosticar/config/<BACKEND|FRONTEND|RECOGNIZER|MODEL>_TAG` (o `IMAGE_TAG`) → `deploy`. ECR guarda las últimas 3 versiones; los workflows lo hacen solos si el deploy falla |
| Rotar sesiones | `scripts/make-secrets.sh --rotate JWT_ACCESS_KEYPAIR` → `deploy` |

**Probá restaurar un backup** al menos una vez: un backup que nunca se restauró no está
verificado.

## Costos (us-east-1)

| Qué | Por mes |
|---|---|
| EC2 `t3.small` | ~US$15 |
| Disco 30 GB gp3 | ~US$2,4 |
| IPv4 pública | ~US$3,6 |
| ECR (~5 GB), S3, SSM | < US$1 |
| **Claude** | Con la suscripción de Mate: nada aparte, pero comparte su cuota con staging y con su propio uso. Con una API key: ~US$0,94 por extracción, con el techo semanal |

En el plan gratuito de AWS todo esto sale de los créditos. La IP y el disco cobran
aunque la instancia esté apagada.

## Apagar todo

```bash
terraform -chdir=main destroy        # instancia, disco (¡con la base!), IP, ECR, alarma
```

Los buckets (`bootstrap/`) y los secretos en SSM quedan; borrarlos es aparte
(`terraform -chdir=bootstrap destroy` exige vaciarlos antes).

## Reglas

- Solo datos sintéticos. Nunca un dump de producción ni "unas filas para probar".
- Secretos nuevos, generados acá; nunca copiados de staging ni producción.
- No depende de nodo0 ni de brainy.
- La salida nunca se presenta como diagnóstico.
