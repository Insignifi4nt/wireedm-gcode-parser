import { useId, useState } from 'react';
import { Laptop, Mouse } from 'lucide-react';
import { setCadPreferences, useCadPreferences, type CadPreferences } from '@/features/cad/cadPreferences';

const sections = ['Navigation', 'Display'] as const;
export function CadSettingsPanel() {
  const preferences = useCadPreferences();
  const [section, setSection] = useState<(typeof sections)[number]>('Navigation');
  const [sessionOnly, setSessionOnly] = useState(false);
  const id = useId();
  const update = (next: CadPreferences) => setSessionOnly(!setCadPreferences(next));
  return <div className="grid gap-4 text-xs">
    <div role="tablist" aria-label="CAD settings sections" className="flex border-b border-border" onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1
        : (sections.indexOf(section) + (event.key === 'ArrowRight' ? 1 : -1) + sections.length) % sections.length;
      setSection(sections[next]); event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
    }}>{sections.map(name => <button type="button" key={name} id={`${id}-${name}`} role="tab" aria-selected={section === name}
      aria-controls={`${id}-content`} tabIndex={section === name ? 0 : -1} onClick={() => setSection(name)}
      className={`border-b-2 px-3 py-2 outline-none focus-visible:ring-1 focus-visible:ring-ring ${section === name ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}>{name}</button>)}</div>
    <div id={`${id}-content`} role="tabpanel" aria-labelledby={`${id}-${section}`}>
      {section === 'Navigation' ? <div className="grid max-w-md gap-4">
        <fieldset className="grid gap-2"><legend className="mb-2 font-medium">Input device</legend><div className="grid grid-cols-2 gap-2">
          {(['mouse', 'trackpad'] as const).map(mode => <label key={mode} className={`flex cursor-pointer items-center gap-2 rounded-sm border p-3 ${preferences.navigationMode === mode ? 'border-primary/50 bg-accent' : 'border-border'}`}>
            <input type="radio" name={`${id}-navigation`} checked={preferences.navigationMode === mode} onChange={() => update({ ...preferences, navigationMode: mode })} />
            {mode === 'mouse' ? <Mouse size={16} /> : <Laptop size={16} />}<span>{mode === 'mouse' ? 'Mouse' : 'Trackpad'}</span>
          </label>)}
        </div></fieldset>
        <table className="w-full text-left text-[11px]"><caption className="mb-2 text-left text-muted-foreground">Gestures over the modeling area</caption><tbody>
          {(preferences.navigationMode === 'trackpad' ? [['Two-finger scroll', 'Pan'], ['Pinch', 'Zoom'], ['Alt + two-finger scroll', 'Orbit in 3D']]
            : [['Left drag', 'Orbit in 3D'], ['Right drag', 'Pan'], ['Scroll wheel', 'Zoom']]).map(([gesture, action]) => <tr key={gesture} className="border-b border-border/60"><th className="py-2 pr-3 font-normal text-muted-foreground">{gesture}</th><td className="py-2">{action}</td></tr>)}
        </tbody></table>
      </div> : <label className="flex max-w-md cursor-pointer items-start gap-3 rounded-sm border border-border p-3">
        <input type="checkbox" className="mt-0.5" checked={preferences.showOnPartDimensions} onChange={event => update({ ...preferences, showOnPartDimensions: event.target.checked })} />
        <span><span className="block font-medium">On-part dimensions</span><span className="mt-1 block text-[11px] text-muted-foreground">Show editable dimension controls beside selected sketch geometry.</span></span>
      </label>}
    </div>
    {sessionOnly && <div role="status" className="text-[11px] text-amber-200">Applied for this session. Browser preferences could not be saved.</div>}
  </div>;
}
