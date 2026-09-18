# Guía del estudiante

1. Empieza por severidad, activo y usuario; no asumas que la alerta es correcta.
2. En **Resumen**, formula una hipótesis y registra pivotes en notas.
3. En **Evidencias**, busca primero por host, usuario o IP. Correlaciona fuentes y timestamps.
4. Identifica el primer cambio respecto a la actividad normal y sigue la causalidad.
5. Completa **Investigación**. La contención debe ser concreta, segura y proporcional.
6. Tras entregar, compara tu razonamiento con la cronología, IOC, KQL, SPL y Sigma.

Orden sugerido: SSH brute force → password spraying → credential stuffing → PowerShell → phishing → escalada → DNS tunneling → beaconing → webshell → exfiltración.

No inspecciones `src/scenarios/definitions.ts` durante el ejercicio: contiene la clave del instructor.
