# La copia en la nube, independiente del proveedor

Qué se cambió en octubre de 2026 en el despliegue en la nube de diagnostic.ar, por
qué, y en qué estado quedó. La guía de uso es
[`infra/cloud/README.md`](../infra/cloud/README.md); la de qué es cada pieza del
sistema, [`CLOUD_DEPLOY.md`](CLOUD_DEPLOY.md).

## El problema

La primera copia en la nube (`infra/aws/`, 2026-10-01) usaba Terraform, pero solo
servía para AWS. Tres partes dependían de servicios propios de AWS:

| Parte | Cómo estaba hecha | Servicio de AWS |
|---|---|---|
| Infraestructura | Instancia, registro de imágenes, parámetros, permisos | EC2, ECR, SSM Parameter Store, IAM |
| La máquina | Leía su configuración y sus secretos, bajaba imágenes y guardaba backups con la CLI de AWS | SSM, ECR, S3 |
| El despliegue desde GitHub | Entraba a AWS con OIDC y ejecutaba el deploy en la instancia | IAM (OIDC), SSM Run Command |

La idea de usar Terraform era poder levantar el sistema en cualquier proveedor.
Pero Terraform no lo resuelve solo: **no tiene un recurso "máquina virtual
genérica"**, y cada proveedor tiene los suyos (`aws_instance`,
`google_compute_instance`, `hcloud_server`). La portabilidad hay que diseñarla, y
en la primera versión no se hizo.

## La solución: un núcleo común y un adaptador chico por proveedor

Todo lo que puede ser igual en cualquier nube pasó a un núcleo común. Lo único
que cambia de un proveedor a otro es un **adaptador** de 40 a 100 líneas que crea
la máquina, la IP fija y el firewall, y le pasa la configuración común.

```
infra/cloud/
├── stack/            COMÚN: cloud-init, docker-compose, Caddyfile, herramienta de la máquina
├── modules/stack/    COMÚN: módulo Terraform que arma el cloud-init
├── scripts/remote.sh COMÚN: administración por SSH
└── providers/
    ├── aws/          ESPECÍFICO: EC2 + Elastic IP + security group
    └── manual/       SIN PROVEEDOR: el cloud-init para pegar en cualquier VM
```

| | Antes (`infra/aws/`) | Ahora (`infra/cloud/`) |
|---|---|---|
| Proveedores | Solo AWS | Cualquiera con Ubuntu 24.04 y cloud-init (AWS, Google Cloud, Azure, DigitalOcean, Hetzner, Oracle, Linode, Vultr, una VM local) |
| Código específico de AWS | Todo el Terraform, el script de la máquina, los workflows | Solo `providers/aws/` |
| Sistema operativo | Amazon Linux 2023 | Ubuntu 24.04, que ofrecen todos |
| Imágenes | ECR (de AWS) | GHCR (de GitHub) |
| Cómo llega una versión nueva | GitHub entra a AWS y ordena el deploy (*push*) | La máquina revisa cada 5 minutos si hay versión nueva (*pull*) |
| Credenciales de la nube en GitHub | Un rol de AWS (OIDC) | Ninguna |
| Vuelta atrás si falla | La hace el workflow de GitHub | La hace la propia máquina |
| Secretos | SSM Parameter Store (AWS) | Generados en la máquina; los de afuera, cargados por SSH |
| Backups | S3 con la CLI de AWS | rclone: S3, Google Cloud Storage, Azure, B2, SFTP… |
| Administración | SSM, sin puerto 22 (AWS) | SSH, con el puerto 22 cerrado salvo cuando se administra |
| Frontend | Una imagen por dominio (las URLs quedaban compiladas adentro) | Una sola imagen, con URLs relativas, para cualquier dominio |

## Las decisiones, y por qué

1. **cloud-init sobre Ubuntu 24.04.** Es el formato estándar para configurar una
   máquina en su primer arranque, y lo leen todos los proveedores. Elegir un único
   sistema operativo que todos ofrecen permite que el mismo archivo funcione en
   cualquiera.
