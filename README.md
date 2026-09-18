# SOC Analyst Training Lab

Laboratorio local, seguro y reproducible para practicar triage, investigación y respuesta a incidentes con telemetría sintética. Incluye una consola SOC web, 30 escenarios completos, evaluación automática, datasets NDJSON y un entorno opcional Elasticsearch/Kibana.

> Todo el contenido es sintético. El proyecto no ejecuta malware, no genera tráfico ofensivo y no se conecta a objetivos externos.

## Qué incluye

- 30 escenarios progresivos: fundamentos, correlación multifuente, cadenas multi-stage y triage ambiguo.
- 2.946 eventos reproducibles con ruido benigno y 12 fuentes: Windows, Sysmon, Linux, DNS, HTTP, autenticación, red, Suricata, firewall, endpoint, correo y cloud.
- Flujo de analista: cola, severidad, estados, evidencias, notas, preguntas y resolución explicada.
- Referencias KQL, SPL y Sigma por escenario.
- API validada, persistencia local y exportación NDJSON.
- Elasticsearch/Kibana opcionales mediante Docker Compose.
- Tests unitarios, de API, componentes, reproducibilidad, IOC y capacidad de respuesta.

## Inicio rápido

Requisitos: Node.js 22+ y npm 10+.

```bash
npm install
npm run dev
```

Abre [http://localhost:5173](http://localhost:5173). La API escucha en `http://localhost:3001`.

Para construir y ejecutar como producción:

```bash
npm run build
npm start
```

Abre [http://localhost:3001](http://localhost:3001).

## Docker

Modo ligero, sólo aplicación:

```bash
docker compose up --build
```

Modo SIEM completo (recomendados 4 GB de RAM libres):

```bash
docker compose --profile siem up --build
```

Cuando Elasticsearch esté disponible, indexa los 2.946 eventos:

```bash
curl -X POST http://localhost:3001/api/elastic/sync
```

En PowerShell:

```powershell
Invoke-RestMethod -Method Post http://localhost:3001/api/elastic/sync
```

Kibana queda en [http://localhost:5601](http://localhost:5601). Importa `infra/kibana/soc-training.ndjson` desde **Stack Management → Saved Objects → Import**. El fichero crea el data view, una búsqueda de señales y el dashboard Watchfloor.

## Comandos

| Comando | Uso |
|---|---|
| `npm run dev` | API y web con recarga |
| `npm run generate` | Genera un NDJSON por escenario en `datasets/` |
| `npm run validate:scenarios` | Valida determinismo, evidencias, IOC, MITRE, consultas y coherencia |
| `npm test` | Ejecuta la suite de pruebas |
| `npm run typecheck` | TypeScript estricto en cliente y servidor |
| `npm run lint` | ESLint |
| `npm run build` | Build cliente + servidor |
| `npm run check` | Todas las verificaciones |

## Arquitectura

```mermaid
flowchart LR
  Student[Analista junior] --> UI[Consola React]
  UI --> API[API Express]
  API --> Engine[Motor de escenarios]
  Engine --> Definitions[Definiciones privadas]
  Engine --> Events[Eventos reproducibles]
  API --> State[(Estado y notas)]
  API -->|bulk opcional| ES[(Elasticsearch)]
  ES --> Kibana[Kibana]
  Events --> NDJSON[Export NDJSON]
```

El navegador recibe metadatos, preguntas y evidencias, pero no claves de respuesta. El servidor desbloquea solución, cronología, IOC y consultas después de la entrega. En un proyecto local el código fuente siempre puede inspeccionarse; esta separación evita que la solución aparezca en el bundle o en peticiones previas a la evaluación, no pretende ser un control antifraude.

## Estructura

```text
src/client/       consola React y componentes
src/domain/       contratos compartidos
src/scenarios/    definiciones y generador determinista
src/server/       API, persistencia e integración Elastic
scripts/          generación offline de datasets
tests/            unit, API y componentes
infra/kibana/     objetos guardados para importar
docs/             guías de estudiante, instructor y extensión
```

## API principal

- `GET /api/health`
- `GET /api/scenarios`
- `GET /api/scenarios/:id`
- `GET /api/scenarios/:id/events?q=...`
- `PATCH /api/scenarios/:id`
- `POST /api/scenarios/:id/submit`
- `GET /api/scenarios/:id/export`
- `POST /api/elastic/sync`

Los cuerpos de escritura se validan con Zod y tienen límites de tamaño. La API desactiva la cabecera de tecnología y no expone respuestas antes de evaluar.

## Documentación

- [Arquitectura](docs/ARCHITECTURE.md)
- [Guía del estudiante](docs/STUDENT_GUIDE.md)
- [Guía del instructor](docs/INSTRUCTOR_GUIDE.md)
- [Crear escenarios](docs/CREATING_SCENARIOS.md)
- [Catálogo de escenarios](docs/SCENARIOS.md)
- [Matriz de cobertura](docs/COVERAGE_MATRIX.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## Seguridad y alcance

Las IP públicas usadas pertenecen a rangos de documentación o se tratan como IOC sintéticos. Los dominios terminan en `.example`. No uses este laboratorio como sistema de producción ni expongas Elasticsearch sin autenticación; `xpack.security.enabled=false` existe únicamente para la red Docker local de entrenamiento.

## Licencia

MIT. Consulta [LICENSE](LICENSE).
