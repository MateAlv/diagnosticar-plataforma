# diagnostic.ar en la nube, en cualquier proveedor

Una copia completa del sistema en una máquina virtual de cualquier proveedor que
ofrezca Ubuntu 24.04 y cloud-init: AWS, Google Cloud, Azure, DigitalOcean,
Hetzner, Oracle, Linode, Vultr o una VM local. Es la implementación de
[`docs/CLOUD_DEPLOY.md`](../../docs/CLOUD_DEPLOY.md); leé esa guía primero, sobre
todo la sección **Datos**. Esta copia es **solo para datos sintéticos**.

## La idea: un núcleo común y un adaptador chico por proveedor

Terraform funciona con casi cualquier proveedor, pero **no tiene un recurso "VM
genérica"**: cada proveedor tiene los suyos (`aws_instance`, `hcloud_server`,
`google_compute_instance`). Por eso todo lo que se puede compartir está en un
núcleo común, y lo único que cambia de un proveedor a otro es un adaptador de
unas 40–100 líneas que crea la máquina, la IP y el firewall.

```
infra/cloud/
├── stack/                       COMÚN — lo que corre en la máquina
│   ├── cloud-init.yaml.tftpl      primer arranque: Docker, swap, usuario, SSH, timers
│   ├── diagnosticar.sh            la herramienta de la máquina (deploy, rollback, secretos, backups…)
│   ├── docker-compose.yml         los 6 servicios
│   ├── Caddyfile                  HTTPS automático y ruteo por path
│   └── genes.lock                 qué genes.db se instala (release oficial + sha256)
├── modules/stack/               COMÚN — módulo Terraform: ajustes → cloud-init
├── scripts/remote.sh            COMÚN — administración por SSH desde la laptop
└── providers/                   ESPECÍFICO — un adaptador por proveedor
    ├── manual/                    sin proveedor: genera cloud-init.yaml para pegar en cualquier VM
    └── <proveedor>/               VM + IP + firewall, y le pasa el cloud-init común
```

Adaptadores disponibles:

| Adaptador | Estado |
|---|---|
| [`providers/aws`](providers/aws/README.md) | En uso: la copia de https://44-197-71-62.sslip.io |
| [`providers/manual`](providers/manual/main.tf) | Cualquier VM Ubuntu 24.04, creada a mano en cualquier proveedor |

| Parte | ¿Cambia con el proveedor? |
|---|---|
| Imágenes (GHCR), compose, Caddyfile, cloud-init, herramienta de la máquina, `remote.sh`, CI/CD | No |
| Deploy, rollback, secretos, backups, verificación | No |
| Crear la VM, la IP fija y el firewall; dónde guarda Terraform su state | Sí: el adaptador |

## Qué se levanta

```
Internet ─▶ IP pública ─▶ VM Ubuntu 24.04 (≥ 2 GB + 2 GB de swap, ≥ 30 GB de disco, x86-64)
                           └─ docker compose
                              ├─ caddy           HTTPS (Let's Encrypt) en 80/443
                              │    /api/*                → backend ─▶ postgres, genes.db (solo lectura)
                              │    /hpo-api/*            → hpo-recognizer (extractor)
                              │    /genphenai/*          → model
                              │    /deploy-status.json   → qué hizo el último deploy
                              │    resto                 → frontend
```

El dominio es `<ip-con-guiones>.sslip.io`: gratis, apunta solo a la IP de la
máquina, y Let's Encrypt lo acepta. Se puede cambiar por uno propio (`domain`).

## Cómo funciona

- **Primer arranque (cloud-init).** La máquina instala Docker, crea el swap y el
  usuario `diagnosticar` (solo con tu clave SSH), genera sus secretos y programa
  dos timers: deploy cada 5 minutos y backup cada noche (06:00 UTC).
- **Imágenes.** Los workflows `publish-cloud.yml` de cada repositorio construyen,
  prueban y publican las imágenes en GHCR (`ghcr.io/matealv/diagnosticar-cloud-*`).
  Cuando los tests pasan, mueven el tag `cloud` (el *canal*). El frontend se
  compila una sola vez con rutas relativas (`/api`, `/hpo-api`, `/genphenai`),
  así que la misma imagen sirve para cualquier dominio.
- **Deploy *pull*.** Cada 5 minutos la máquina pregunta a GHCR a qué digest
  apunta el canal. Si cambió, baja las imágenes nuevas, reinicia y corre los
  chequeos: los healthz, un ranking de referencia (`NF1, SPRED1, NF2`) y que la
  home renderice. **Si fallan, vuelve sola a las anteriores** y no reintenta ese
  mismo conjunto. Nadie necesita entrar a la máquina ni tener credenciales del
  proveedor para desplegar. Es el mismo patrón que usa nodo0 (`ops/deploy.sh`).