2. **Imágenes en GHCR.** El registro de GitHub no depende de ninguna nube, ya lo
   usaba el release de producción, y los workflows publican con el token que
   GitHub les da, sin secretos nuevos. Son paquetes separados
   (`diagnosticar-cloud-*`) para no mezclarse con los de producción.
3. **Deploy *pull*.** Cada máquina pregunta cada 5 minutos a qué versión apunta el
   tag `cloud`. Si cambió, despliega, corre chequeos (healthz, un ranking de
   referencia, que la home renderice) y, si fallan, vuelve sola a la versión
   anterior. Así GitHub no necesita entrar a ninguna máquina ni tener credenciales
   de ningún proveedor, y una misma publicación sirve para copias en varias nubes a
   la vez. Es el mismo patrón que ya usaba producción en nodo0 (`ops/deploy.sh`).
4. **Secretos generados en la máquina.** La contraseña de Postgres, los secretos
   JWT y las claves de las sesiones se crean en el primer arranque y no salen de
   ahí. Los que vienen de afuera (el token de GHCR, el de Claude) se cargan por
   SSH desde la entrada estándar. Nunca pasan por git, por el state de Terraform,
   por GitHub ni por la pantalla.
5. **SSH cerrado por defecto.** Sin los servicios propios de cada nube, SSH es la
   forma de administrar que funciona igual en todas. Para no exponerlo,
   `remote.sh open` abre el puerto 22 solo para la IP desde la que se administra
   y `remote.sh close` lo cierra. Además, cualquier `terraform apply` posterior lo
   cierra, porque la IP nunca se guarda. Así funciona aunque la IP de quien
   administra sea dinámica.
6. **Frontend con URLs relativas.** Las URLs de los servicios se compilaban dentro
   del frontend, lo que obligaba a una imagen por dominio. Como Caddy sirve todo
   en el mismo dominio, se compilan como `/api`, `/hpo-api` y `/genphenai`, y la
   misma imagen sirve en cualquier lado. La suite E2E completa pasa igual con ese
   build: 291 pruebas pasadas, 7 salteadas a propósito.
7. **El cloud-init lleva solo la herramienta de la máquina.** El resto del stack
   (compose, Caddyfile) llega en la primera sesión de administración
   (`remote.sh setup`), en la que igual hay que cargar el token y la base de genes.
   Así entra holgado en el límite de *user data* más chico: 16 KB en AWS, y el
   cloud-init comprimido pesa 10,7 KB.

## Qué se perdió, y qué se aceptó

- **La administración sin puerto 22 de AWS (SSM)** se reemplazó por SSH abierto
  solo para la IP de quien administra y solo mientras lo hace.
- **El escaneo de vulnerabilidades de ECR al subir** no existe en GHCR. Se puede
  agregar Trivy a los workflows (el release de nodo0 ya lo usa); queda pendiente.
- **El resultado del deploy en GitHub Actions** ya no es inmediato: la máquina lo
  publica en `/deploy-status.json`, y un job opcional de cada workflow lo espera si
  la variable `CLOUD_URLS` está definida.
- **Latencia:** una versión nueva tarda hasta 5 minutos más en llegar.

## Cambios por repositorio

Cada cambio está en su propia rama:

| Repositorio | Rama | Qué hace |
|---|---|---|
| `diagnostic.ar` | `feat/cloud-common-stack` | El núcleo común (`infra/cloud/`), el adaptador `manual`, `remote.sh`, el README con "Cómo agregar un proveedor", y el job de CI que valida la infraestructura |
| `diagnostic.ar` | `feat/cloud-provider-aws` | El adaptador de AWS y su bootstrap, con la migración desde `infra/aws/` (sobre la rama anterior) |
| `diagnostic.ar` | `feat/cloud-publish-ghcr` | Publica backend y frontend en GHCR |
| `diagnostic.ar-api` | `feat/cloud-publish-ghcr` | Publica el modelo y el extractor en GHCR |
| `spanish-symptoms-recognizer` | `feat/cloud-publish-ghcr` | Publica el extractor en GHCR |
| `diagnostic.ar` | `docs/cloud-cambios` | Este documento |
| los tres | `chore/remove-aws-native` (después de migrar) | Borrar `infra/aws/`, `deploy-aws.yml` y `aws-deploy.sh`, y actualizar la documentación |

