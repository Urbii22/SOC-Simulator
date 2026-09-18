# Troubleshooting

## La web indica que no conecta con la API

Comprueba `http://localhost:3001/api/health`. En desarrollo deben estar activos ambos procesos de `npm run dev`. Revisa que los puertos 3001 y 5173 estén libres.

## Elasticsearch no sincroniza

Espera a que `http://localhost:9200/_cluster/health` responda. Usa `docker compose --profile siem ps` y confirma que el servicio está healthy. Repite `POST /api/elastic/sync`; la operación es idempotente.

## Kibana no muestra eventos

Sincroniza primero, importa `infra/kibana/soc-training.ndjson` y fija el rango temporal entre el 1 y el 10 de septiembre de 2026. Los escenarios usan timestamps fijos para ser reproducibles.

## npm bloquea scripts de esbuild

Algunas instalaciones endurecidas de npm requieren aprobar los scripts de instalación. Ejecuta `npm install-scripts approve esbuild` y vuelve a `npm install`.

## Reinicio de estado

Elimina `data/state.json` con la aplicación detenida. Los datasets se regeneran con `npm run generate`.

Si `state.json` está truncado, supera 1 MiB o contiene estados incompatibles, la API se negará a arrancar con `Cannot load lab state` en vez de borrar silenciosamente el progreso. Conserva el fichero para diagnóstico y restaura una copia válida; elimínalo sólo si deseas reiniciar deliberadamente el laboratorio.
