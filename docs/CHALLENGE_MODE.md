# Challenge Mode y sesiones de entrenamiento

Challenge Mode agrupa investigaciones en intentos persistentes y reproducibles sin alterar los 30 escenarios canónicos ni las 9 plantillas procedurales. Cada intento tiene un ID nuevo; la combinación de `session:<seed>` y configuración produce siempre el mismo orden, origen, dificultad, plantilla privada, semilla interna y `planHash`.

## Modos

| Modo | Incidentes | Selección predeterminada |
|---|---:|---|
| Quick Challenge | 1 | Procedural, dificultad media |
| Training Session | 3 | Procedural, dificultad mixta determinista |
| SOC Shift | 5 | Procedural, progresión easy → medium → hard |
| Custom | 1–10 | Dificultad, origen, categorías, plantillas y balance TP/FP/mixto |

Custom rechaza configuraciones contradictorias: plantillas con origen sólo canónico, filtros avanzados fuera del modo Custom, counts fuera de rango, seeds fuera de `uint32` o el uso simultáneo de categorías y plantillas en una sesión sólo procedural. Cuando la seed se omite, el servidor genera una nueva y evita las 100 seeds recientes. Una seed explícita ignora el historial para conservar reproducibilidad exacta.

## Modelo y flujo

El documento `data/sessions.json` usa `schemaVersion: 1` y almacena:

- configuración y plan privado de cada incidente;
- seeds de sesión e incidente y hash del plan;
- estado `created`, `active` o `completed` y revisión optimista;
- timestamps de creación, inicio, primera interacción, entrega y cierre, siempre calculados por el servidor;
- notas, evidencias, acciones, decisión provisional y respuestas parciales;
- pistas solicitadas, puntuación bruta, penalización y resultado ajustado.

El flujo visible es `New → Investigating → Submitted → Review`. No es una máquina de estados general: sólo impide editar un incidente entregado, saltar uno pendiente o finalizar una sesión incompleta. Cada mutación exige la `revision` recibida; dos escrituras casi simultáneas no se pisan silenciosamente y la obsoleta recibe HTTP `409`.

Las escrituras usan un temporal y renombrado atómico, permisos restrictivos cuando el sistema los soporta, un límite de 20 MiB y un máximo de 1.000 sesiones. El arranque valida con Zod todo el documento y falla explícitamente ante JSON truncado o schema incompatible. `SESSION_STATE_FILE` permite cambiar la ruta.

## Frontera de información

Antes de la entrega el navegador recibe un ID opaco (`incident-01`), una descripción neutral, preguntas y eventos. No recibe:

- plantilla o escenario blueprint;
- categoría reveladora, veredicto esperado o clave de respuestas;
- IOC privados, MITRE, explicación, reasoning, consultas o acciones de solución;
- IDs internos codificados dentro de eventos.

Los campos y tags privados se filtran y `scenarioId` se sustituye por el ID opaco del incidente. Tras entregar, la revisión desbloquea feedback por pregunta, cronología real, IOC, MITRE, consultas y acciones. Como el laboratorio es local, el código fuente puede inspeccionarse; la frontera evita spoilers accidentales en el bundle o en la API previa, no pretende ser un sistema antifraude.

## Scoring, pistas y métricas

El scoring de preguntas existente se conserva como puntuación bruta. Hay tres pistas progresivas por incidente; cada una descuenta 3 puntos, hasta 9, sólo del resultado ajustado. Ambas cifras se muestran para que la penalización sea transparente.

El resumen de sesión calcula por separado precisión bruta/ajustada, precisión de veredicto, preguntas correctas, pistas, tiempo, balance TP/FP/mixto, categorías, MITRE y preguntas falladas. Estadísticas agrega investigaciones, tiempo medio y desgloses por dificultad, categoría, técnica y plantilla. Las recomendaciones son reglas deterministas basadas en el menor rendimiento observado; no usan LLM ni servicios externos.

Las repeticiones siempre crean otro intento:

- `exact`: misma seed y plan;
- `equivalent`: misma configuración con seed nueva;
- `template-new-seed`: mismas plantillas procedurales con variantes nuevas;
- `retry-failed`: sólo incidentes por debajo de 80, sin sobrescribir el original.

## API

| Método | Ruta | Uso |
|---|---|---|
| `POST` | `/api/sessions` | Crear sesión |
| `GET` | `/api/sessions/:id` | Recuperar estado público |
| `GET` | `/api/sessions/:id/incidents/:incidentId` | Abrir incidente o revisión |
| `POST` | `.../start` | Registrar inicio real |
| `PATCH` | `.../:incidentId` | Guardar progreso parcial |
| `POST` | `.../hints` | Solicitar la siguiente pista |
| `POST` | `.../submit` | Evaluar en servidor |
| `POST` | `/api/sessions/:id/finalize` | Cerrar una sesión completa |
| `POST` | `/api/sessions/:id/repeat` | Crear un nuevo intento relacionado |
| `GET` | `/api/sessions/history` | Historial local |
| `GET` | `/api/sessions/stats` | Estadísticas y recomendaciones |

Todos los cuerpos son Zod `strict`, el límite JSON global es 128 KiB y el servidor ignora ninguna puntuación o timestamp del cliente: los rechaza como claves desconocidas.

## Elasticsearch

La sincronización existente de los 2.951 eventos canónicos permanece en `soc-training-events`. Las sesiones Challenge no se publican automáticamente: hacerlo de forma segura requiere un ciclo de vida explícito por namespace, cleanup confirmado, cuotas y pruebas contra Elasticsearch real. La interfaz actual conserva eventos públicos ya saneados y IDs opacos, por lo que una fase posterior puede publicar `soc-training-session-<session>-<incident>` de forma idempotente sin copiar soluciones ni modificar el índice canónico. Esta separación es intencionada y evita dejar índices temporales sin control.

## Validación

`tests/challenge-sessions.test.ts` cubre modos, reproducción, filtros incompatibles, frontera privada, progreso, revisiones obsoletas, pistas, penalización, manipulación de score/timestamps, entrega incompleta, historial, estadísticas, reinicio, corrupción y repetición sin overwrite. La puerta completa sigue siendo:

```bash
npm run check
```
