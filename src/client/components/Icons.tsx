import type { LucideIcon } from 'lucide-react';

export function SourceIcon({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return <span className="source-icon" title={label}><Icon aria-hidden="true" size={14} /><span className="sr-only">{label}</span></span>;
}

export function SeverityMark({ severity }: { severity: string }) {
  return <span className={`severity-mark severity-${severity}`}><span aria-hidden="true" className="severity-dot" />{{ critical: 'Crítica', high: 'Alta', medium: 'Media', low: 'Baja' }[severity] ?? severity}</span>;
}
