# Cómo llama a Claude el extractor de la copia en AWS

Decisión del 2026-10-02. Registra qué se decidió, por qué, qué se descartó y qué
riesgos se aceptaron. La configuración está en `infra/cloud/` (ajuste
`recognizer_provider` de `stack_settings`); cómo cargar el token, en
`infra/cloud/README.md`. Desde el 2026-10-04 la copia corre sobre ese esquema,
independiente del proveedor (`docs/CLOUD_CAMBIOS.md`).

## La decisión

**La copia en AWS usa la suscripción de Claude de Mate, igual que staging, con los
mismos límites.** El extractor llama a Claude a través del CLI `claude` con un
token de suscripción (`claude setup-token`), no con una API key.

| Límite | Staging (nodo0) | Copia AWS |
|---|---|---|
| Por cuenta | 20 por hora, 60 por día | 20 por hora, 60 por día |
| Todo el sitio | 40 cada 5 horas | 40 cada 5 horas |
| Semana | 1.344 (el mismo ritmo de 40 cada 5 horas, sin tope propio) | 1.344 |
| Concurrencia | 2 a la vez | 2 a la vez |

## Cómo se llegó

1. **Septiembre: la guía de la nube pedía una API key de la organización**
   (`docs/CLOUD_DEPLOY.md`), con un presupuesto en dólares. El motivo: una copia
   que manejan otras personas no debería depender de una credencial personal, y
   una API key se puede limitar por gasto en la consola de Anthropic.
2. **La copia se armó así** (`infra/aws/`, PR #74): `RECOGNIZER_PROVIDER=anthropic`,
   la key en SSM, y un techo semanal de US$20 (unas 10 extracciones por semana,
   contando ~US$1,90 la más cara). La key nunca llegó: la web andaba, pero la
   extracción desde texto respondía «no disponible».
3. **El 2026-10-02 Mate decidió hacer lo mismo que en staging.** Las razones:
   - **Sin facturación aparte:** nadie tiene que sacar ni pagar una cuenta de
     organización para una copia de prueba.
   - **Ya está probado en staging:** el mismo extractor, la misma imagen y el
     mismo camino (CLI + token) corren ahí desde v0.9.1, con los límites que Mate
     fijó el 2026-09-28 (40 cada 5 horas; si choca con su deseo de no pasar el
     15% de la suscripción, gana el 40).
   - **El mismo modelo:** `claude-opus-5`, como staging, así que lo que se
     evalúe en una copia vale para la otra.
4. **Se dejó la otra opción a mano:** `recognizer_provider = "anthropic"` en
   `stack_settings` vuelve a la API key con su presupuesto, sin tocar código.

## Riesgos aceptados

- **Un token personal en una máquina de otra persona.** El token queda en la
  máquina, en `/etc/diagnosticar/secrets.env` (modo 600, solo root). No está en
  git, ni en el estado de Terraform, ni en GitHub, ni en los logs: la herramienta
  de la máquina solo imprime nombres de variables, y GitHub no tiene ningún acceso
  a la máquina (el deploy es *pull*). Pero **quien tenga root en la máquina puede
  leerlo**: quien tenga la clave SSH de administración o acceso de administrador
  a la cuenta del proveedor. Hoy eso es Gonzalo.
- **La cuota se comparte.** Staging y AWS llevan cada uno su propio contador, así
  que juntos pueden hacer **hasta 80 extracciones cada 5 horas** sobre la misma
  suscripción, además del uso propio de Mate con Claude. Si eso aprieta, bajar
  `global_extractions_per_5h` en `stack_settings` (por ejemplo a 20 en cada
  copia) en vez de compartir un contador entre máquinas.
- **El uso de la suscripción.** Una suscripción de Claude está pensada para uso
  personal; usarla detrás de un sitio web es una decisión de Mate, ya tomada para
  staging. Para producción, con familias reales, el camino sigue siendo una API key
  de la organización.
- **Memoria.** Cada extracción corre un proceso `claude`; con dos a la vez el
  extractor puede acercarse a su techo de 1 GB en la `t3.small`. Si
  `scripts/remote.sh stats` muestra poco margen, ver «Memoria» en
  `infra/aws/README.md`.

## Qué hacer si el token se filtra o hay que cambiarlo

1. Desde la cuenta de Mate, revocar el token viejo y generar uno nuevo con
   `claude setup-token`.
2. Cargarlo sin que pase por la pantalla, con el puerto 22 abierto
   (`infra/cloud/scripts/remote.sh open`):
   `infra/cloud/scripts/remote.sh set-secret CLAUDE_CODE_OAUTH_TOKEN < archivo-con-el-token`.
   El extractor se reinicia solo con el token nuevo.
3. `infra/cloud/scripts/remote.sh close`.
4. Si el mismo token se usaba en staging, cambiarlo también en `.env.staging` de
   nodo0 (`STAGING_CLAUDE_CODE_OAUTH_TOKEN`; ver `STAGING.md`).
