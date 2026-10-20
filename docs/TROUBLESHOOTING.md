# Troubleshooting

## La web indica que no conecta con la API

Comprueba `http://localhost:3001/api/health`. En desarrollo deben estar activos ambos procesos de `npm run dev`. Revisa que los puertos 3001 y 5173 estén libres.

## Guardar o entregar devuelve 403 «Origin not allowed»

La API sólo acepta escrituras desde `localhost`, `127.0.0.1` o `[::1]`. Si la abres por otra dirección (IP de la red local o nombre de host tras cambiar `HOST`), añade esa URL exacta, con esquema y puerto, a `ALLOWED_ORIGINS`; admite varias separadas por comas. El arranque avisa si `HOST` no es loopback y la lista está vacía. No se confía en la cabecera `Host` para evitar ataques de DNS rebinding.

## Elasticsearch no sincroniza

Espera a que `http://localhost:9200/_cluster/health` responda. Usa `docker compose --profile siem ps` y confirma que el servicio está healthy. Repite `POST /api/elastic/sync`; la operación es idempotente.

## Kibana no muestra eventos

Sincroniza primero, importa `infra/kibana/soc-training.ndjson` y fija el rango temporal entre el 1 y el 10 de septiembre de 2026. Los escenarios usan timestamps fijos para ser reproducibles.

## npm bloquea scripts de esbuild

Algunas instalaciones endurecidas de npm requieren aprobar los scripts de instalación. Ejecuta `npm install-scripts approve esbuild` y vuelve a `npm install`.

## Reinicio de estado

Elimina `data/state.json` con la aplicación detenida. Los datasets se regeneran con `npm run generate`.

Si `state.json` está truncado, supera 1 MiB o contiene estados incompatibles, la API se negará a arrancar con `Cannot load lab state` en vez de borrar silenciosamente el progreso. Conserva el fichero para diagnóstico y restaura una copia válida; elimínalo sólo si deseas reiniciar deliberadamente el laboratorio.

## No se puede guardar: almacenamiento de 1 MiB

El servidor comprueba el tamaño UTF-8 antes de escribir y responde HTTP 507 si las notas y evaluaciones superarían el límite. El archivo anterior y el progreso ya guardado permanecen intactos. Reduce notas de otros casos desde la aplicación y vuelve a intentar el guardado; las respuestas pendientes permanecen en el formulario. El límite no se mide en caracteres, por lo que texto multibyte ocupa más espacio.

## Un caso antiguo está completado pero no tiene revisión

Las versiones anteriores sólo guardaban la marca de finalización, no las respuestas entregadas. Conservamos esas notas y estados, pero no inventamos una puntuación: vuelve a entregar el caso una vez para que la revisión completa quede guardada. Las evaluaciones nuevas se recuperan automáticamente al abrir el caso.