No se tocó nada de producción ni de staging en nodo0.

## Cómo se probó

| Qué | Cómo | Resultado |
|---|---|---|
| El cloud-init | `cloud-init schema` sobre el archivo generado | Válido; 16 KB en texto, 10,7 KB comprimido |
| La herramienta de la máquina | shellcheck; secretos, `.env` y validaciones probados en un entorno aislado | Sin errores; los secretos no se pisan, el token del registro no llega a los contenedores, las claves PEM quedan en una línea |
| El compose | `docker compose config` con el `.env` generado | Válido |
| Terraform | `fmt` y `validate` del módulo y de cada adaptador; `plan` real del adaptador AWS contra la cuenta | Válido; el plan crea 10 recursos con el puerto 22 cerrado |
| El esqueleto de ejemplo para Hetzner | `terraform validate` | Válido (nunca se levantó) |
| El frontend con URLs relativas | Build de producción + suite E2E completa | 291 pasadas, 7 salteadas a propósito; ninguna URL absoluta en el bundle |
| En la nube, de punta a punta (2026-10-04) | La lista de verificación de `infra/cloud/README.md`, al migrar la copia de AWS | Primer deploy en 7,5 min con todos los chequeos; HTTPS de Let's Encrypt; modelo `in-process` con el re-ranker; ranking `NF1, SPRED1, NF2`; extractor listo con Claude; `ops/smoke.sh` → SMOKE PASS; la base restaurada idéntica a la anterior y la cuenta existente entra; backup copiado a S3 con el rol de solo escritura; puerto 22 cerrado al terminar |

El CI suma el job **Cloud infrastructure**, que repite estos chequeos estáticos en
cada pull request que toca `infra/cloud/`.

## Cómo agregar un proveedor

