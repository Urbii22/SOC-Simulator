# Crear un escenario

Los diez casos heredados usan `CaseSpec` en `src/scenarios/definitions.ts`. Los casos ampliados usan `ExpandedSpec` y `makeScenario` en `src/scenarios/expanded/`, que generan ocho preguntas, respuestas privadas y una regla Sigma opcional.

Una definición debe aportar contexto de negocio, dificultad, categoría, usuarios, hosts, alertas, veredicto esperado, fuentes de ruido, timeline relevante, IOC, MITRE, preguntas demostrables, KQL/SPL, contención y remediación. `noiseCount` controla el volumen reproducible y `noiseSources` limita las plantillas benignas.

Reglas prácticas:

- usa dominios `.example` e IP de documentación para representar Internet;
- incluye comportamiento normal y al menos dos fuentes; cuatro o más en casos avanzados;
- respalda cada IOC, respuesta y técnica MITRE con eventos concretos;
- consulta sólo campos del contrato (`host`, `user`, `sourceIp`, `destinationIp`, `eventCode`, `action`, `outcome`, `message`, `details.*`);
- no pongas respuestas, etiquetas privadas ni conclusiones en título, briefing o API pública;
- separa contención inmediata de remediación y hunting posterior;
- omite Sigma cuando la actividad no encaje en una regla de eventos razonable.

Después ejecuta:

```bash
npm run validate:scenarios
npm run generate
npm run check
```

Los tests parametrizados cubren automáticamente cada definición. Si cambia el total, actualiza además el catálogo, la matriz de cobertura y la aserción explícita de cantidad.
