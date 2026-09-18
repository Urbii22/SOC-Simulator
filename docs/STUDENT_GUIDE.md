# Guía del estudiante

## Flujo de investigación

1. Lee el contexto de negocio y formula una hipótesis sin asumir que la alerta es correcta.
2. Establece el comportamiento normal del usuario y el activo antes de la ventana sospechosa.
3. Construye una timeline y pivota por identidad, host, sesión, proceso, IP y destino.
4. Separa hechos demostrados, hipótesis e indicadores. Un IOC aislado no prueba un incidente.
5. Determina alcance: activos, cuentas, credenciales, persistencia, movimiento lateral y salida de datos.
6. Clasifica cada alerta como verdadera, falsa o parte de un incidente mixto; asigna severidad según impacto.
7. Propón primero una contención reversible y proporcional; después, remediación y hunting adicional.
8. Entrega la investigación y compara tu razonamiento con timeline, MITRE, KQL, SPL y Sigma.

## Progresión recomendada

- **Fundamentos:** 1, 2 y 11–15. Practica autenticación, procesos, descargas y persistencia sencilla.
- **Correlación:** 3–5, 9 y 16–22. Exige combinar dos o más fuentes y distinguir baseline de señal.
- **Multi-stage:** 6–8, 10 y 23–27. Reconstruye cadenas, alcance y respuesta coordinada.
- **Triage ambiguo:** 28–30. Valida cambios, falsos positivos y alertas relacionadas sin sobrerreaccionar.

Usa las notas para registrar timestamps y pivotes. Evita inspeccionar `src/scenarios/` durante el ejercicio: contiene las claves privadas del instructor.
