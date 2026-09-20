import { BarChart3, History, Shield, Terminal } from 'lucide-react';

/** Decorative layered glass illustration, shared by the four workspace headers. */
export function LabArtwork({ variant = 'shield' }: { variant?: 'shield' | 'history' | 'stats' | 'terminal' }) {
  const Icon = { shield: Shield, history: History, stats: BarChart3, terminal: Terminal }[variant];
  return <div className={`lab-artwork art-${variant}`} aria-hidden="true"><div className="art-grid" /><div className="glass-stack"><i /><i /><i /><div className="glass-face"><Icon strokeWidth={1.25} /><span>WATCHFLOOR</span></div></div><div className="art-spark spark-one" /><div className="art-spark spark-two" /></div>;
}
