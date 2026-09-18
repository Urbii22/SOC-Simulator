import type { MitreTechnique } from '../domain/types.js';

export const mitreCatalog: Record<string, Omit<MitreTechnique, 'id'>> = {
  'T1003.001': { name: 'LSASS Memory', tactic: 'Credential Access' },
  'T1021.001': { name: 'Remote Desktop Protocol', tactic: 'Lateral Movement' },
  'T1021.002': { name: 'SMB/Windows Admin Shares', tactic: 'Lateral Movement' },
  'T1021.006': { name: 'Windows Remote Management', tactic: 'Lateral Movement' },
  'T1041': { name: 'Exfiltration Over C2 Channel', tactic: 'Exfiltration' },
  'T1053.003': { name: 'Cron', tactic: 'Persistence' },
  'T1053.005': { name: 'Scheduled Task', tactic: 'Persistence' },
  'T1056.003': { name: 'Web Portal Capture', tactic: 'Credential Access' },
  'T1059.001': { name: 'PowerShell', tactic: 'Execution' },
  'T1059.004': { name: 'Unix Shell', tactic: 'Execution' },
  'T1071.001': { name: 'Web Protocols', tactic: 'Command and Control' },
  'T1071.004': { name: 'DNS', tactic: 'Command and Control' },
  'T1078': { name: 'Valid Accounts', tactic: 'Defense Evasion' },
  'T1078.002': { name: 'Domain Accounts', tactic: 'Defense Evasion' },
  'T1078.004': { name: 'Cloud Accounts', tactic: 'Initial Access' },
  'T1087.002': { name: 'Domain Account', tactic: 'Discovery' },
  'T1098.003': { name: 'Additional Cloud Roles', tactic: 'Persistence' },
  'T1105': { name: 'Ingress Tool Transfer', tactic: 'Command and Control' },
  'T1110.001': { name: 'Password Guessing', tactic: 'Credential Access' },
  'T1110.003': { name: 'Password Spraying', tactic: 'Credential Access' },
  'T1110.004': { name: 'Credential Stuffing', tactic: 'Credential Access' },
  'T1135': { name: 'Network Share Discovery', tactic: 'Discovery' },
  'T1189': { name: 'Drive-by Compromise', tactic: 'Initial Access' },
  'T1190': { name: 'Exploit Public-Facing Application', tactic: 'Initial Access' },
  'T1204.002': { name: 'Malicious File', tactic: 'Execution' },
  'T1219': { name: 'Remote Access Software', tactic: 'Command and Control' },
  'T1505.003': { name: 'Web Shell', tactic: 'Persistence' },
  'T1543.003': { name: 'Windows Service', tactic: 'Privilege Escalation' },
  'T1547.001': { name: 'Registry Run Keys / Startup Folder', tactic: 'Persistence' },
  'T1560.001': { name: 'Archive via Utility', tactic: 'Collection' },
  'T1566.001': { name: 'Spearphishing Attachment', tactic: 'Initial Access' },
  'T1566.002': { name: 'Spearphishing Link', tactic: 'Initial Access' },
  'T1567.002': { name: 'Exfiltration to Cloud Storage', tactic: 'Exfiltration' },
  'T1595.003': { name: 'Wordlist Scanning', tactic: 'Reconnaissance' },
};

export const mitreEvidenceHints: Record<string, string[]> = {
  'T1003.001': ['lsass'], 'T1021.001': ['rdp', 'logon type 10'], 'T1021.002': ['admin$'], 'T1021.006': ['winrm', 'wsmprovhost'],
  'T1041': ['upload', 'post'], 'T1053.003': ['cron'], 'T1053.005': ['scheduled task'], 'T1056.003': ['password-sized'],
  'T1059.001': ['powershell'], 'T1059.004': ['/bin/sh', '/bin/bash'], 'T1071.001': ['tls'], 'T1071.004': ['dns'],
  'T1078': ['login', 'session'], 'T1078.002': ['kerberos', 'tgt'], 'T1078.004': ['cloud login'], 'T1087.002': ['nltest', 'person,computer'],
  'T1098.003': ['role added'], 'T1105': ['download'], 'T1110.001': ['failed password', 'password guesses'],
  'T1110.003': ['password', 'distinct_users'], 'T1110.004': ['credential'], 'T1135': ['net.exe view'], 'T1189': ['browser'],
  'T1190': ['exploit', 'deserialization', 'expression'], 'T1204.002': ['user opened', 'mounted'], 'T1505.003': ['.php'],
  'T1543.003': ['service'], 'T1547.001': ['currentversion\\run'], 'T1560.001': ['archive', 'tar.exe'],
  'T1566.001': ['.docm'], 'T1566.002': ['link'], 'T1567.002': ['upload'], 'T1595.003': ['server-status', 'distinct_paths'],
};

export function technique(id: keyof typeof mitreCatalog): MitreTechnique {
  return { id, ...mitreCatalog[id] };
}