En resumen: copiar `providers/aws/`, cambiar los recursos de máquina, IP y
firewall por los del proveedor nuevo, respetar las entradas (`ssh_public_key_path`,
`admin_cidrs`, `domain`, `stack_settings`) y salidas (`url`, `ssh_host`, `config`) comunes, y pasarle
el cloud-init del módulo común como *user data*. El detalle, un esqueleto de
ejemplo y la lista de verificación están en
[`infra/cloud/README.md`, "Cómo agregar un proveedor"](../infra/cloud/README.md#cómo-agregar-un-proveedor).

Para un proveedor sin adaptador no hace falta escribir nada: `providers/manual`
genera el cloud-init para pegarlo al crear la VM a mano.

## Cómo quedó (2026-10-04)

- La copia de https://44-197-71-62.sslip.io corre sobre `infra/cloud/` con el
  adaptador de AWS. Se conservó la URL moviendo la Elastic IP al state nuevo, la
  base pasó con un backup y un restore, y la web estuvo caída unos 20 minutos.
- Lo viejo se destruyó: la instancia anterior, los repositorios de ECR, el rol
  OIDC, el documento y los parámetros de SSM, y el `genes.db` suelto en S3. Los
  buckets quedaron: guardan el state de Terraform y los backups.
- Los tres repositorios publican en GHCR al mergear a `main`, y la máquina toma
  cada versión nueva sola.

## Dominio propio: diagnosticar.app detrás de Cloudflare (2026-10-07)

**El problema.** `diagnosticar.app` tiene el DNS en Cloudflare, con el registro
`A` a la Elastic IP en modo Proxied. Entrar al sitio daba **525**: Cloudflare no
lograba el *handshake* TLS con la máquina. El adaptador de AWS fijaba el dominio
en `<ip-con-guiones>.sslip.io`, así que Caddy solo tenía ese sitio y ese
certificado. Cuando Cloudflare pedía `diagnosticar.app`, Caddy cortaba la
conexión (`openssl s_client -servername diagnosticar.app` → `tlsv1 alert
internal error`).

**La solución.**

| Pieza | Cambio |
|---|---|
| `providers/aws` | Variable `domain` (en `terraform.tfvars`). Con un dominio propio, el de sslip.io pasa al módulo como alias |
| `modules/stack` | Variable `domain_aliases` → `DOMAIN_ALIASES` en `config.env` |
| `stack/Caddyfile` | Sirve el dominio y los alias. Los alias redirigen al dominio, salvo `/deploy-status.json` |
| `stack/Caddyfile` | Toma la IP real de `CF-Connecting-IP`, solo si la conexión viene de Cloudflare, y la pasa como único `X-Forwarded-For` |
| `diagnosticar set-config` / `remote.sh sync-config` | Llevan a la máquina el `config.env` que hoy tiene Terraform: muestran la diferencia, preguntan y redespliegan |

**Decisiones.**

- **Let's Encrypt, no Origin CA de Cloudflare.** Caddy saca y renueva el
  certificado solo, por HTTP-01, porque Cloudflare deja pasar el puerto 80 a la
  máquina. Así no hay un certificado que generar ni instalar a mano, y el stack
  sigue siendo el mismo con o sin Cloudflare. Cloudflare va en **Full (strict)**,
  que verifica ese certificado. *Flexible* no sirve: genera un bucle de
  redirecciones.
- **La IP real del visitante.** Sin este cambio, el backend y el extractor
  verían solo direcciones de Cloudflare, y los límites por IP mezclarían a
  usuarios distintos. Caddy confía en `CF-Connecting-IP` solo cuando la conexión
  viene de los rangos de Cloudflare: otra máquina no puede elegir su propia
  dirección. El backend y el extractor no cambian.
- **Un comando para la configuración.** Las instancias ignoran los cambios de
  *user data* para no recrearse (ni perder la base), así que un cambio de
  Terraform no llegaba a `config.env`. `sync-config` reemplaza el archivo entero,
  porque no tiene nada secreto, y guarda el anterior en `config.env.previous`.
- **Sigue con `noindex`.** Es una copia de prueba con datos sintéticos.

**Cómo se probó.** Caddy 2.11 local con el Caddyfile nuevo:

- La IP de `CF-Connecting-IP` se usa si viene de un rango confiable y se ignora
  si no. Un `X-Forwarded-For` falso no pasa.
- El alias redirige con 308 y `/deploy-status.json` responde.
- `noindex` sale también en el alias.

Además: `caddy fmt`, `terraform validate` y `plan` (solo cambian outputs: la
instancia no se toca), `shellcheck`, y `set-config` en un entorno aislado (dry-run,
aplicar, sin cambios, línea inválida, sin `DOMAIN`).

## Lo que falta

1. Mergear `chore/remove-aws-native` en los tres repositorios: borra `infra/aws/`
   y los workflows viejos, que ya no tienen contra qué desplegar.
2. El dueño de los repositorios: borrar el secreto `AWS_DEPLOY_ROLE_ARN` de
   `diagnostic.ar`, `diagnostic.ar-api` y `spanish-symptoms-recognizer`.
3. Agregar el escaneo de vulnerabilidades (Trivy) a los workflows de publicación.
4. Cambiar la variable `CLOUD_URLS` de `diagnostic.ar` y `diagnostic.ar-api` a
   `https://diagnosticar.app` (la URL vieja sigue sirviendo `/deploy-status.json`,
   así que no es urgente).
5. Probar un segundo proveedor, o `providers/manual` en una VM local, para mostrar
   la portabilidad funcionando y no solo validada.
