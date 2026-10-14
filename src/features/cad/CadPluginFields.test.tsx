import { act, useState, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAD_GEAR_PLUGIN, CAD_GEAR_V2_PLUGIN, CAD_GEAR_V3_PLUGIN, CAD_LINKED_RECIPE_EXAMPLE, createCadPluginProfile, inspectCadPluginProfile, type CadPluginProfile } from '@/domain/cad/plugins/cadPlugins';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { CadPluginFields } from './CadPluginFields';
import { CadProfileEditor } from './CadFeatureEditor';
import { CadSession } from './cadSession';

let container: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
function field(label: string) {
  const element = Array.from(container.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select')).find(element => element.getAttribute('aria-label') === label);
  if (!element) throw new Error(`Missing ${label}`); return element;
}
async function change(label: string, value: string) {
  const element = field(label), prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (!setter) throw new Error('Missing native setter');
  await act(async () => { setter.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLInputElement ? 'input' : 'change', { bubbles: true })); });
}
async function click(label: string) {
  const element = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === label);
  if (!element) throw new Error(`Missing ${label}`); await act(async () => element.click());
}
describe('correlated plugin configuration', () => {
  it('edits exact named aliases from their full precision without adding history for equivalent numeric text', async () => {
    const preciseModule = 3.123456789, geometry = createCadPluginProfile(CAD_GEAR_V2_PLUGIN);
    geometry.inputs.module = 'exactModule';
    const session = new CadSession({ ...createCadDocument(), parameters: { exactModule: preciseModule }, features: [{ kind: 'sketch', id: 'sketch', name: 'Gear section', suppressed: false, plane: 'XY', offset: 0,
      profiles: [{ id: 'gear', name: 'Gear', construction: false, geometry }] }] });
    function Harness() {
      const state = useSyncExternalStore(session.subscribe, session.getSnapshot), sketch = state.document.features[0];
      if (sketch.kind !== 'sketch') throw new Error('Missing gear sketch');
      return <CadProfileEditor profile={sketch.profiles[0]} document={state.document} onApply={(profile, parameters) => session.edit([
        ...Object.entries(parameters).map(([name, value]) => ({ kind: 'set-parameter' as const, name, value })),
        { kind: 'update-feature', feature: { ...sketch, profiles: [profile] } }
      ])} onCancel={vi.fn()} onPendingChange={session.setWorkflowOpen} />;
    }
    await act(async () => root.render(<Harness />));
    const before = session.getSnapshot();
    expect(field('Module').value).toBe(String(preciseModule));
    await change('Module', `${field('Module').value}0`); await click('Apply');
    expect(session.getSnapshot()).toEqual(before);
    expect(session.getSnapshot().document.parameters.exactModule).toBe(preciseModule);
  });
  it.each([3.123456789, 'chosenModule / 2'])('keeps an unchanged relation source %s without creating a profile history step', async value => {
    const geometry = createCadPluginProfile(CAD_GEAR_V2_PLUGIN); geometry.inputs.module = value;
    const session = new CadSession({ ...createCadDocument(), parameters: { chosenModule: 6.246913578 }, features: [{ kind: 'sketch', id: 'sketch', name: 'Gear section', suppressed: false, plane: 'XY', offset: 0,
      profiles: [{ id: 'gear', name: 'Gear', construction: false, geometry }] }] });
    function Harness() {
      const state = useSyncExternalStore(session.subscribe, session.getSnapshot), sketch = state.document.features[0];
      if (sketch.kind !== 'sketch') throw new Error('Missing gear sketch');
      return <CadProfileEditor profile={sketch.profiles[0]} document={state.document} onApply={profile => session.edit([{ kind: 'update-feature', feature: { ...sketch, profiles: [profile] } }])} onCancel={vi.fn()} onPendingChange={session.setWorkflowOpen} />;
    }
    await act(async () => root.render(<Harness />));
    const before = session.getSnapshot(), fx = container.querySelector<HTMLButtonElement>('button[aria-label="Edit Module relation"]');
    if (!fx) throw new Error('Missing relation editor'); await act(async () => fx.click());
    const expression = document.querySelector<HTMLInputElement>('input[aria-label="Module expression"]');
    expect(expression?.value).toBe(String(value));
    const keep = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === 'Keep relation');
    if (!keep) throw new Error('Missing Keep relation'); await act(async () => keep.click());
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    const apply = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Apply');
    if (apply) await act(async () => apply.click());
    expect(session.getSnapshot()).toEqual(before);
    expect(session.getSnapshot().canUndo).toBe(false);
  });
  it('adds configurable roots only through an explicit draft upgrade, preserving linked inputs until Apply', async () => {
    const legacy = createCadPluginProfile(CAD_GEAR_V2_PLUGIN); legacy.inputs.module = 'chosenModule'; legacy.inputs.teeth = 'chosenTeeth'; legacy.inputs.x = 5;
    const session = new CadSession({ ...createCadDocument(), parameters: { chosenModule: 3, chosenTeeth: 18 }, features: [{ kind: 'sketch', id: 'sketch', name: 'Gear section', suppressed: false, plane: 'XY', offset: 0,
      profiles: [{ id: 'gear', name: 'Gear', construction: false, geometry: legacy }] }] });
    const original = session.getSnapshot().document;
    function Harness() {
      const state = useSyncExternalStore(session.subscribe, session.getSnapshot), sketch = state.document.features[0];
      if (sketch.kind !== 'sketch') throw new Error('Missing gear sketch');
      return <CadProfileEditor profile={sketch.profiles[0]} document={state.document} onApply={profile => session.edit([{ kind: 'update-feature', feature: { ...sketch, profiles: [profile] } }])} onCancel={vi.fn()} onPendingChange={session.setWorkflowOpen} />;
    }
    await act(async () => root.render(<Harness />));
    expect(container.querySelector('input[aria-label="Cutter tip radius"]')).toBeNull(); await click('Configure tooth root');
    expect(session.getSnapshot().document).toBe(original); expect(session.getSnapshot().workflowOpen).toBe(true); expect(field('Cutter tip radius').disabled).toBe(true);
    await click('Apply');
    const sketch = session.getSnapshot().document.features[0];
    expect(sketch.kind === 'sketch' && sketch.profiles[0].geometry.kind === 'plugin' && sketch.profiles[0].geometry.package.version).toBe('3.0.0');
    expect(sketch.kind === 'sketch' && sketch.profiles[0].geometry.kind === 'plugin' && sketch.profiles[0].geometry.inputs.module).toBe('chosenModule');
    expect(sketch.kind === 'sketch' && sketch.profiles[0].geometry.kind === 'plugin' && sketch.profiles[0].geometry.inputs.x).toBe(5);
    await act(async () => session.undo()); expect(session.getSnapshot().document).toEqual(original);
  });
  it('correlates a custom generating tool radius, auto shift and diagram without discarding the stored custom expression', async () => {
    let current = createCadPluginProfile(CAD_GEAR_V3_PLUGIN); current.inputs.cutterTipRadius = 'customToolRadius';
    function Harness() { const [profile, setProfile] = useState(current); return <CadPluginFields profile={profile} parameters={{ customToolRadius: 0.6 }} onChange={next => { current = next; setProfile(next); }} />; }
    await act(async () => root.render(<Harness />));
    const automatic = inspectCadPluginProfile(current, { customToolRadius: 0.6 });
    expect(container.querySelectorAll('button[aria-label="Tooth root help"]')).toHaveLength(1);
    expect(container.querySelectorAll('button[aria-label="Root transition help"]')).toHaveLength(1);
    expect(Number(field('Cutter tip radius').value)).toBeCloseTo(automatic.values.effectiveCutterTipRadius, 6); expect(field('Cutter tip radius').disabled).toBe(true);
    await change('Tooth root', '1');
    expect(field('Cutter tip radius').value).toBe('0.6'); expect(field('Cutter tip radius').disabled).toBe(false);
    const custom = inspectCadPluginProfile(current, { customToolRadius: 0.6 });
    expect(custom.issues).toEqual([]); expect(custom.values.effectiveCutterTipRadius).toBe(0.6); expect(custom.values.effectiveShift).toBeGreaterThan(automatic.values.effectiveShift);
    const help = container.querySelector<HTMLButtonElement>('button[aria-label="Cutter tip radius help"]'); if (!help) throw new Error('Missing custom root help');
    await act(async () => help.click());
    const customPath = document.querySelector('[role="dialog"] path[stroke="#f1bf72"]')?.getAttribute('d');
    expect(customPath).toBeTruthy(); expect(document.querySelector('[role="dialog"]')?.textContent).toContain('0.6 mm');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('not a manufacturing-standard minimum');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('at least 5% tip land');
    const modeExplanation = Array.from(document.querySelectorAll('[role="dialog"] p')).find(paragraph => paragraph.textContent?.startsWith('Automatic controls the applied radius.'));
    expect(modeExplanation).toBeTruthy(); expect(modeExplanation?.querySelector('code')).toBeNull();
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await change('Tooth root', '0'); expect(current.inputs.cutterTipRadius).toBe('customToolRadius'); expect(field('Cutter tip radius').disabled).toBe(true);
    const automaticHelp = container.querySelector<HTMLButtonElement>('button[aria-label="Cutter tip radius help"]'); if (!automaticHelp) throw new Error('Missing automatic root help');
    await act(async () => automaticHelp.click());
    expect(document.querySelector('[role="dialog"] path[stroke="#f1bf72"]')?.getAttribute('d')).not.toBe(customPath);
  });
  it('rejects an oversized custom tool radius before Apply while retaining the valid document', async () => {
    const document = createCadDocument(), apply = vi.fn(), geometry = createCadPluginProfile(CAD_GEAR_V3_PLUGIN);
    await act(async () => root.render(<CadProfileEditor profile={{ id: 'gear', name: 'Gear', construction: false, geometry }} document={document} onApply={apply} onCancel={vi.fn()} onPendingChange={vi.fn()} />));
    await change('Tooth root', '1'); await change('Cutter tip radius', '10');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Cutter tip radius');
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === 'Apply'); expect(button?.disabled).toBe(true);
    await click('Apply'); expect(apply).not.toHaveBeenCalled(); expect(geometry.inputs.cutterTipMode).toBe(0);
    await change('Cutter tip radius', '0.6'); expect(button?.disabled).toBe(false); await click('Apply'); expect(apply).toHaveBeenCalled();
  });
  it('explains curve accuracy as bounded deviation rather than a fixed number of segments', async () => {
    const update = vi.fn(), profile = createCadPluginProfile(CAD_GEAR_V3_PLUGIN);
    await act(async () => root.render(<CadPluginFields profile={profile} parameters={{}} onChange={update} />));
    const help = container.querySelector<HTMLButtonElement>('button[aria-label="Curve representation help"]'); if (!help) throw new Error('Missing curve representation help');
    await act(async () => help.click());
    const text = document.querySelector('[role="dialog"]')?.textContent;
    expect(text).toContain('maximum deviation'); expect(text).toContain('Root-circle and tip-circle arcs remain exact'); expect(text).toContain('does not set a fixed segment count');
    expect(update).not.toHaveBeenCalled();
  });
  it('keeps automatic dependent values disabled and restores dormant custom expressions', async () => {
    let current = createCadPluginProfile(CAD_GEAR_V2_PLUGIN);
    current.inputs.profileShift = 'chosenShift'; current.inputs.tolerance = 'chosenTolerance';
    function Harness() {
      const [profile, setProfile] = useState(current);
      return <CadPluginFields profile={profile} parameters={{ chosenShift: 0.1, chosenTolerance: 0.003 }} onChange={next => { current = next; setProfile(next); }} />;
    }
    await act(async () => root.render(<Harness />));
    expect(field('Shift coefficient').disabled).toBe(true); expect(field('Custom tolerance').disabled).toBe(true);
    await change('Teeth', '12');
    expect(Number(field('Shift coefficient').value)).toBeGreaterThan(0.29);
    expect(current.inputs.profileShift).toBe('chosenShift');
    await change('Teeth', '24'); await change('Profile shift', '1');
    expect(field('Shift coefficient').disabled).toBe(false); expect(field('Shift coefficient').value).toBe('0.1');
    await change('Curve tolerance', '1');
    expect(field('Custom tolerance').value).toBe('0.003'); expect(current.inputs.tolerance).toBe('chosenTolerance');
    expect(inspectCadPluginProfile(current, { chosenShift: 0.1, chosenTolerance: 0.003 }).issues).toEqual([]);
    expect(container.querySelector('[aria-label="Profile placement"]')?.querySelectorAll('input')).toHaveLength(3);
    expect(container.querySelector('.cad-field-hint')).toBeNull();
    expect(container.querySelector('[aria-label="Pitch Ø"]')?.textContent).toBe('72mm');
    expect(container.querySelector('[aria-label="Calculated gear size"]')?.querySelector('input')).toBeNull();
  });
  it('does not break a choice expression until explicitly requested', async () => {
    let current = createCadPluginProfile(CAD_GEAR_V2_PLUGIN); current.inputs.shiftMode = 'mode';
    function Harness() { const [profile, setProfile] = useState(current); return <CadPluginFields profile={profile} parameters={{ mode: 0 }} onChange={next => { current = next; setProfile(next); }} />; }
    await act(async () => root.render(<Harness />));
    expect(field('Profile shift')).toBeInstanceOf(HTMLInputElement); expect(current.inputs.shiftMode).toBe('mode');
    await click('Use choices'); expect(current.inputs.shiftMode).toBe(0); expect(field('Profile shift')).toBeInstanceOf(HTMLSelectElement);
  });
  it('upgrades only on explicit action and preserves existing dimension expressions', async () => {
    const legacy = createCadPluginProfile(CAD_GEAR_PLUGIN); legacy.inputs.module = 'chosenModule';
    const update = vi.fn();
    await act(async () => root.render(<CadPluginFields profile={legacy} parameters={{ chosenModule: 3 }} onChange={update} />));
    expect(update).not.toHaveBeenCalled(); await click('Upgrade rounded roots');
    const next: CadPluginProfile = update.mock.calls[0][0];
    expect(next.package.version).toBe('2.0.0'); expect(next.inputs.module).toBe('chosenModule'); expect(next.inputs.shiftMode).toBe(1); expect(next.inputs.qualityMode).toBe(1);
    expect(inspectCadPluginProfile(next, { chosenModule: 3 }).issues).toEqual([]);
  });
  it('blocks Apply for a invalid draft while retaining the original profile', async () => {
    const document = createCadDocument(), apply = vi.fn();
    const profile = { id: 'gear', name: 'Gear', construction: false, geometry: createCadPluginProfile(CAD_GEAR_V2_PLUGIN) };
    await act(async () => root.render(<CadProfileEditor profile={profile} document={document} onApply={apply} onCancel={vi.fn()} onPendingChange={vi.fn()} />));
    await change('Teeth', '12.5');
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === 'Apply');
    expect(button?.disabled).toBe(true); expect(container.querySelector('[role="alert"]')?.textContent).toContain('integer');
    await click('Apply'); expect(apply).not.toHaveBeenCalled(); expect(profile.geometry.inputs.teeth).toBe(18);
    await change('Teeth', '24'); expect(button?.disabled).toBe(false); await click('Apply'); expect(apply).toHaveBeenCalledWith(expect.objectContaining({ geometry: expect.objectContaining({ inputs: expect.objectContaining({ teeth: '24' }) }) }), {});
  });
  it('links focus and contextual diagrams to the actual current gear dimensions without editing inputs', async () => {
    const inspected = vi.fn(), update = vi.fn(), profile = createCadPluginProfile(CAD_GEAR_V2_PLUGIN);
    profile.inputs.module = 'chosenModule';
    await act(async () => root.render(<CadPluginFields profile={profile} parameters={{ chosenModule: 4 }} onChange={update} onInspectInput={inspected} />));
    await act(async () => field('Module').focus()); expect(inspected).toHaveBeenLastCalledWith('module');
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Pitch Ø help"]');
    if (!button) throw new Error('Missing diameter help');
    await act(async () => { field('Module').blur(); button.click(); });
    expect(inspected).toHaveBeenLastCalledWith('pitchDiameter');
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Pitch circle · Ø 72 mm');
    expect(dialog?.querySelector('circle')?.getAttribute('r')).toBe('36');
    expect(dialog?.querySelector('svg title')?.textContent).toContain('18-tooth gear');
    await act(async () => root.render(<CadPluginFields profile={profile} parameters={{ chosenModule: 5 }} onChange={update} onInspectInput={inspected} />));
    expect(document.querySelector('[role="dialog"] circle')?.getAttribute('r')).toBe('45');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Ø 90 mm');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(inspected).toHaveBeenLastCalledWith(null);
    expect(update).not.toHaveBeenCalled(); expect(profile.inputs.module).toBe('chosenModule');
  });
  it('explains the generating cutter radius and highlights the actual noncircular root curve', async () => {
    const profile = createCadPluginProfile(CAD_GEAR_V2_PLUGIN), inspected = vi.fn();
    await act(async () => root.render(<CadPluginFields profile={profile} parameters={{}} onChange={vi.fn()} onInspectInput={inspected} />));
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Rack tip radius help"]');
    if (!button) throw new Error('Missing cutter radius help');
    await act(async () => button.click());
    expect(inspected).toHaveBeenLastCalledWith('cutterTipRadius');
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('not a constant-radius fillet');
    expect(dialog?.textContent).toContain('cannot be edited independently');
    const rootPath = dialog?.querySelector('path[stroke="#f1bf72"]');
    expect(rootPath?.getAttribute('d')).toMatch(/^M .* L /);
    expect(rootPath?.getAttribute('d')).not.toContain(' A ');
    expect(dialog?.querySelector('svg title')?.textContent).toContain('Actual rack-generated root transition');
    expect(container.querySelector('input[aria-label="Rack tip radius"]')).toBeNull();
  });
  it('edits a linked numeric value through string parameter drafts without replacing its relation', async () => {
    const profile = createCadPluginProfile(CAD_GEAR_V2_PLUGIN); profile.inputs.module = 'linked_module';
    const update = vi.fn(), pending = vi.fn();
    function Harness() {
      const [drafts, setDrafts] = useState<Record<string, string>>({});
      const value = drafts.linked_module, numeric = value?.trim() && Number.isFinite(Number(value)) ? Number(value) : 3;
      return <CadPluginFields profile={profile} parameters={{ linked_module: numeric }} parameterDrafts={drafts} onChange={update}
        onChangeParameter={(name, draft) => { pending(name, draft); setDrafts(previous => ({ ...previous, [name]: draft })); }} />;
    }
    await act(async () => root.render(<Harness />));
    expect(field('Module').value).toBe('3');
    await change('Module', '4'); expect(pending).toHaveBeenLastCalledWith('linked_module', '4');
    expect(field('Module').value).toBe('4'); expect(container.querySelector('[aria-label="Pitch Ø"]')?.textContent).toBe('72mm');
    await change('Module', '-'); expect(field('Module').value).toBe('-'); expect(field('Module').getAttribute('aria-invalid')).toBe('true');
    expect(profile.inputs.module).toBe('linked_module'); expect(update).not.toHaveBeenCalled();
  });
  it('keeps compound relations read-only in value fields and changes them only through fx', async () => {
    let current = createCadPluginProfile(CAD_GEAR_V2_PLUGIN); current.inputs.module = 'size / 2';
    function Harness() { const [profile, setProfile] = useState(current); return <CadPluginFields profile={profile} parameters={{ size: 8 }} onChange={next => { current = next; setProfile(next); }} />; }
    await act(async () => root.render(<Harness />));
    expect(field('Module').value).toBe('4'); expect(field('Module') instanceof HTMLInputElement && field('Module').hasAttribute('readonly')).toBe(true);
    const fx = container.querySelector<HTMLButtonElement>('button[aria-label="Edit Module relation"]');
    if (!fx) throw new Error('Missing relation editor'); await act(async () => fx.click());
    const expression = document.querySelector<HTMLInputElement>('input[aria-label="Module expression"]');
    if (!expression) throw new Error('Missing expression'); expect(expression.value).toBe('size / 2');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) throw new Error('Missing setter');
    const keep = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(button => button.textContent === 'Keep relation');
    if (!keep) throw new Error('Missing relation action');
    await act(async () => { setter.call(expression, 'fetch(1)'); expression.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(keep.disabled).toBe(true); await act(async () => keep.click()); expect(current.inputs.module).toBe('size / 2');
    await act(async () => { setter.call(expression, 'size / 4'); expression.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(keep.disabled).toBe(false); await act(async () => keep.click());
    expect(current.inputs.module).toBe('size / 4'); expect(field('Module').value).toBe('2');
    const independent = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(button => button.textContent === 'Use current value');
    if (!independent) throw new Error('Missing detach action'); await act(async () => independent.click());
    expect(current.inputs.module).toBe(2); expect(field('Module').hasAttribute('readonly')).toBe(false);
  });
  it('retains incomplete numeric drafts in independent placement inputs', async () => {
    let current = createCadPluginProfile(CAD_GEAR_V2_PLUGIN);
    function Harness() { const [profile, setProfile] = useState(current); return <CadPluginFields profile={profile} parameters={{}} onChange={next => { current = next; setProfile(next); }} />; }
    await act(async () => root.render(<Harness />));
    await change('X', '-'); expect(field('X').value).toBe('-'); expect(field('X').hasAttribute('readonly')).toBe(false);
    await change('X', '-5'); expect(field('X').value).toBe('-5'); expect(current.inputs.x).toBe('-5');
  });
  it('sets cutter presets through the linked tooth-count parameter without detaching it', async () => {
    const profile = createCadPluginProfile(CAD_GEAR_V2_PLUGIN); profile.inputs.teeth = 'chosen_teeth';
    const pending = vi.fn(), update = vi.fn();
    await act(async () => root.render(<CadPluginFields profile={profile} parameters={{ chosen_teeth: 18 }} onChange={update} onChangeParameter={pending} />));
    expect(field('Cutter preset').disabled).toBe(true); await change('Cutter numbering', 'ascending');
    expect(field('Cutter preset').disabled).toBe(false); await change('Cutter preset', '35');
    expect(pending).toHaveBeenCalledWith('chosen_teeth', '35'); expect(profile.inputs.teeth).toBe('chosen_teeth'); expect(update).not.toHaveBeenCalled();
    const compound = { ...profile, inputs: { ...profile.inputs, teeth: 'chosen_teeth * 2' } };
    await act(async () => root.render(<CadPluginFields profile={compound} parameters={{ chosen_teeth: 18 }} onChange={update} onChangeParameter={pending} />));
    expect(field('Cutter preset').disabled).toBe(true);
  });
  it('reports unfinished relation typing as pending and releases it on dismissal without changing the profile', async () => {
    const profile = createCadPluginProfile(CAD_GEAR_V2_PLUGIN), pending = vi.fn(), update = vi.fn();
    await act(async () => root.render(<CadPluginFields profile={profile} parameters={{ size: 8 }} onChange={update} onBindingPendingChange={pending} />));
    const fx = container.querySelector<HTMLButtonElement>('button[aria-label="Edit Module relation"]');
    if (!fx) throw new Error('Missing relation button'); await act(async () => fx.click());
    const expression = document.querySelector<HTMLInputElement>('input[aria-label="Module expression"]'), setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!expression || !setter) throw new Error('Missing expression input');
    await act(async () => { setter.call(expression, 'size /'); expression.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(pending).toHaveBeenLastCalledWith(true); expect(update).not.toHaveBeenCalled();
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(pending).toHaveBeenLastCalledWith(false); expect(update).not.toHaveBeenCalled(); expect(profile.inputs.module).toBe(3);
  });
  it('distinguishes a locked recipe input from an automatically substituted gear value', async () => {
    if (CAD_LINKED_RECIPE_EXAMPLE.apiVersion !== 2) throw new Error('API 2 fixture required');
    const plugin = { ...CAD_LINKED_RECIPE_EXAMPLE, rules: { ...CAD_LINKED_RECIPE_EXAMPLE.rules, fields: CAD_LINKED_RECIPE_EXAMPLE.rules.fields.map(field => field.name === 'innerRadius'
      ? { ...field, enabledWhen: { left: 'lobes', operator: 'eq' as const, right: 0 } } : field) } };
    const profile = createCadPluginProfile(plugin);
    await act(async () => root.render(<CadPluginFields profile={profile} parameters={{}} onChange={vi.fn()} />));
    expect(field('Inner radius').disabled).toBe(true); expect(field('Inner radius').value).toBe('20');
    expect(field('Inner radius').title).toContain('Editing locked by a plugin condition');
    expect(inspectCadPluginProfile(profile, {}).values.innerRadius).toBe(20);
  });
});
