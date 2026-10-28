# Búsqueda SPL

La pestaña **Evidencias** de cada caso, y la de Challenge, es una consola de búsqueda al estilo Splunk. Admite un subconjunto del lenguaje SPL y lo ejecuta en el navegador sobre los eventos del caso abierto. No hace falta Splunk ni Docker. El motor está en `src/spl/` y no depende de React, así que también lo usan los tests.

- **Intro** ejecuta la búsqueda y **Mayús+Intro** añade una línea.
- Si la búsqueda está vacía, equivale a `index=soc`: se muestran todos los eventos, del más reciente al más antiguo, como en Splunk.
- Mientras la búsqueda solo filtra o enriquece, verás **eventos**, con una barra de campos a la izquierda. Al hacer clic en un valor, se añade `campo="valor"` a la búsqueda; el botón `≠` lo excluye. Cuando aparece un comando transformador (`stats`, `chart`, `timechart`, `top`, `rare`, `table`), verás una **tabla de estadísticas**.
- Las horas se muestran en UTC.
- La búsqueda escrita se conserva por caso, también tras recargar. El historial de las últimas 15 búsquedas se guarda en este navegador.
- Al entregar un caso, las consultas SPL de referencia de la revisión tienen un botón **Ejecutar**.

## Campos

Cada evento se convierte en un resultado con:

| Campo | Contenido |
| --- | --- |
| `_time` | Hora del evento en segundos epoch (se muestra formateada) |
| `_raw` | El evento completo en JSON, como se ingiere un NDJSON |
| `index` | Siempre `soc` |
| `sourcetype` | Igual que `source` (`auth`, `sysmon`, `dns`…) |
| `host`, `user`, `sourceIp`, `destinationIp`, `eventCode`, `action`, `outcome`, `message`, `timestamp`, `tags` | Campos del evento; `tags` es multivalor |
| `details.*` | Detalles específicos de cada fuente (`details.process`, `details.domain`…) |

Los campos de `details` también se pueden escribir sin el prefijo: `process=powershell.exe` equivale a `details.process=powershell.exe`.

## Búsqueda (antes del primer `|`)

| Sintaxis | Significado |
| --- | --- |
| `campo=valor` | Igualdad sin distinguir mayúsculas; numérica si ambos lados son números |
| `campo="*texto*"` | Comodines con `*` |
| `campo!=valor` | Distinto; solo devuelve eventos que **tienen** el campo |
| `NOT campo=valor` | Incluye también los eventos sin el campo |
| `campo>5`, `<`, `>=`, `<=` | Comparaciones |
| `campo IN (a, "b c", 4624)` | Lista de valores |
| `a OR b`, `a AND b`, `NOT a`, `( … )` | Booleanos, en mayúsculas. `AND` está implícito entre términos |
| `powershell`, `"frase exacta"`, `power*` | Texto libre sobre `_raw`, por términos completos: `power` no encuentra `powershell` |

Como en Splunk, `OR` se evalúa antes que el `AND` implícito: `index=soc user=ana OR user=luis` significa `index=soc AND (user=ana OR user=luis)`.

## Comandos

| Comando | Ejemplo |
| --- | --- |
| `search` | `… \| search outcome=failure` |
| `where` | `… \| where count > 5 AND like(user, "svc%")` |
| `eval` | `… \| eval hora=strftime(_time, "%H:%M"), kb=round(bytes/1024, 1)` |
| `stats` | `… \| stats count dc(user) as usuarios values(action) by sourceIp` |
| `eventstats` | `… \| eventstats count as total by user` |
| `streamstats` | `… \| sort _time \| streamstats current=f last(_time) as previo by host` |
| `table`, `fields` | `… \| table _time host user`, `… \| fields - _raw` (admiten `details.*`) |
| `rename` | `… \| rename sourceIp as origen, details.* as *` |
| `sort` | `… \| sort - count, user` (`sort 0 …` sin límite) |
| `head`, `tail`, `reverse` | `… \| head 20` |
| `dedup` | `… \| dedup user host` |
| `top`, `rare` | `… \| top limit=5 host by source` |
| `rex` | `… \| rex field=message "from (?<ip>\d+\.\d+\.\d+\.\d+)"` |
| `regex` | `… \| regex message!="(?i)backup"` |
| `bin` / `bucket` | `… \| bin _time span=5m \| stats count by _time` |
| `timechart` | `… \| timechart span=10m count by source limit=5` |
| `chart` | `… \| chart count over host by outcome` |
| `transaction` | `… \| transaction user maxspan=30m maxpause=5m` (añade `duration` y `eventcount`) |
| `fillnull` | `… \| fillnull value=N/A user` |
| `mvexpand` | `… \| mvexpand tags` |

**Agregaciones:** `count`, `count(campo)`, `dc`, `values`, `list`, `min`, `max`, `avg`, `sum`, `range`, `median`, `stdev`, `var`, `mode`, `perc95`/`p95`, `first`, `last`, `earliest`, `latest`, `earliest_time` y `latest_time`.

**Funciones de `eval`/`where`:** `if`, `case`, `coalesce`, `nullif`, `isnull`, `isnotnull`, `isnum`, `isstr`, `typeof`, `in`, `like`, `match`, `cidrmatch`, `len`, `lower`, `upper`, `trim`, `ltrim`, `rtrim`, `substr`, `replace`, `split`, `urldecode`, `tostring` (`"hex"`, `"commas"`, `"duration"`), `tonumber`, `abs`, `ceil`, `floor`, `round`, `sqrt`, `pow`, `exp`, `ln`, `log`, `min`, `max`, `mvcount`, `mvindex`, `mvjoin`, `mvappend`, `mvdedup`, `mvsort`, `now`, `time`, `strftime` y `strptime`. Operadores: `+ - * / %`, `.` (concatenación), `= == != < <= > >=`, `LIKE`, `IN`, `AND`, `OR`, `XOR` y `NOT`.

## Diferencias con Splunk

- Un nombre de campo con punto (`details.uri`) se escribe tal cual en `eval` y `where`; para concatenar con `.`, deja espacios: `a . b`. Los nombres de campo entre comillas simples (`'mi campo'`) también funcionan.
- En `where`/`eval`, una palabra sin comillas es un **campo**: `where user=root` compara con un campo llamado `root`. La consola avisa cuando ese campo no existe.
- No hay `earliest`/`latest` en la búsqueda: el dataset ya está acotado al incidente. Para filtrar por hora, usa `where _time >= strptime("2026-09-01 08:30", "%Y-%m-%d %H:%M")`.
- `join`, `append`, `lookup`, `inputlookup`, `spath`, `iplocation`, `tstats`, `makeresults` y similares no están soportados; la consola lo indica con un error claro. Los comandos desconocidos muestran la lista de comandos disponibles.
- No hay subbúsquedas (`[ … ]`), macros ni `count(eval(…))`.

## Para autores de escenarios

`tests/spl.test.ts` ejecuta todas las consultas `queries.spl` del catálogo y de las variantes procedurales con este motor, y falla si alguna da error, genera un aviso o no devuelve resultados. Una consulta SPL nueva tiene que funcionar en la consola.
