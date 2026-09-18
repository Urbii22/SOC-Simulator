import { useState, type FormEvent } from 'react';
import { Dices, LoaderCircle } from 'lucide-react';
import type { ProceduralTemplateSummary } from '../../domain/types';

interface Props {
  templates: ProceduralTemplateSummary[];
  onGenerate(input: { template?: string; random?: boolean; seed: number; difficulty: 'easy' | 'medium' | 'hard' }): Promise<void>;
}

export function ProceduralLauncher({ templates, onGenerate }: Props) {
  const [selection, setSelection] = useState(templates[0]?.id ?? '__random__');
  const [seed, setSeed] = useState('92817');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsedSeed = Number(seed);
    if (!Number.isInteger(parsedSeed) || parsedSeed < 0 || parsedSeed > 0xffff_ffff) return;
    setPending(true);
    try {
      await onGenerate(selection === '__random__' ? { random: true, seed: parsedSeed, difficulty } : { template: selection, seed: parsedSeed, difficulty });
    } finally { setPending(false); }
  };

  return (
    <form className="procedural-launcher" onSubmit={submit} aria-label="Generar escenario procedural">
      <div className="launcher-heading"><span className="eyebrow">Nueva investigación</span><Dices size={15} aria-hidden="true" /></div>
      <label><span>Origen</span><select value={selection} onChange={(event) => setSelection(event.target.value)}><option value="__random__">Aleatorio · tipo oculto</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
      <div className="launcher-row">
        <label><span>Seed</span><input value={seed} inputMode="numeric" pattern="[0-9]+" min="0" max="4294967295" onChange={(event) => setSeed(event.target.value)} aria-label="Seed reproducible" /></label>
        <label><span>Dificultad</span><select value={difficulty} onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label>
      </div>
      <button type="submit" disabled={pending || !seed}>{pending ? <LoaderCircle size={13} aria-hidden="true" /> : <Dices size={13} aria-hidden="true" />}{pending ? 'Generando…' : 'Generar variante'}</button>
    </form>
  );
}
