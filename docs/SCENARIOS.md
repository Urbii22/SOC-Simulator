# Catálogo de escenarios

| Caso | Dificultad | Fuentes principales | MITRE ATT&CK |
|---|---|---|---|
| SSH brute force | Foundation | auth, Linux | T1110.001 |
| Password spraying | Foundation | cloud auth, HTTP | T1110.003 |
| Credential stuffing | Intermediate | VPN, auth, red | T1110.004 |
| PowerShell sospechoso | Intermediate | Sysmon, Windows | T1059.001 |
| Phishing con payload | Intermediate | correo, proxy, Sysmon | T1566.001 |
| DNS tunneling | Advanced | DNS, red | T1071.004 |
| Malware beaconing | Advanced | Sysmon, TLS, Suricata | T1071.001 |
| Webshell | Advanced | HTTP, FIM, Linux | T1505.003 |
| Escalada de privilegios | Intermediate | Windows, Sysmon | T1543.003 |
| Exfiltración | Advanced | Windows, Sysmon, proxy, DLP | T1567.002 |

Cada caso contiene 42 eventos de fondo y una cadena maliciosa de al menos cuatro pasos.