- **Secretos.** Se generan en la máquina (`/etc/diagnosticar/secrets.env`, modo
  600): la contraseña de Postgres, los secretos JWT y el par RSA de las sesiones.
  Los que vienen de afuera (el token de GHCR, el de Claude) se cargan con
  `remote.sh set-secret` por la entrada estándar. Nunca pasan por git, por el
  state de Terraform, por GitHub ni por la pantalla.
- **Administración.** Por SSH, como `diagnosticar`, **con el puerto 22 cerrado
  por defecto**. `remote.sh open` lo abre solo para la IP desde la que estás,
  `remote.sh close` lo cierra, y cualquier `terraform apply` posterior también
  lo cierra, porque la IP no se guarda en ningún archivo.

## Requisitos

- `terraform` ≥ 1.10, `gh` con acceso a los releases de
  `MateAlv/diagnostic.ar-gene-profiles`, `ssh`, `curl`.
- Una clave SSH para administrar: `ssh-keygen -t ed25519 -f ~/.ssh/diagnosticar_cloud`.
- Un token de GitHub *classic* con **solo** `read:packages`, de una cuenta con
  acceso a los paquetes `diagnosticar-cloud-*`, para que la máquina baje las
  imágenes.
- Las credenciales del proveedor elegido (ver el README de su adaptador).

## Levantarlo

### Con un adaptador (`providers/<proveedor>/`)

```bash
cd infra/cloud/providers/<proveedor>
# backend del state y variables: ver el README del adaptador
terraform init
terraform apply                                    # la VM arranca y se prepara sola
terraform output url
cd ../..

export CLOUD_PROVIDER=<proveedor>
scripts/remote.sh open                             # abre el 22 para tu IP (pide confirmación)
scripts/remote.sh setup                            # stack + genes.db + token de GHCR → deploy
scripts/remote.sh set-secret CLAUDE_CODE_OAUTH_TOKEN < archivo-con-el-token
scripts/remote.sh status
scripts/remote.sh close                            # cierra el 22
```

Después: registrate en la web con tu mail y tu contraseña, y
`scripts/remote.sh seed-admin vos@ejemplo.org` (con el 22 abierto) te hace admin.
Ninguna contraseña pasa por la terminal.

### En cualquier VM, sin adaptador (`providers/manual/`)

```bash
cd infra/cloud/providers/manual
terraform init && terraform apply                  # → cloud-init.yaml
```

1. Creá una VM **Ubuntu 24.04 x86-64** con ≥ 2 GB de RAM y ≥ 30 GB de disco, y
   pegá `cloud-init.yaml` en el campo de *user data* (según el proveedor:
   "cloud-init", "custom data", "datos de usuario").
2. En el firewall del proveedor: 80 y 443 abiertos a todos; 22 solo para tu IP,
   y solo mientras administrás.
3. `CLOUD_HOST=<ip> scripts/remote.sh setup`, y el resto igual que arriba.

Para una VM local, sin nube: `multipass launch 24.04 --name diagnosticar
--memory 4G --disk 30G --cloud-init cloud-init.yaml`. Let's Encrypt no va a poder
emitir el certificado (la VM no es alcanzable desde Internet), pero el resto del
stack levanta y los chequeos internos del deploy corren igual.

## Operación

Todo con `scripts/remote.sh` (con el 22 abierto: `open` … `close`).

| Qué | Cómo |
|---|---|
| Actualizar el código | Automático: un merge a `main` publica imágenes, la máquina las toma en ≤ 5 min |
| Ver qué corre | `status`, o `https://<dominio>/deploy-status.json` sin entrar |
| Logs | `logs [backend\|frontend\|hpo-recognizer\|model\|caddy\|db]` |
| Volver a la versión anterior | `rollback` (y el timer no vuelve a traer la que se dejó) |
| Cambiar el stack (compose, Caddyfile) | Editar `stack/` → `install-stack` (valida antes de reemplazar) |
| Cambiar `genes.db` | Nuevo release en gene-profiles → `stack/genes.lock` → `install-stack` → `install-genes` |
| Backups | Automáticos cada noche; a mano: `backup`. Restaurar: `restore archivo.sql.gz` |
| Rotar sesiones | `rotate JWT_ACCESS_KEYPAIR` y después `deploy` |
| Memoria | `stats` |

**Probá restaurar un backup** al menos una vez: un backup que nunca se restauró
no está verificado.

## Ajustes

Cada adaptador acepta una variable `stack_settings` que pasa sin cambios al
módulo común (`modules/stack/main.tf`, variable `settings`). Todas tienen valor
por defecto:

