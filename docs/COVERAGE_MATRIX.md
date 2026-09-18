# Matriz de cobertura

Esta matriz se usa para revisar diversidad y progresión. “Correlación” resume la amplitud mínima esperada; no revela IOC ni conclusiones específicas.

| ID | Fuentes relevantes | Técnicas | Tácticas / tipo | Dificultad | Hosts | Usuarios | Resultado | Correlación |
|---:|---|---|---|---|---:|---:|---|---|
| 1 | auth, Linux | T1110.001 | Credential Access | Foundation | 4 | 4 | TP | 2 fuentes |
| 2 | auth, HTTP | T1110.003 | Credential Access | Foundation | 4 | 4 | TP | identidad + sesión |
| 3 | HTTP, auth, network | T1110.004 | Initial Access | Intermediate | 4 | 4 | TP | 3 fuentes |
| 4 | Sysmon, Windows | T1059.001 | Execution | Intermediate | 4 | 4 | TP | proceso + persistencia |
| 5 | HTTP, Sysmon | T1566.001 | Initial Access | Intermediate | 4 | 4 | TP | descarga + proceso |
| 6 | DNS, network | T1071.004 | Command and Control | Advanced | 4 | 4 | TP | patrón temporal |
| 7 | Sysmon, network, Suricata | T1071.001 | Command and Control | Advanced | 4 | 4 | TP | proceso + cadencia |
| 8 | HTTP, Linux | T1505.003 | Persistence | Advanced | 4 | 4 | TP | archivo + ejecución |
| 9 | Windows, Sysmon | T1543.003 | Privilege Escalation | Intermediate | 4 | 4 | TP | cambio + proceso |
| 10 | Windows, Sysmon, HTTP, network | T1567.002 | Exfiltration | Advanced | 4 | 4 | TP | acceso + archivo + transferencia |
| 11 | firewall, Windows, auth, Sysmon | T1021.001, T1078 | Lateral Movement | Foundation | 4 | 3 | TP | gateway + logon + proceso |
| 12 | Windows, auth, endpoint | T1110.001 | Credential Access | Foundation | 3 | 4 | TP | cuenta + origen + servicio |
| 13 | HTTP, Suricata, firewall | T1595.003 | Reconnaissance | Foundation | 4 | 3 | TP | rutas + detección + bloqueo |
| 14 | Sysmon, Windows, endpoint | T1053.005 | Persistence | Foundation | 3 | 4 | TP | creador + tarea + ejecución |
| 15 | DNS, HTTP, endpoint, Windows, Sysmon | T1204.002, T1105 | Execution | Foundation | 3 | 3 | TP | navegación + fichero + proceso |
| 16 | email, DNS, HTTP, Sysmon, Windows, endpoint | T1566.002, T1059.001 | Initial Access / Execution | Intermediate | 4 | 3 | TP | mensaje → proceso |
| 17 | auth, HTTP, cloud | T1078, T1098.003 | Persistence | Intermediate | 3 | 4 | TP | sesión → rol |
| 18 | Sysmon, firewall, Windows, network | T1135, T1021.002 | Discovery / Lateral Movement | Intermediate | 6 | 3 | TP | origen + varios destinos |
| 19 | endpoint, DNS, network, Sysmon | T1071.004 | Command and Control | Intermediate | 4 | 3 | TP | periodicidad + proceso |
| 20 | Windows, Sysmon, endpoint | T1003.001 | Credential Access | Intermediate | 3 | 3 | TP | privilegios + acceso LSASS |
| 21 | auth, firewall, Windows, Sysmon, network | T1021.006, T1078.002 | Lateral Movement | Intermediate | 7 | 3 | TP | Kerberos → WinRM |
| 22 | Sysmon, endpoint, Windows, DNS | T1547.001 | Persistence | Intermediate | 3 | 3 | TP | registro → siguiente logon |
| 23 | HTTP, Suricata, Linux, DNS, network, firewall | T1190, T1059.004, T1053.003 | Intrusión multi-stage | Advanced | 5 | 5 | TP | 6 fuentes / 3 fases |
| 24 | cloud, auth, firewall, Windows, Sysmon | T1110.003, T1078, T1087.002 | Credential Access / Discovery | Advanced | 6 | 4 | TP | Internet → VPN → AD |
| 25 | HTTP, Suricata, Linux, network | T1190, T1505.003, T1059.004 | Initial Access / Persistence | Advanced | 5 | 6 | TP | exploit → shell → datos |
| 26 | endpoint, DNS, network, Sysmon, HTTP, firewall | T1204.002, T1071.001, T1560.001, T1041 | C2 / Exfiltration | Advanced | 4 | 4 | TP | endpoint → C2 → salida |
| 27 | email, DNS, HTTP, cloud, auth | T1566.002, T1056.003, T1078.004 | Initial Access / Cloud Abuse | Advanced | 7 | 3 | TP | phishing → tenant |
| 28 | auth, firewall, Windows, Sysmon, endpoint | T1021.001 | Remote Administration | Advanced | 5 | 3 | FP | alerta + cambio aprobado |
| 29 | cloud, endpoint, Windows, firewall, HTTP, network | T1567.002, T1560.001 | Data Transfer | Advanced | 7 | 4 | FP | transferencia + contrato |
| 30 | Windows, firewall, auth, Sysmon, DNS, HTTP, endpoint | T1078.002, T1021.002, T1041 | Multi-Alert | Advanced | 7 | 6 | Mixto | varias hipótesis / alcance |

Balance del catálogo: 7 Foundation, 11 Intermediate y 12 Advanced; 27 TP, 2 FP y 1 mixto. Los escenarios avanzados nuevos usan entre 4 y 8 fuentes generadas y requieren timelines multihost o validación contextual.
