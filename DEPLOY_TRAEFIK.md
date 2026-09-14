# Deploy `diagnostic.ar` con Traefik (nodo0 + brainy)

Guia actualizada segun el codigo real de `diagnostic.ar` y `diagnostic.ar-api`.

- `nodo0`: Traefik (ya existente), `diagnostic.ar` (frontend + backend + postgres)
- `brainy`: `diagnostic.ar-api` (api + genphenai + redis + audit-db) + Ollama + GPU
- Conexion entre nodos: tunel SSH reverso `brainy -> nodo0`

## 1) Topologia y rutas

Host publico:

- `https://diagnosticar.infra.cluster.qb.fcen.uba.ar`

Ruteo en `nodo0` (Traefik):

- `/` -> frontend (`frontend:3000`)
- `/api` -> backend (`backend:4000`)
- `/hpo-api` -> `hpo-tunnel` (`socat` -> `host.docker.internal:8000`)
- `/genphenai` -> `genphenai-tunnel` (`socat` -> `host.docker.internal:18020`)

Nota importante: en el backend actual el health interno es `/health` (no existe `/api/health` publico).

## 2) Prerrequisitos

En `brainy`:

- Docker + Docker Compose plugin
- Drivers NVIDIA + NVIDIA Container Toolkit
- Acceso SSH hacia `nodo0`

En `nodo0`:

- Docker + Docker Compose plugin
- Traefik corriendo y red Docker externa disponible (ejemplo `internal-nodo0-web`)

## 3) Layout esperado de repos en `brainy`

`diagnostic.ar-api` monta los datos de `diagnosticar_tools` via ruta relativa `../diagnosticar_tools/data`.

Ejemplo recomendado:

```bash
~/apps/diagnostic.ar-api
~/apps/diagnosticar_tools
```

Si el nombre/carpeta no coincide, ajusta el volumen en `diagnostic.ar-api/docker-compose.yml`.

## 4) Setup en `brainy` (GPU/API)

### 4.1 Clonar repos y preparar `.env`

```bash
cd ~/apps
git clone <repo-diagnostic-ar-api> diagnostic.ar-api
git clone <repo-diagnosticar-tools> diagnosticar_tools

cd ~/apps/diagnostic.ar-api
cp -n .env.example .env
```

Variables minimas en `~/apps/diagnostic.ar-api/.env`:

- `CORS_ORIGINS=https://diagnosticar.infra.cluster.qb.fcen.uba.ar`
- `API_BIND_IP=127.0.0.1`
- `GENPHENAI_BIND_IP=127.0.0.1`
- `AUDIT_DB_PASSWORD=<password-fuerte>`
- `AUDIT_DATABASE_URL=postgresql://diagnostic_audit:<password-fuerte>@audit-db:5432/diagnostic_audit`

### 4.2 Crear red externa y levantar Ollama

```bash
docker network create llm_net 2>/dev/null || true

docker run -d \
  --name llm-ollama \
  --restart unless-stopped \
  --network llm_net \
  -p 127.0.0.1:11434:11434 \
  -v ollama_data:/root/.ollama \
  ollama/ollama

docker exec -it llm-ollama ollama pull qwen2.5:7b
```

### 4.3 Deploy API en `brainy`

```bash
cd ~/apps/diagnostic.ar-api
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Verificaciones locales:

```bash
curl -sS http://127.0.0.1:8000/healthz
curl -sS http://127.0.0.1:18020/healthz
```

## 5) Tunel SSH reverso persistente (`brainy -> nodo0`)

No hay un archivo `diagnosticar-tunnel.service` en este repo, asi que debes crearlo.

### 5.1 Archivo systemd en `brainy`

Crear `/etc/systemd/system/diagnosticar-tunnel.service`:

```ini
[Unit]
Description=Reverse SSH tunnel brainy -> nodo0 (diagnostic.ar)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment="NODO0_USER=CHANGE_ME"
Environment="NODO0_HOST=CHANGE_ME"
ExecStart=/usr/bin/ssh -NT \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -R 0.0.0.0:8000:127.0.0.1:8000 \
  -R 0.0.0.0:18020:127.0.0.1:18020 \
  ${NODO0_USER}@${NODO0_HOST}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Activar:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now diagnosticar-tunnel
