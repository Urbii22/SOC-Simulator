# Guía del instructor

Los casos originales conservan su esquema de seis preguntas y los nuevos usan ocho preguntas encadenadas. Todos suman 100 puntos. Un 80% suele indicar dominio operativo; para resultados inferiores, pide al estudiante justificar qué evidencia confirmó o descartó cada hipótesis.

La secuencia 11–15 introduce pivotes directos; 16–22 fuerza correlación multifuente; 23–27 evalúa cadenas y alcance; 28–30 introduce falsos positivos, contexto de negocio e incidentes mixtos. No reveles de antemano qué casos terminan como TP, FP o mixtos.

En la corrección manual valora:

- timeline causal, no sólo coincidencia de IOC;
- separación entre alcance confirmado e inferido;
- correspondencia entre eventos y técnicas MITRE;
- contención reversible y remediación sostenible;
- tratamiento explícito del ruido y de explicaciones legítimas.

Para reiniciar el progreso local, detén la aplicación y elimina sólo `data/state.json`. En Docker, elimina únicamente el volumen de estado del laboratorio si necesitas un reinicio total.

Las soluciones permanecen en el servidor y no llegan al navegador antes de entregar. Esto evita exposición accidental en el bundle, pero no impide que alguien con acceso al repositorio lea las definiciones. Para sesiones evaluadas, distribuye el build y conserva el código fuente. El servicio no tiene autenticación multiusuario y no debe exponerse a Internet.

Antes de impartir o modificar una sesión, ejecuta `npm run validate:scenarios`. Usa `--scenario <id> --verbose` para revisar métricas y `--strict` cuando quieras tratar riesgos de calidad como bloqueantes. Un warning no es una solución automática: documenta por qué se acepta o corrige el caso. Consulta [Motor de validación](VALIDATION.md).
