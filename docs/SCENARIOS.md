# Catálogo de escenarios

La tabla muestra la telemetría principal necesaria para resolver cada caso; cada dataset incluye además actividad normal y ruido contextual. No contiene claves, IOC concretos ni conclusiones.

| ID | Escenario | Dificultad | Categoría | Fuentes principales | MITRE ATT&CK |
|---:|---|---|---|---|---|
| 1 | SSH brute force contra bastión | Foundation | Initial Access | auth, Linux | T1110.001 |
| 2 | Password spraying en Microsoft 365 | Foundation | Credential Access | auth, HTTP | T1110.003 |
| 3 | Credential stuffing en portal VPN | Intermediate | Initial Access | HTTP, auth, network | T1110.004 |
| 4 | PowerShell codificado en estación financiera | Intermediate | Execution | Sysmon, Windows | T1059.001 |
| 5 | Phishing con documento señuelo | Intermediate | Initial Access | HTTP, Sysmon | T1566.001 |
| 6 | Túnel DNS desde equipo de I+D | Advanced | Command and Control | DNS, network | T1071.004 |
| 7 | Beaconing TLS de baja frecuencia | Advanced | Command and Control | Sysmon, network, Suricata | T1071.001 |
| 8 | Webshell en servidor de soporte | Advanced | Persistence | HTTP, Linux | T1505.003 |
| 9 | Escalada local mediante servicio vulnerable | Intermediate | Privilege Escalation | Windows, Sysmon | T1543.003 |
| 10 | Exfiltración a almacenamiento cloud | Advanced | Exfiltration | Windows, Sysmon, HTTP, network | T1567.002 |
| 11 | Inicio RDP fuera de patrón | Foundation | Lateral Movement | firewall, Windows, auth, Sysmon | T1021.001, T1078 |
| 12 | Bloqueo repetido de cuenta de RR. HH. | Foundation | Credential Access | Windows, auth, endpoint | T1110.001 |
| 13 | Enumeración de directorios web | Foundation | Reconnaissance | HTTP, Suricata, firewall | T1595.003 |
| 14 | Tarea programada fuera de estándar | Foundation | Persistence | Sysmon, Windows, endpoint | T1053.005 |
| 15 | Descarga sospechosa desde navegador | Foundation | Execution | DNS, HTTP, endpoint, Windows, Sysmon | T1204.002, T1105 |
| 16 | Enlace de phishing y ejecución PowerShell | Intermediate | Initial Access → Execution | email, DNS, HTTP, Sysmon, Windows, endpoint | T1566.002, T1059.001 |
| 17 | Cuenta web comprometida y abuso de privilegios | Intermediate | Persistence | auth, HTTP, cloud | T1078, T1098.003 |
| 18 | Actividad SMB anómala entre segmentos | Intermediate | Discovery / Lateral Movement | Sysmon, firewall, Windows, network | T1135, T1021.002 |
| 19 | Beaconing DNS de baja cadencia | Intermediate | Command and Control | endpoint, DNS, network, Sysmon | T1071.004 |
| 20 | Indicadores de volcado de credenciales | Intermediate | Credential Access | Windows, Sysmon, endpoint | T1003.001 |
| 21 | Movimiento lateral mediante WinRM | Intermediate | Lateral Movement | auth, firewall, Windows, Sysmon, network | T1021.006, T1078.002 |
| 22 | Persistencia mediante Registry Run Keys | Intermediate | Persistence | Sysmon, endpoint, Windows, DNS | T1547.001 |
| 23 | Acceso inicial, shell y persistencia cron | Advanced | Multi-stage Intrusion | HTTP, Suricata, Linux, DNS, network, firewall | T1190, T1059.004, T1053.003 |
| 24 | Password spray, VPN y reconocimiento interno | Advanced | Credential Access → Discovery | cloud, auth, firewall, Windows, Sysmon | T1110.003, T1078, T1087.002 |
| 25 | Explotación web, webshell y acceso a base de datos | Advanced | Initial Access → Persistence | HTTP, Suricata, Linux, network | T1190, T1505.003, T1059.004 |
| 26 | Endpoint, C2 y exfiltración por canal web | Advanced | Command and Control → Exfiltration | endpoint, DNS, network, Sysmon, HTTP, firewall | T1204.002, T1071.001, T1560.001, T1041 |
| 27 | Phishing, robo de credenciales y abuso cloud | Advanced | Initial Access → Cloud Abuse | email, DNS, HTTP, cloud, auth | T1566.002, T1056.003, T1078.004 |
| 28 | Actividad administrativa: ¿incidente o cambio? | Advanced | Triage / Remote Administration | auth, firewall, Windows, Sysmon, endpoint | T1021.001 |
| 29 | Posible exfiltración o copia autorizada | Advanced | Triage / Data Transfer | cloud, endpoint, Windows, firewall, HTTP, network | T1567.002, T1560.001 |
| 30 | Incidente multialerta con señales mixtas | Advanced | Multi-Alert Investigation | Windows, firewall, auth, Sysmon, DNS, HTTP, endpoint | T1078.002, T1021.002, T1041 |

Los escenarios 11–15 forman el grupo de fundamentos; 16–22, correlación multifuente; 23–27, cadenas multi-stage; y 28–30, investigaciones ambiguas. Los datasets contienen entre 46 y 229 eventos, según complejidad.