sudo systemctl status diagnosticar-tunnel --no-pager
```

### 5.2 Ajuste en `nodo0` (sshd)

Para permitir `-R 0.0.0.0:...`, en `nodo0` revisar `/etc/ssh/sshd_config`:

- `AllowTcpForwarding yes`
- `GatewayPorts clientspecified`

Luego reiniciar `sshd`.

### 5.3 Claves SSH y seguridad de puertos

- El servicio systemd usa `ssh` no interactivo: configura autenticacion por clave (sin prompt) de `brainy` hacia `nodo0`.
- Agrega la clave publica de `brainy` en `~/.ssh/authorized_keys` del usuario `NODO0_USER`.
- Como el tunel remoto queda publicado en `0.0.0.0:8000` y `0.0.0.0:18020`, restringe acceso con firewall en `nodo0` para permitir solo trafico local/infra de confianza.

## 6) Setup en `nodo0` (web + traefik)

### 6.1 Clonar repo y preparar `.env`

```bash
cd ~/apps
git clone <repo-diagnostic-ar> diagnostic.ar

cd ~/apps/diagnostic.ar
cp -n .env.example .env
```

Variables clave en `~/apps/diagnostic.ar/.env`:

- `DIAGNOSTICAR_HOST=diagnosticar.infra.cluster.qb.fcen.uba.ar`
- `TRAEFIK_NETWORK=internal-nodo0-web` (o la red real de tu Traefik)
- `JWT_ACCESS_SECRET` y `JWT_REFRESH_SECRET` (>=32 chars)
- `POSTGRES_PASSWORD` y `DATABASE_URL` consistentes

### 6.2 Validar prerequisitos de red/tunel

```bash
docker network ls | grep internal-nodo0-web

curl -sS http://127.0.0.1:8000/healthz
curl -sS http://127.0.0.1:18020/healthz

docker run --rm --add-host host.docker.internal:host-gateway \
  curlimages/curl:8.10.1 -sS http://host.docker.internal:8000/healthz
docker run --rm --add-host host.docker.internal:host-gateway \
  curlimages/curl:8.10.1 -sS http://host.docker.internal:18020/healthz
```

Si los `curl` desde contenedor fallan, los servicios `hpo-tunnel`/`genphenai-tunnel` no van a enrutar.

### 6.3 Deploy web en `nodo0`

```bash
cd ~/apps/diagnostic.ar
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Verificacion local backend:

```bash
curl -sS http://127.0.0.1:4000/health
```

## 7) Validacion final end-to-end

Desde cualquier cliente:

```bash
curl -i https://diagnosticar.infra.cluster.qb.fcen.uba.ar/
curl -i https://diagnosticar.infra.cluster.qb.fcen.uba.ar/hpo-api/healthz
curl -i https://diagnosticar.infra.cluster.qb.fcen.uba.ar/genphenai/healthz
curl -i https://diagnosticar.infra.cluster.qb.fcen.uba.ar/api/auth/me
```

Esperado:

- `/` -> `200`
- `/hpo-api/healthz` -> `200`
- `/genphenai/healthz` -> `200`
- `/api/auth/me` -> `401` (sin sesion), lo cual confirma que Traefik enruta `/api` al backend.

## 8) Logs y debug utiles

`brainy`:

```bash
cd ~/apps/diagnostic.ar-api
docker compose logs -f api genphenai redis audit-db
docker logs -f llm-ollama
sudo systemctl status diagnosticar-tunnel --no-pager
```

`nodo0`:

```bash
cd ~/apps/diagnostic.ar
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f frontend backend hpo-tunnel genphenai-tunnel
```

## 9) Limitaciones actuales a tener en cuenta

- `genphenai` esta en modo beta estatico (ranking fijo, no usa realmente los HPO de entrada para rankear genes).
- `STORE_REQUESTS=true` guarda texto clinico en `audit-db`; si hay datos sensibles, definir politica de retencion y acceso antes de producir.
