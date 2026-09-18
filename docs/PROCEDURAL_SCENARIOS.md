# Generación procedural

## Garantías y arquitectura

Los 30 escenarios canónicos siguen siendo el catálogo estable. La capa procedural se apoya en ellos como blueprints revisados, pero genera nuevas definiciones en memoria sin mutarlos ni guardar una copia por seed.

El flujo es:

1. `proceduralRequestSchema` valida template/modo aleatorio, seed, dificultad y parámetros acotados.
2. `SeededRng` deriva streams separados para identidades, hosts, red, ficheros, tiempo, ruido y detalles.
3. Una plantilla validada declara fases causales, dependencias, actores, infraestructura, fuentes, verdad, parámetros e investigación.
4. El motor reescribe de forma coherente la definición privada completa: eventos, preguntas, respuestas, referencias, IOC, queries y Sigma.
5. Se genera el dataset y se ejecuta `validateScenarioDetailed`, con schema, determinismo, timeline, semántica, IOC, MITRE, KQL/SPL, Sigma, spoilers y calidad.
6. Cualquier error aborta la generación. La API sólo proyecta campos aptos para el estudiante.

No se usa `Math.random()` para decisiones procedimentales. Fechas y timestamps se construyen con UTC; no se ordena por filesystem ni se usan comparaciones dependientes del locale. La seed admite enteros de `0` a `4294967295`.

## Plantillas disponibles

| ID | Patrón | Fases destacadas | Verdad base |
|---|---|---|---|
| `password-spray` | spray y acceso cloud | Credential Access → Initial Access | TP |
| `phishing` | entrega y payload | Initial Access → Execution | TP |
| `suspicious-powershell` | ejecución y salida | Execution → C2 | TP |
| `dns-beaconing` | proceso y cadencia DNS | Execution → C2 → Response | TP |
| `lateral-movement` | credenciales y WinRM | Credential Use → Lateral Movement → Discovery | TP |
| `persistence` | persistencia de endpoint | Execution → Persistence → C2 | TP |
| `webshell` | explotación y shell web | Initial Access → Persistence → Execution | TP |
| `multi-stage` | intrusión encadenada | Initial Access → Execution → Persistence → Discovery → C2 | TP |
| `ambiguous-admin` | cambio administrativo | Authorization → Remote Administration → Verification | FP |

La verdad no se sortea después de generar. Cada template parte de una cadena causal cuyo veredicto ya está definido. El modo aleatorio selecciona el template de forma determinista, pero antes de resolver sólo expone título, categoría, alertas e identidad genéricos; no devuelve `templateId`, respuesta, veredicto, MITRE ni IOC privados.

## Uso

```bash
npm run generate:scenario -- --list
npm run generate:scenario -- --template dns-beaconing --seed 12345
npm run generate:scenario -- --template webshell --seed 7 --difficulty hard --output output/webshell-7.json
npm run generate:scenario -- --random --seed 82913 --json
```

Identidades compartibles:

- template conocido: `dns-beaconing:12345:medium`;
- tipo oculto: `random:82913:hard`.

La API usa `POST /api/procedural/generate`:

```json
{ "template": "password-spray", "seed": 92817, "difficulty": "medium" }
```

Para random:

```json
{ "random": true, "seed": 82913, "difficulty": "hard" }
```

La respuesta contiene `variantId`, hash y la proyección pública del escenario. Sus endpoints normales (`detail`, `events`, `PATCH`, `submit`, `export`) aceptan después el `scenario.id` reproducible.

La API admite `parameters.noiseCount` entre 20 y 300 y `parameters.timelineScale` entre 0,5 y 2,5 con precisión máxima de tres decimales. Si se usan, ambos valores se codifican en `variantId` y `scenario.id`; por tanto la regeneración no depende del body original.

## Qué cambia por seed

- identidades humanas y de servicio, hosts y activos de apoyo;
- IP privadas y rangos de documentación `192.0.2.0/24`, `198.51.100.0/24` y `203.0.113.0/24`;
- dominios reservados `.example`, ficheros y procesos no esenciales para la técnica;
- fecha UTC, inicio, gaps, duración y cadencia;
- magnitudes como intentos, usuarios objetivo, bytes e intervalos;
- cantidad y distribución de ruido, fuentes y actividad contextual;
- IOC y valores concretos usados por respuestas, evidencias y consultas.

La cadena relevante conserva el orden. En `hard`, el motor añade fuentes correlacionadas, más actores/activos, IOC adicionales, más duración y ruido; no se limita a multiplicar eventos. Los eventos benignos cubren autenticación legítima, DNS/HTTP normal, procesos firmados, red, firewall, endpoint, correo, cloud, Linux y observaciones Suricata.

## Dificultad y límites

| Perfil | Ruido base | Fuentes objetivo | Actores/hosts adicionales | Correlación |
|---|---:|---:|---:|---|
| `easy` | 56 ± 8 | al menos 4 | 0 | cadena compacta |
| `medium` | 104 ± 8 | al menos 8 | 2 + 2 | más contexto y pivots |
| `hard` | 172 ± 8 | 12 | 4 + 4 | al menos 4 fuentes relevantes, IOC extra y falsos parecidos |

Límites de entrada: máximo 300 eventos de ruido, escala temporal entre `0.5` y `2.5`, máximo 320 eventos por variante y request JSON de 128 KiB. La caché en memoria está limitada a 32 entradas. No se usa Redis ni infraestructura adicional.

## Añadir una plantilla

1. Elige un escenario canónico con verdad, evidencias y queries ya validadas.
2. Añade un `TemplateSpec` a `src/procedural/templates.ts`.
3. Asigna cada índice de `attackEvents` exactamente a una fase; las fases se enlazan por `dependsOn`.
4. No implementes sustituciones específicas en la plantilla. Amplía pools o transformaciones comunes sólo si representan un patrón reusable.
5. Ejecuta `npm run validate:procedural`, la suite completa y el validador canónico estricto.

El schema formal exige MITRE, fuentes, actores, infraestructura, fases, restricciones, parámetros, ruido, verdad, preguntas, respuestas, evidencias, IOC, KQL/SPL y Sigma cuando existe. El builder copia estos elementos del blueprint en la plantilla y el motor los recalcula conjuntamente.

## Dogfooding y rendimiento

`npm run validate:procedural` prueba 12 seeds —incluidos `0`, `17`, `2147483647` y `4294967295`— en las tres dificultades para cada template: 324 variantes. Para cada una genera, valida, regenera, compara hash, puntúa la clave recalculada y comprueba findings bloqueantes y diversidad estructural.

Medición orientativa en el equipo de desarrollo: ~8 ms de media y p95 ~14 ms; datasets de ~50 KiB de media y ~83 KiB máximo. El pico de heap observado durante la batería fue ~79 MiB sobre el inicio. Son métricas de laboratorio, no SLA.

La seed `lateral-movement:17` descubrió durante dogfooding una colisión entre dos cuentas de servicio sintéticas. El asignador ahora reintenta por identidad sin perder el tipo de actor y esa seed permanece en tests y en la batería.

## Límites actuales

- Las nueve plantillas iniciales se basan en blueprints canónicos; todavía no existe un DSL independiente para construir una cadena completamente nueva sin escenario base.
- La API no mantiene un catálogo persistente de variantes creadas: se regeneran por ID y sólo el estado/notas usan el store local.
- Elasticsearch sincroniza el catálogo canónico en bloque. Una variante puede exportarse y estudiarse en la aplicación, pero no se añade automáticamente al bulk global.
- La dificultad es una aproximación controlada y validada, no una medición empírica del desempeño de estudiantes.
