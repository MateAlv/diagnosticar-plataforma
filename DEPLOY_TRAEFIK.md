# Deploy `diagnostic.ar` con Traefik (nodo0 + brainy)

Guía para producción en 2 nodos:

- `nodo0`: frontend + backend + postgres + Traefik (ya existente en el host)
- `brainy`: `diagnostic.ar-api` (HPO API + GenPhenAI + Redis + audit-db + Ollama)
- Comunicación: túnel SSH reverso `brainy -> nodo0`

## 0) Runbook rápido (para mañana)

### En `brainy`

```bash
cd /home/<usuario>/LUCAI/Web/diagnostic.ar-api
cp -n .env.example .env
# editar .env (CORS_ORIGINS, AUDIT_DB_PASSWORD, etc.)

sudo cp /home/<usuario>/LUCAI/Web/deploy/diagnosticar-tunnel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl edit diagnosticar-tunnel
# setear NODO0_USER y NODO0_HOST en el override
sudo systemctl enable --now diagnosticar-tunnel
sudo systemctl status diagnosticar-tunnel --no-pager

cd /home/<usuario>/LUCAI/Web
make deploy-brainy

curl -sS http://127.0.0.1:8000/healthz
curl -sS http://127.0.0.1:18020/healthz
```

### En `nodo0`

```bash
cd /home/<usuario>/LUCAI/Web/diagnostic.ar
cp -n .env.example .env
# editar .env (DIAGNOSTICAR_HOST, TRAEFIK_NETWORK, JWT_*, DB, etc.)

docker network ls | grep -E "internal-nodo0-web|web"
curl -sS http://127.0.0.1:8000/healthz
curl -sS http://127.0.0.1:18020/healthz

cd /home/<usuario>/LUCAI/Web
make deploy-nodo0
```

### Validación pública final

```bash
curl -i https://diagnosticar.infa.cluster.qb.fcen.uba.ar/api/health
curl -i https://diagnosticar.infa.cluster.qb.fcen.uba.ar/hpo-api/healthz
curl -i https://diagnosticar.infa.cluster.qb.fcen.uba.ar/genphenai/healthz
```

Esperado: status `200` en los tres endpoints.

## 1) Arquitectura objetivo

- Público:
  - `https://diagnosticar.infa.cluster.qb.fcen.uba.ar`
- Ruteo por Traefik (en `nodo0`):
  - `/` -> frontend (`frontend:3000`)
  - `/api` -> backend (`backend:4000`)
  - `/hpo-api` -> túnel a `brainy` puerto `8000`
  - `/genphenai` -> túnel a `brainy` puerto `18020`

En `diagnostic.ar/docker-compose.prod.yml` se usan dos bridges `socat` (`hpo-tunnel` y `genphenai-tunnel`) para reenviar hacia `host.docker.internal` (puertos del túnel en `nodo0`).

## 2) Configurar `brainy`

### 2.1 Variables

```bash
cd /home/<usuario>/LUCAI/Web/diagnostic.ar-api
cp .env.example .env
```

Completar `.env` (mínimo):

- `CORS_ORIGINS=https://diagnosticar.infa.cluster.qb.fcen.uba.ar`
- `API_BIND_IP=127.0.0.1`
- `GENPHENAI_BIND_IP=127.0.0.1`
- credenciales `AUDIT_DB_*`

### 2.2 Túnel reverso persistente

Archivo base: `/home/<usuario>/LUCAI/Web/deploy/diagnosticar-tunnel.service`

En `brainy`:

```bash
sudo cp /home/<usuario>/LUCAI/Web/deploy/diagnosticar-tunnel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl edit diagnosticar-tunnel
```

En el override, definir:

- `NODO0_USER=<usuario_en_nodo0>`
- `NODO0_HOST=<host_ssh_de_nodo0>`

Luego:

```bash
sudo systemctl enable --now diagnosticar-tunnel
sudo systemctl status diagnosticar-tunnel
```

### 2.3 Deploy de API en `brainy`

```bash
cd /home/<usuario>/LUCAI/Web
make deploy-brainy
```

Verificación local en `brainy`:

```bash
curl -sS http://127.0.0.1:8000/healthz
curl -sS http://127.0.0.1:18020/healthz
```

## 3) Configurar `nodo0`

### 3.1 Variables

```bash
cd /home/<usuario>/LUCAI/Web/diagnostic.ar
cp .env.example .env
```

Completar `.env`:

- `DIAGNOSTICAR_HOST=diagnosticar.infa.cluster.qb.fcen.uba.ar`
- `TRAEFIK_NETWORK=<red_externa_que_usa_tu_traefik>` (ej: `internal-nodo0-web`)
- secretos JWT / DB / OAuth / SMTP según aplique

### 3.2 Validar prerequisitos Traefik + túnel

En `nodo0`:

```bash
docker network ls | grep -E "internal-nodo0-web|web"
curl -sS http://127.0.0.1:8000/healthz
curl -sS http://127.0.0.1:18020/healthz
```

Si los `curl` locales fallan, el túnel desde `brainy` no está operativo.

### 3.3 Deploy web en `nodo0`

```bash
cd /home/<usuario>/LUCAI/Web
make deploy-nodo0
```

## 4) Validación end-to-end

Desde cualquier cliente con acceso público:

```bash
curl -sS https://diagnosticar.infa.cluster.qb.fcen.uba.ar/api/health
curl -sS https://diagnosticar.infa.cluster.qb.fcen.uba.ar/hpo-api/healthz
curl -sS https://diagnosticar.infa.cluster.qb.fcen.uba.ar/genphenai/healthz
```

Los tres deben responder `200`.

## 5) Comandos útiles

- Logs API (`brainy`): `cd /home/<usuario>/LUCAI/Web/diagnostic.ar-api && docker compose logs -f api genphenai`
- Logs web (`nodo0`): `cd /home/<usuario>/LUCAI/Web/diagnostic.ar && docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f frontend backend hpo-tunnel genphenai-tunnel`
- Estado túnel (`brainy`): `sudo systemctl status diagnosticar-tunnel`