| Ajuste | Por defecto | Qué es |
|---|---|---|
| `recognizer_provider` | `claude-cli` | `claude-cli` (token de suscripción) o `anthropic` (API key). Ver [`docs/LLM_EN_LA_COPIA_AWS.md`](../../docs/LLM_EN_LA_COPIA_AWS.md) |
| `recognizer_model` | `claude-opus-5` | El modelo del extractor |
| `global_extractions_per_5h` / `_per_week` | 40 / 1.344 | Techo de todo el sitio (con API key: 5 y el presupuesto ÷ US$1,90) |
| `user_extractions_per_hour` / `_per_day` | 20 / 60 | Tope por cuenta |
| `max_concurrent_extractions`, `recognizer_llm_threads`, `recognizer_mem_limit` | 1, 2, `1300m` | Para 2 GB; subirlos en una máquina de 4 GB |
| `backup_remote`, `backup_keep_days` | vacío, 14 | Ver **Backups** |
| `registry`, `image_prefix`, `channel` | `ghcr.io/matealv`, `diagnosticar-cloud-`, `cloud` | De dónde salen las imágenes |

```hcl
# terraform.tfvars (ignorado por git)
stack_settings = {
  max_concurrent_extractions = 2
  recognizer_llm_threads     = 4
}
```

## Backups

