# Crear un escenario

Los diez casos heredados usan `CaseSpec` en `src/scenarios/definitions.ts`. Los casos ampliados usan `ExpandedSpec` y `makeScenario` en `src/scenarios/expanded/`, que generan ocho preguntas, respuestas privadas y una regla Sigma opcional. Ambos producen un `ScenarioDraft`; `finalizeScenario` completa metadata, fuentes y evidencia explícita sin cambiar el formato público.

Una definición debe aportar contexto de negocio, dificultad, categoría, usuarios, hosts, alertas, veredicto esperado, fuentes de ruido, timeline relevante, IOC, MITRE, preguntas demostrables, KQL/SPL, contención y remediación. `noiseCount` controla el volumen reproducible y `noiseSources` limita las plantillas benignas.

Reglas prácticas:

- usa dominios `.example` e IP de documentación para representar Internet;
- incluye comportamiento normal y al menos dos fuentes; cuatro o más en casos avanzados;
- respalda cada IOC, respuesta y técnica MITRE con eventos concretos;
- enlaza cada respuesta a `eventRefs`, `fields` y, si aplica, `iocValues`; las referencias usan `<scenario-id>:timeline:<posición>`;
- consulta sólo campos del contrato (`host`, `user`, `sourceIp`, `destinationIp`, `eventCode`, `action`, `outcome`, `message`, `details.*`);
- no pongas respuestas, etiquetas privadas ni conclusiones en título, briefing o API pública;
- separa contención inmediata de remediación y hunting posterior;
- omite Sigma cuando la actividad no encaje en una regla de eventos razonable.

Después ejecuta:

```bash
npm run validate:scenarios
npm run validate:scenarios -- --scenario <id> --verbose
npm run generate
npm run generate:coverage
npm run check
```

Antes de aceptar el caso, añade un test negativo para cualquier regla nueva y comprueba que la respuesta no se deduce del briefing o de una sola cadena. Los tests parametrizados cubren automáticamente cada definición y la matriz se deriva del catálogo; no se edita a mano. Las reglas y severidades están documentadas en [Motor de validación](VALIDATION.md).
