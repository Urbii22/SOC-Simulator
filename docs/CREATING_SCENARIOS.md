# Crear un escenario

Añade un `CaseSpec` a `src/scenarios/definitions.ts` con identificador estable, contexto, usuario/host principal, IOC, MITRE, cuatro o más eventos correlacionados, consultas y respuesta.

Reglas prácticas:

- Usa dominios `.example` e IP reservadas para documentación cuando representen Internet.
- Incluye evidencia en al menos dos fuentes.
- Asegura que host, usuario, origen e IOC aparezcan literalmente en los eventos.
- No pongas la respuesta en el título o briefing.
- Mantén coherencia temporal y una acción de contención inicial inequívoca.

Después ejecuta:

```bash
npm run generate
npm test
npm run typecheck
npm run lint
```

Los tests parametrizados incluirán automáticamente la nueva definición; actualiza la aserción de cantidad y el catálogo si cambia el total.
