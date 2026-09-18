# Guía del instructor

Cada caso vale 100 puntos: host 20, usuario 15, origen 15, MITRE 20, veredicto 15 y contención 15. Un 80% indica dominio suficiente; por debajo, pide al estudiante explicar qué evidencia descartó o sobrevaloró.

Para reiniciar el progreso local, detén la aplicación y elimina `data/state.json`. En Docker, elimina únicamente el volumen `soc-analyst-training-lab_lab-state` si deseas un reinicio total.

La solución se mantiene en servidor y no llega al navegador antes de la entrega. Esto reduce respuestas accidentales, pero no evita que un estudiante con acceso al repositorio lea la definición.

Para una sesión grupal, entrega sólo el build y conserva el repositorio. No expongas este servicio a Internet: no incluye autenticación multiusuario.
