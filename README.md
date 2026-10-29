# diagnostic.ar

diagnostic.ar es una página web para orientar el diagnóstico de enfermedades poco
frecuentes. Contás los síntomas del paciente con tus palabras y el sistema te
devuelve los genes más probables, qué especialidad conviene consultar y algunas
preguntas para afinar el cuadro. No reemplaza a un médico.

Es el Trabajo Profesional de Ingeniería en Informática (FIUBA) de Mateo Alvarez,
Mariano Brizuela López, Gonzalo Bustamante y Lucía Lourengo Caridade, dirigido
por el Ing. Damián Martinelli.

Está en línea en https://diagnosticar.infra.cluster.qb.fcen.uba.ar y hay una
copia en https://diagnosticar.app.

## Sobre esta copia

Esta es una copia pública de nuestro repositorio de trabajo. Tiene todos los
commits y todas las versiones, pero por seguridad sacamos los datos del servidor
de la facultad donde corre el sistema (direcciones, usuarios y accesos). Los
pull requests quedaron en el repositorio original, que es privado.

## Qué hay acá

Este repositorio tiene la web (Next.js), el backend (Node.js) y todo lo
necesario para publicar y desplegar el sistema. Las otras piezas viven en sus
propios repositorios:

- [diagnostic.ar-api](https://github.com/MateAlv/diagnostic.ar-api) y [spanish-symptoms-recognizer](https://github.com/GMBUST-FIUBA/spanish-symptoms-recognizer): pasan los síntomas del texto a términos médicos.
- [diagnostic.ar-model](https://github.com/MateAlv/diagnostic.ar-model) y [diagnostic.ar-training](https://github.com/MateAlv/diagnostic.ar-training): el modelo que ordena los genes y cómo lo entrenamos.
- [diagnosticar-question-agent](https://github.com/MarBL00126/diagnosticar-question-agent): las preguntas de seguimiento.
- [diagnostic.ar-gene-profiles](https://github.com/MateAlv/diagnostic.ar-gene-profiles): la información de cada gen.

## Probarlo en tu máquina

```bash
cd frontend && npm install
npm run dev:mock
```

Abrí http://localhost:3000 y entrá con cualquier email y una contraseña de 8
caracteres. No hace falta base de datos ni GPU. Para levantar todo, mirá
[CONTRIBUTING.md](CONTRIBUTING.md).

## Licencia

GPL-3.0.
