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
  'T1078': { name: 'Valid Accounts', tactic: 'Stealth' },
  'T1078.002': { name: 'Domain Accounts', tactic: 'Stealth' },
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

export function technique(id: keyof typeof mitreCatalog): MitreTechnique {
  return { id, ...mitreCatalog[id] };
}