`pg_dump` cada noche, guardado en la máquina 14 días y, si hay un destino
configurado, copiado ahí con [rclone](https://rclone.org), que habla con
casi cualquier almacenamiento. El destino es una *connection string* de rclone:

| Dónde | Cómo se configura |
|---|---|
| S3 con el rol de la instancia (AWS) | `backup_remote = ":s3,provider=AWS,env_auth=true,region=us-east-1,no_check_bucket=true,no_head=true:bucket/backups"` (no es secreto) |
| Cualquier otro (GCS, Azure Blob, B2, R2, SFTP…) con credenciales | `remote.sh set-secret BACKUP_REMOTE_SECRET` con la connection string que las incluye (es secreta: nunca en Terraform) |

La máquina solo escribe (`rclone rcat`): no necesita permiso para leer ni
listar lo que ya está, así que alguien con acceso a ella no puede leer ni
borrar los backups anteriores.

## Cómo agregar un proveedor

Un adaptador es una carpeta `providers/<nombre>/` que crea la máquina y le pasa
el cloud-init común. No toca nada fuera de su carpeta.

### Lo que tiene que cumplir

**Entradas** (las mismas en todos, para que `remote.sh` funcione igual):

| Variable | Tipo | Por defecto |
|---|---|---|
| `ssh_public_key_path` | `string` | `"~/.ssh/diagnosticar_cloud.pub"` |
| `admin_cidrs` | `list(string)` | `[]`: el puerto 22 cerrado |
| `stack_settings` | `any` | `{}`: pasa sin cambios a `modules/stack` |

Además, las propias del proveedor: región, tamaño de la máquina, etc.

**Salidas:**

| Output | Qué es |
|---|---|
| `url` | `https://<dominio>` |
| `ssh_host` | La IP o el nombre al que se conecta `remote.sh` |

**La máquina:**

1. Ubuntu **24.04** LTS, **x86-64**: las imágenes se publican para amd64, así
   que una máquina ARM no las corre.
2. ≥ 2 GB de RAM y ≥ 30 GB de disco.
3. Firewall: 80 y 443 abiertos a todos; 22 **solo** desde `admin_cidrs` (sin
   regla si está vacío); nada más.
4. Una IP fija, separada de la VM si el proveedor lo permite, para que el dominio
   sobreviva a reemplazar la máquina. Con esa IP, `domain = "<ip-con-guiones>.sslip.io"`;
   sin IP fija, `domain = "auto"` y la máquina la detecta sola.
5. *User data* = `module.stack.cloud_init`. Si el proveedor pone un límite de
   16 KB, usar `module.stack.cloud_init_base64gzip`: cloud-init detecta gzip solo.
6. Ignorar cambios del *user data* y de la imagen (`lifecycle { ignore_changes = [...] }`):
   cloud-init corre una sola vez y el stack se actualiza con `install-stack`, así
   que cambiarlo no debe recrear la máquina (ni borrar la base).
7. El state de Terraform en un backend remoto, privado y cifrado: el
   almacenamiento de objetos del proveedor o HCP Terraform. Nunca en git.

### Paso a paso

1. Copiá un adaptador existente: `cp -r providers/aws providers/<nombre>`, o
   partí del esqueleto de abajo.
2. Reemplazá los recursos de VM, IP y firewall por los del proveedor (su
   *provider* de Terraform está en <https://registry.terraform.io>), respetando
   la lista de arriba.
3. Escribí su `README.md`: credenciales, backend del state, costos y cómo
   apagarlo.
4. `terraform fmt` y `terraform validate`. El job **Cloud infrastructure** del CI
   valida todos los adaptadores de `providers/` sin credenciales.
5. Levantalo y pasá la verificación de abajo.

### Esqueleto (ejemplo para Hetzner Cloud: pasa `terraform validate`, nunca se levantó)

```hcl
terraform {
  required_version = ">= 1.10"
  required_providers {
    hcloud = { source = "hetznercloud/hcloud", version = "~> 1.50" }
  }
  backend "s3" {} # el object storage de Hetzner es compatible con S3
}

variable "ssh_public_key_path" { default = "~/.ssh/diagnosticar_cloud.pub" }
variable "admin_cidrs" {
  type    = list(string)
  default = []
}
variable "stack_settings" {
  type    = any
  default = {}
}
variable "location" { default = "nbg1" }
variable "server_type" { default = "cx22" } # 2 vCPU x86, 4 GB

resource "hcloud_primary_ip" "web" {
  name        = "diagnosticar"
  type        = "ipv4"
  location    = var.location
  auto_delete = false
}

module "stack" {
  source          = "../../modules/stack"
  ssh_public_keys = [file(pathexpand(var.ssh_public_key_path))]
  domain          = "${replace(hcloud_primary_ip.web.ip_address, ".", "-")}.sslip.io"
  settings        = var.stack_settings
}

resource "hcloud_firewall" "web" {
  name = "diagnosticar"
  dynamic "rule" {
    for_each = { "80" = ["0.0.0.0/0", "::/0"], "443" = ["0.0.0.0/0", "::/0"] }
    content {
      direction  = "in"
      protocol   = "tcp"
      port       = rule.key
      source_ips = rule.value
    }
  }
  dynamic "rule" {
    for_each = length(var.admin_cidrs) > 0 ? [1] : []
    content {
      direction  = "in"
      protocol   = "tcp"
      port       = "22"
      source_ips = var.admin_cidrs
    }
  }
}

resource "hcloud_server" "web" {
  name         = "diagnosticar"
  image        = "ubuntu-24.04"
  server_type  = var.server_type
  location     = var.location
  firewall_ids = [hcloud_firewall.web.id]
  user_data    = module.stack.cloud_init
  public_net {
    ipv4 = hcloud_primary_ip.web.id
  }
  lifecycle {
    ignore_changes = [user_data, image]
  }
}

output "url" { value = "https://${module.stack.config.DOMAIN}" }
output "ssh_host" { value = hcloud_primary_ip.web.ip_address }
```

### Verificación (para cualquier proveedor)

Con el 22 abierto (`remote.sh open`):

1. `remote.sh status`: todos los contenedores `Up`, y `deploy-status.json` con `"result": "ok"`.
2. `curl -s <url>/genphenai/healthz`: `in-process`, `checkpoint_sha256` empieza con `ee10aa42`.
3. Ranking de referencia: `curl -s -X POST <url>/genphenai/rank-genes -H 'Content-Type: application/json' -d '{"hpo_ids":["HP:0000957","HP:0001067","HP:0009737","HP:0000316"],"top_k":3}'` → `NF1`, `SPRED1`, `NF2`.
4. `SMOKE_HEALTH_PATH=/api/health ../../ops/smoke.sh <url> <url>` → `SMOKE PASS`.
5. Con el token de Claude cargado, `<url>/hpo-api/healthz` dice `extract_hpo.ready: true`, y una historia con
   una negación ("no presenta convulsiones") no aparece como síntoma presente.
6. `remote.sh backup` y `remote.sh restore` con ese dump: la web sigue andando con los mismos usuarios.
7. Reiniciar la VM desde la consola del proveedor: todo vuelve solo.

## Memoria

Cada llamada al CLI de Claude es un proceso de ~260 MB y el extractor ya ocupa
~500 MB, así que en 2 GB corre una extracción a la vez con dos llamadas en
paralelo. Si `remote.sh stats` muestra menos de ~300 MB libres o el swap se usa
todo el tiempo, pasá a una máquina de 4 GB y subí `max_concurrent_extractions`
y `recognizer_llm_threads` en `stack_settings`.

## Reglas

- Solo datos sintéticos. Nunca un dump de producción ni "unas filas para probar".
- Secretos nuevos, generados en la máquina; nunca copiados de staging ni producción.
- No depende de nodo0 ni de brainy.
- La salida nunca se presenta como diagnóstico.
