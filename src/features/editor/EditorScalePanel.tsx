import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { PathPlanningDocument, Point2 } from '@/domain/path-intel/types';
import { previewPathScale } from '@/domain/path-editor/pathScaling';

export function EditorScalePanel({ document, disabled, onDraftChange, onApply }: {
  document: PathPlanningDocument; disabled: boolean; onDraftChange: () => void;
  onApply: (factor: number, origin: Point2) => void;
}) {
  const [mode, setMode] = useState<'factor' | 'longest-side'>('longest-side');
  const [amount, setAmount] = useState('140');
  const [x, setX] = useState('0');
  const [y, setY] = useState('0');
  const origin = { x: Number(x), y: Number(y) };
  const preview = [amount, x, y].every(value => value.trim() !== '')
    ? previewPathScale(document, mode === 'factor' ? { kind: mode, factor: Number(amount) } : { kind: mode, lengthMm: Number(amount) }, origin) : null;
  return <section aria-label="Uniform document scaling" className="mt-3 grid gap-2 border-t border-border pt-2 text-[10px]">
    <h4>Uniform scale</h4>
    <label className="grid gap-1">Scale by
      <Select aria-label="Scale mode" value={mode} disabled={disabled} onChange={event => {
        const value = event.currentTarget.value;
        if (value === 'factor' || value === 'longest-side') { setMode(value); onDraftChange(); }
      }}><option value="longest-side">Longest side (mm)</option><option value="factor">Factor</option></Select>
    </label>
    <label className="grid gap-1">{mode === 'factor' ? 'Factor' : 'Longest side (mm)'}
      <Input aria-label="Scale amount" inputMode="decimal" value={amount} disabled={disabled} onChange={event => { setAmount(event.currentTarget.value); onDraftChange(); }} />
    </label>
    <div className="grid grid-cols-2 gap-2">
      <label className="grid gap-1">Origin X (mm)<Input aria-label="Scale origin X" inputMode="decimal" value={x} disabled={disabled} onChange={event => { setX(event.currentTarget.value); onDraftChange(); }} /></label>
      <label className="grid gap-1">Origin Y (mm)<Input aria-label="Scale origin Y" inputMode="decimal" value={y} disabled={disabled} onChange={event => { setY(event.currentTarget.value); onDraftChange(); }} /></label>
    </div>
    <p role="status" className="font-mono">{preview ? `Result ${preview.widthMm.toFixed(3)} × ${preview.heightMm.toFixed(3)} mm; X ${preview.bounds.minX.toFixed(3)}…${preview.bounds.maxX.toFixed(3)}, Y ${preview.bounds.minY.toFixed(3)}…${preview.bounds.maxY.toFixed(3)}; factor ${preview.factor.toPrecision(7)}` : 'Enter a positive scale and finite origin.'}</p>
    <p className="text-muted-foreground">Scales the whole drawing, linked starts and lead coordinates. Manual leads need review. Manual initial wire stays fixed and needs review. Stop distances stay in mm. Topology changes and invalid stops are refused.</p>
    <Button type="button" variant="outline" disabled={disabled || !preview} onClick={() => { if (preview) onApply(preview.factor, origin); }}>Apply uniform scale</Button>
  </section>;
}
