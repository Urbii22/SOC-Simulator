# Motor de validación de escenarios

El catálogo se valida antes de generar datasets, construir la aplicación o publicar cambios. El motor trata cada escenario como una unidad verificable: definición privada, dataset generado, timeline, preguntas, evidencias, consultas y contenido expuesto al alumno.

## Niveles de hallazgo

- `ERROR`: contrato roto, evidencia no demostrable o incoherencia que invalida el ejercicio. El comando termina con código `1`.
- `WARNING`: riesgo de calidad que requiere revisión humana, pero no implica por sí solo que el escenario sea incorrecto. Sólo bloquea con `--strict`.
- `INFO`: observación transparente, por ejemplo un IOC sin aparición benigna similar o una identidad técnica fuera del alcance declarado.

El modo normal bloquea únicamente errores. El modo estricto también bloquea warnings, lo que permite adoptar gradualmente heurísticas nuevas sin ocultarlas ni convertirlas en falsos errores.

## Arquitectura

1. `schema.ts` aplica un contrato Zod estricto a definiciones y eventos: tipos, enums, campos obligatorios, formatos, colecciones no vacías y rechazo de claves desconocidas.
2. `finalize.ts` normaliza las definiciones heredadas, asigna metadata reproducible, fuentes declaradas y referencias estables de evidencia.
3. `validation.ts` ejecuta reglas independientes sobre una única generación del dataset y agrega hallazgos y métricas.
4. `cli.ts` filtra escenarios, presenta resultados para personas o emite JSON estable para CI.
5. `coverage.ts` deriva la matriz global del mismo catálogo y del mismo informe de validación.

Las reglas no acceden a la UI ni a estado persistente. Reciben un `ValidationContext` inmutable con escenario, eventos, timeline reconstruida, campos disponibles y texto indexable. Para añadir una regla, implementa `ValidationRule`, asigna un identificador estable y añádela a `rules()`; acompáñala de al menos un test negativo que demuestre que falla por la causa esperada.

## Reglas automáticas

| Regla | Qué comprueba |
|---|---|
| `schema` | Estructura estricta de escenario/evento, tipos, enums, fechas ISO, IDs, preguntas, respuestas y metadata. |
| `determinism` | Tres generaciones iguales con la misma seed y variación de ruido con otra seed. |
| `timeline` | Orden estricto, offsets no ambiguos, rango temporal, reconstrucción exacta y relaciones causales conocidas (tareas, servicios, autenticación, movimiento y exfiltración). |
| `semantics` | Fuentes, hosts, usuarios, duplicados, veredicto, correlación, preguntas, respuestas, puntos y presencia de campos en la evidencia realmente referenciada. |
| `ioc` | Duplicados, formato por tipo y presencia tanto en evidencia visible como en la timeline relevante. |
| `mitre` | Formato, catálogo local, nombre/táctica exactos y soporte por pistas observables. |
| `queries` | Campos disponibles, duplicados, fuentes declaradas, literales alcanzables y ejecución local de conjunciones simples KQL/SPL. |
| `sigma` | YAML real, claves mínimas, selectores, modificadores soportados, campos y evaluación booleana local de la condición sobre eventos generados. |
| `spoilers` | Etiquetas privadas, términos de solución y respuestas literales filtradas en contexto público. Los tests de API inspeccionan recursivamente lista, detalle, eventos y NDJSON. |
| `quality` | Ratio de ruido, diversidad multifuente, concentración de respuestas en un evento e IOC sin lookalikes benignos. |
| `coverage` | IDs duplicados, fuentes infrautilizadas, técnicas sobrerrepresentadas y escenarios excesivamente similares. |

Las comprobaciones KQL/SPL y Sigma son validadores locales deliberadamente acotados, no sustitutos de Sentinel, Splunk o un compilador Sigma completo. Garantizan coherencia con el contrato y alcanzabilidad de la evidencia; las consultas complejas todavía requieren revisión humana en el SIEM de destino.

## CLI

```bash
npm run validate:scenarios
npm run validate:scenarios -- --scenario suspicious-smb
npm run validate:scenarios -- --scenario mixed-alert-incident --verbose
npm run validate:scenarios -- --strict
npm run validate:scenarios -- --json
```

Opciones:

- `--scenario <id>` valida un único caso;
- `--strict` convierte warnings en fallo de proceso;
- `--json` emite `summary`, métricas/checks por escenario y hallazgos estructurados;
- `--verbose` incluye observaciones `INFO` y métricas en salida humana.

Códigos de salida: `0` sin hallazgos bloqueantes, `1` validación fallida y `2` argumentos inválidos o escenario inexistente.

Para obtener JSON puro en CI sin prefijos del gestor de paquetes:

```bash
./node_modules/.bin/tsx scripts/validate-scenarios.ts --json > scenario-validation.json
```

El workflow del repositorio ejecuta la puerta completa, conserva ese informe como artefacto y regenera datasets y matriz para detectar archivos desactualizados.

## Métricas

Cada resultado informa eventos totales/relevantes/ruido, ratio de ruido, fuentes totales y relevantes, hosts, usuarios, IOC, técnicas, duración, preguntas, referencias de evidencia, fuentes que sustentan respuestas y tipo de correlación. Son señales de revisión, no objetivos que deban maximizarse artificialmente.

La matriz de cobertura se regenera con:

```bash
npm run generate:coverage
```

No edites `docs/COVERAGE_MATRIX.md` manualmente.

## Estado estricto del catálogo

El catálogo actual no contiene warnings y pasa `--strict`. Los escenarios Advanced heredados `dns-tunneling`, `malware-beaconing` y `webshell` incluyen ahora cuatro fuentes relevantes con señales de endpoint, firewall o red que complementan —sin duplicar— la evidencia original.
