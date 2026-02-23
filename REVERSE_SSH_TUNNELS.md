# Reverse SSH Tunnels (brainy -> nodo0)

Este documento explica como funcionan los reverse SSH tunnels del cluster,
como se administran por `systemd`, y como crear uno nuevo sin romper servicios
existentes.

## 1) Resumen rapido

En este cluster, los servicios que corren en `brainy` exponen puertos locales
y se publican en `nodo0` usando `ssh -R`.

Patron:

- Origen: `brainy` (servicio local, por ejemplo `127.0.0.1:8000`)
- Tunel: `ssh -R 172.17.0.1:<REMOTE_PORT>:127.0.0.1:<LOCAL_PORT> ...`
- Destino: `nodo0` escucha en `172.17.0.1:<REMOTE_PORT>`
- Docker/Traefik en `nodo0` consume via `host.docker.internal:<REMOTE_PORT>`

## 2) Servicios actuales (systemd)

En `brainy` hay servicios `systemd` del estilo:

- `ssh-tunnel-luca.service`
- `ssh-tunnel-nunatak.service`
- `ssh-tunnel-diagnosticar.service`

Todos siguen el mismo esquema:

- Unidad en `/etc/systemd/system/ssh-tunnel-<proyecto>.service`
- Usuario de ejecucion: `User=<usuario>`
- Conexion SSH con clave dedicada: `/home/<usuario>/.ssh/id_tunnel_nodo0`
- Opciones de resiliencia:
  - `ServerAliveInterval=60`
  - `ServerAliveCountMax=3`
  - `ExitOnForwardFailure=yes`
  - `Restart=always`

## 3) Seguridad y permisos del lado nodo0

Para que un tunel reverse funcione, deben estar habilitadas estas piezas en
`nodo0`:

1. `sshd` con forwarding habilitado
   - `AllowTcpForwarding yes`
   - `GatewayPorts clientspecified`
2. Restriccion por clave en `authorized_keys` del usuario remoto (`<usuario>`)
   - La clave usada por `brainy` tiene `permitlisten=...`
   - Solo los puertos listados ahi pueden abrirse con `-R`

Ejemplo real de restriccion por clave:

```text
permitlisten="127.0.0.1:18000",permitlisten="172.17.0.1:18010",permitlisten="172.17.0.1:18100",permitlisten="172.17.0.1:18120",no-pty,no-agent-forwarding,no-X11-forwarding ssh-ed25519 ... brainy_nodo0_tunnel_key
```

## 4) Comandos de administracion (operacion diaria)

En `brainy`:

```bash
sudo systemctl list-unit-files --type=service | grep -Ei 'ssh-tunnel|reverse|autossh'
sudo systemctl status ssh-tunnel-diagnosticar.service --no-pager
sudo systemctl cat ssh-tunnel-diagnosticar.service
sudo journalctl -u ssh-tunnel-diagnosticar.service -n 100 --no-pager
```

En `nodo0`:

```bash
ss -ltnH '( sport = :18100 or sport = :18120 )'
```

## 5) Como crear un tunel nuevo (paso a paso)

### Paso 1: elegir puertos remotos libres en nodo0

```bash
ssh <usuario>@<IP-DEL-SERVIDOR> "ss -ltnH '( sport = :<REMOTE_PORT_A> or sport = :<REMOTE_PORT_B> )' || true"
```

### Paso 2: habilitar esos puertos en authorized_keys (nodo0)

Agregar `permitlisten` para la misma clave `brainy_nodo0_tunnel_key`.

Si un puerto no esta en `permitlisten`, el tunel falla con:

```text
remote port forwarding failed for listen port <REMOTE_PORT>
```

### Paso 3: crear la unidad systemd en brainy

Plantilla:

```ini
# /etc/systemd/system/ssh-tunnel-<proyecto>.service
[Unit]
Description=SSH Reverse Tunnel for <proyecto> to Nodo0
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=<usuario>
WorkingDirectory=/ruta/del/proyecto
ExecStart=/usr/bin/ssh \
  -i /home/<usuario>/.ssh/id_tunnel_nodo0 \
  -N -T \
  -o IdentitiesOnly=yes \
  -o PreferredAuthentications=publickey \
  -o PasswordAuthentication=no \
  -o ServerAliveInterval=60 \
  -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=yes \
  -o StrictHostKeyChecking=accept-new \
  -R 172.17.0.1:<REMOTE_PORT_A>:127.0.0.1:<LOCAL_PORT_A> \
  -R 172.17.0.1:<REMOTE_PORT_B>:127.0.0.1:<LOCAL_PORT_B> \
  <usuario>@<IP-DEL-SERVIDOR>
Restart=always
RestartSec=10
TimeoutStartSec=30
TimeoutStopSec=10
PrivateTmp=yes
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
```

### Paso 4: activar y validar en brainy

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ssh-tunnel-<proyecto>.service
sudo systemctl status ssh-tunnel-<proyecto>.service --no-pager
sudo journalctl -u ssh-tunnel-<proyecto>.service -n 100 --no-pager
```

### Paso 5: validar escucha en nodo0

```bash
ss -ltnH '( sport = :<REMOTE_PORT_A> or sport = :<REMOTE_PORT_B> )'
```

### Paso 6: conectar Docker/Traefik al tunel

En el stack de `nodo0`, apuntar los bridges `socat` a
`host.docker.internal:<REMOTE_PORT>`.

Ejemplo:

```yaml
services:
  hpo-tunnel:
    command:
      - "TCP-LISTEN:8000,fork,reuseaddr"
      - "TCP:host.docker.internal:18100"
  genphenai-tunnel:
    command:
      - "TCP-LISTEN:18020,fork,reuseaddr"
      - "TCP:host.docker.internal:18120"
```

## 6) Troubleshooting rapido

1. `remote port forwarding failed for listen port ...`
   - Falta `permitlisten` en `~<usuario>/.ssh/authorized_keys`
   - El puerto remoto ya esta ocupado en `nodo0`

2. `Permission denied (publickey)`
   - Clave incorrecta o no autorizada para el usuario remoto
   - Revisar `-i /home/<usuario>/.ssh/id_tunnel_nodo0`

3. El servicio queda en `activating (auto-restart)` con `status=255`
   - Ver logs con `journalctl -u ...`
   - Casi siempre es problema de forwarding/puerto/permiso SSH

4. Funciona en host pero no desde contenedor
   - Verificar que el bridge de Docker use `host.docker.internal:<REMOTE_PORT>`
   - Verificar ruta y puertos en override de compose

## 7) Buenas practicas

- Un servicio systemd por proyecto (`ssh-tunnel-<proyecto>.service`)
- Nunca reutilizar puertos sin verificar colision
- Mantener `permitlisten` lo mas restringido posible
- Usar `ExitOnForwardFailure=yes` para fallar rapido y visible
- Documentar mapeo `REMOTE_PORT -> servicio` en el repo del proyecto
