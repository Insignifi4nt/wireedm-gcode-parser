import { useId, useRef, useState } from 'react';
import { LockKeyhole, RotateCw } from 'lucide-react';
import { BUNDLED_CAD_PLUGINS, CAD_GEAR_V2_PLUGIN, createCadPluginProfile, inspectCadPluginProfile, type CadPluginProfile } from '@/domain/cad/plugins/cadPlugins';
import type { CadDocument, CadScalar } from '@/domain/cad/cadDocument';
import { CAD_GEAR_CUTTER_RANGES } from '@/domain/cad/cadGear';
import { CadContextHelp } from './CadContextHelp';
import { CadGearHelp } from './CadGearHelp';
import { CadExpressionBinding } from './CadExpressionBinding';
import { formatCadQuantity } from './cadDisplayQuantity';

const modulePresets = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12];
const gearDimensions = new Set(['pitchDiameter', 'tipDiameter', 'rootDiameter', 'baseDiameter', 'circularPitch', 'cutterTipRadius', 'tipThickness', 'effectiveShift', 'effectiveTolerance']);
const displayValue = (value: number | undefined) => value === undefined || !Number.isFinite(value) ? '—' : formatCadQuantity(value);
export function CadPluginFields({ profile, parameters, onChange, inspection, onInspectInput, onChangeParameter, parameterDrafts, onBindingPendingChange }: {
  profile: CadPluginProfile; parameters: CadDocument['parameters']; onChange(profile: CadPluginProfile): void;
  inspection?: ReturnType<typeof inspectCadPluginProfile>; onInspectInput?(name: string | null): void;
  onChangeParameter?(name: string, value: string): void; parameterDrafts?: Readonly<Record<string, string>>;
  onBindingPendingChange?(pending: boolean): void;
}) {
  const [numbering, setNumbering] = useState('');
  const presetId = useId();
  const inspected = inspection ?? inspectCadPluginProfile(profile, parameters);
  const isGear = profile.package.id === 'wireedm.spur-gear';
  const generatedGear = isGear && profile.package.version !== '1.0.0';
  const rootInputs = new Set(['cutterTipMode', 'cutterTipRadius']);
  const accuracyInputs = new Set(['qualityMode', 'tolerance']);
  const configurableRootPackage = BUNDLED_CAD_PLUGINS.find(plugin => plugin.id === profile.package.id && plugin.inputs.some(input => input.name === 'cutterTipMode'));
  const parameterAlias = (value: CadScalar) => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value.trim()) && Object.hasOwn(parameters, value.trim()) ? value.trim() : null;
  const teethAlias = parameterAlias(profile.inputs.teeth);
  const focused = useRef<string | null>(null), helping = useRef<string | null>(null);
  const pendingBindings = useRef(new Set<string>());
  const bindingPending = (name: string, pending: boolean) => { if (pending) pendingBindings.current.add(name); else pendingBindings.current.delete(name); onBindingPendingChange?.(pendingBindings.current.size > 0); };
  const inspectFocus = (name: string | null) => { focused.current = name; onInspectInput?.(focused.current ?? helping.current); };
  const helpSelection = (name: string, open: boolean) => { if (open) helping.current = name; else if (helping.current === name) helping.current = null; onInspectInput?.(focused.current ?? helping.current); };
  const explanation = (name: string, label: string, unit = '') => isGear
    ? <CadGearHelp name={name} label={label} unit={unit} values={inspected.values} profile={profile} />
    : <><p>{label} is an input declared by {profile.package.name}. Enter a number or a document parameter expression. Named parameters update linked inputs when they change.</p><p>The plugin's declared type and current dependent limits control accepted values.</p></>;
  const change = (name: string, value: CadScalar) => onChange({ ...profile, inputs: { ...profile.inputs, [name]: value } });
  const ruleFor = (name: string) => inspected.fields.find(field => field.name === name);
  const groupFor = (name: string) => profile.package.apiVersion === 2 ? ruleFor(name)?.group ?? 'main' : ['x', 'y', 'angle'].includes(name) ? 'placement' : isGear && !['module', 'teeth'].includes(name) ? 'advanced' : 'main';
  const field = (input: CadPluginProfile['package']['inputs'][number], placement = false) => {
    const rule = ruleFor(input.name);
    const enabled = rule?.enabled ?? true;
    const rawValue = profile.inputs[input.name];
    const resolved = inspected.values[input.name];
    // Numeric typing such as '-' stays an editable invalid draft. A valid
    // relation displays its value and is changed explicitly through fx.
    const bound = typeof rawValue === 'string' && !Number.isFinite(Number(rawValue)) && /[A-Za-z_]/.test(rawValue) && resolved !== undefined;
    const alias = bound ? parameterAlias(rawValue) : null;
    const parameterDraft = alias ? parameterDrafts?.[alias] : undefined;
    const minimum = rule?.minimum ?? input.minimum, maximum = rule?.maximum ?? input.maximum;
    const invalid = enabled && (resolved === undefined || resolved < minimum || resolved > maximum || input.integer && !Number.isInteger(resolved) || parameterDraft !== undefined && (!parameterDraft.trim() || !Number.isFinite(Number(parameterDraft))));
    const effective = !enabled && isGear ? inspected.values[input.name === 'profileShift' ? 'effectiveShift' : input.name === 'tolerance' ? 'effectiveTolerance' : input.name === 'cutterTipRadius' ? 'effectiveCutterTipRadius' : input.name] : undefined;
    const linkedEditable = Boolean(alias && onChangeParameter);
    const value = effective !== undefined ? displayValue(effective) : bound ? parameterDraft ?? (linkedEditable ? String(resolved) : displayValue(resolved)) : rawValue;
    const choiceSelect = Boolean(rule?.choices?.length && (!bound || linkedEditable));
    const automatic = isGear && (input.name === 'profileShift' && inspected.values.shiftMode === 0 || input.name === 'tolerance' && inspected.values.qualityMode === 0 || input.name === 'cutterTipRadius' && inspected.values.cutterTipMode === 0);
    const lockedReason = automatic ? 'Controlled automatically' : 'Editing locked by a plugin condition';
    const editValue = (next: string) => { if (bound && alias && onChangeParameter) onChangeParameter(alias, next); else if (!bound) change(input.name, next); };
    const label = placement ? input.name === 'angle' ? 'Rot' : ['x', 'y'].includes(input.name) ? input.name.toUpperCase() : input.label : input.label;
    const range = `${input.integer ? 'Integer; ' : ''}${displayValue(minimum)}–${displayValue(maximum)}${input.unit ? ` ${input.unit}` : ''}`;
    return <label key={input.name} className={`cad-plugin-field ${placement ? 'is-placement' : ''} ${invalid ? 'is-invalid' : ''} ${!enabled ? 'is-disabled' : ''}`}>
      <span className="cad-plugin-field-caption">{placement && input.name === 'angle' && <RotateCw size={11} />}{label}{!placement && <CadContextHelp label={input.label} onOpenChange={open => helpSelection(input.name, open)}>{explanation(input.name, input.label, input.unit)}<p>Accepted {input.integer ? 'whole numbers' : 'values'}: {range}. {!enabled && `${lockedReason}. The stored input is preserved.`}</p>{bound && <p><code>{rawValue} = {displayValue(resolved)} {input.unit}</code></p>}</CadContextHelp>}</span>
      <div className="cad-plugin-input-wrap">
        {choiceSelect && rule?.choices ? <select aria-label={input.label} aria-invalid={invalid || undefined} disabled={!enabled} value={value} onFocus={() => inspectFocus(input.name)} onBlur={() => inspectFocus(null)} onChange={event => { if (linkedEditable) editValue(event.target.value); else change(input.name, Number(event.target.value)); }}>{!rule.choices.some(choice => String(choice.value) === String(value)) && <option disabled value={value}>Invalid choice</option>}{rule.choices.map(choice => <option key={choice.value} value={choice.value} disabled={choice.value < minimum || choice.value > maximum}>{choice.label}</option>)}</select>
          : <input aria-label={input.label} aria-invalid={invalid || undefined} disabled={!enabled} readOnly={bound && !linkedEditable} spellCheck={false} value={value} list={isGear && input.name === 'module' && (!bound || linkedEditable) ? presetId : undefined} title={!enabled ? `${lockedReason}. Stored value: ${rawValue}` : bound ? `${rawValue} = ${displayValue(resolved)} ${input.unit}. ${range}. ${linkedEditable ? 'Edits update this document parameter and its other uses when you Apply.' : 'Edit the relation with fx.'}` : `${range}. Number or document parameter expression.`} onFocus={() => inspectFocus(input.name)} onBlur={() => inspectFocus(null)} onChange={event => editValue(event.target.value)} />}
        {enabled && <CadContextHelp label={`${input.label} relation`} buttonLabel={`Edit ${input.label} relation`} activation="click" triggerContent="fx" className={`cad-plugin-binding ${input.unit && !placement && !choiceSelect ? 'has-unit' : ''} ${choiceSelect ? 'has-choices' : ''}`} onOpenChange={open => helpSelection(input.name, open)}><CadExpressionBinding label={input.label} expression={rawValue} parameters={parameters} resolved={resolved} onChange={next => change(input.name, next)} onPendingChange={pending => bindingPending(input.name, pending)} /></CadContextHelp>}
        {!enabled && <LockKeyhole size={10} className={`cad-plugin-lock ${input.unit ? 'has-unit' : ''}`} aria-label={lockedReason} />}
        {!rule?.choices?.length && input.unit && !placement && <small className="cad-plugin-unit">{input.unit}</small>}
      </div>
      {bound && rule?.choices?.length && enabled && !choiceSelect && <button type="button" className="cad-plugin-break-link" title="Replace this expression with its current value" onClick={() => { if (resolved !== undefined) change(input.name, resolved); }}>Use choices</button>}
    </label>;
  };
  return <div className="cad-plugin-configuration">
    <datalist id={presetId}>{modulePresets.map(module => <option key={module} value={module} />)}</datalist>
    {isGear && profile.package.version === '1.0.0' && <div className="cad-plugin-upgrade"><span>Legacy sharp roots</span><button type="button" onClick={() => {
      const upgraded = createCadPluginProfile(CAD_GEAR_V2_PLUGIN);
      onChange({ ...upgraded, inputs: { ...upgraded.inputs, ...Object.fromEntries(upgraded.package.inputs.filter(input => Object.hasOwn(profile.inputs, input.name)).map(input => [input.name, profile.inputs[input.name]])), shiftMode: 1, qualityMode: 1 } });
    }}>Upgrade rounded roots</button><small>Rebuilds this profile. Undo restores the saved version.</small></div>}
    <div className="cad-plugin-main-fields">{profile.package.inputs.filter(input => groupFor(input.name) === 'main').map(input => field(input))}</div>
    {isGear && profile.package.apiVersion === 2 && <div className="cad-plugin-key-dimensions" aria-label="Calculated gear size">{profile.package.rules.derived.filter(value => ['pitchDiameter', 'tipDiameter'].includes(value.name)).map(value => <div key={value.name}><span><LockKeyhole size={10} /> {value.label}<CadContextHelp label={value.label} onOpenChange={open => helpSelection(value.name, open)}>{explanation(value.name, value.label, value.unit)}</CadContextHelp></span><output aria-label={value.label}>{displayValue(inspected.values[value.name])}<small>mm</small></output></div>)}</div>}
    {profile.package.inputs.some(input => groupFor(input.name) === 'placement') && <div className="cad-plugin-placement" aria-label="Profile placement">{profile.package.inputs.filter(input => groupFor(input.name) === 'placement').map(input => field(input, true))}</div>}
    {profile.package.inputs.some(input => groupFor(input.name) === 'advanced' && (!generatedGear || !rootInputs.has(input.name) && !accuracyInputs.has(input.name))) && <details className="cad-plugin-disclosure"><summary>Advanced</summary>{profile.package.inputs.filter(input => groupFor(input.name) === 'advanced' && (!generatedGear || !rootInputs.has(input.name) && !accuracyInputs.has(input.name))).map(input => field(input))}</details>}
    {generatedGear && <details className="cad-plugin-disclosure cad-plugin-root-settings"><summary>Tooth root</summary>
      {profile.package.inputs.some(input => rootInputs.has(input.name)) ? profile.package.inputs.filter(input => rootInputs.has(input.name)).map(input => field(input)) : <>
        <div className="cad-plugin-root-value"><span><LockKeyhole size={10} /> Tool tip radius<CadContextHelp label="Rack tip radius" onOpenChange={open => helpSelection('cutterTipRadius', open)}>{explanation('cutterTipRadius', 'Rack tip radius', 'mm')}</CadContextHelp></span><output aria-label="Generating cutter tip radius">{displayValue(inspected.values.cutterTipRadius)}<small>mm</small></output></div>
        {configurableRootPackage && <><button type="button" className="cad-plugin-root-upgrade" onClick={() => {
          const next = createCadPluginProfile(configurableRootPackage);
          onChange({ ...next, inputs: { ...next.inputs, ...Object.fromEntries(next.package.inputs.filter(input => Object.hasOwn(profile.inputs, input.name)).map(input => [input.name, profile.inputs[input.name]])) } });
        }}>Configure tooth root</button>
        <small className="cad-plugin-root-upgrade-note">Adds root controls to this draft. Apply to keep them.</small></>}
      </>}
      <div className="cad-plugin-help-row">Rack-generated root transition<CadContextHelp label="Root transition" onOpenChange={open => helpSelection('cutterTipRadius', open)}>{explanation('cutterTipRadius', 'Generating cutter tip radius', 'mm')}<p>The tool tip radius controls the generated transition. The gear root has changing curvature, so it is not one circular fillet radius.</p></CadContextHelp></div>
    </details>}
    {generatedGear && <details className="cad-plugin-disclosure"><summary>Curve accuracy</summary>{profile.package.inputs.filter(input => accuracyInputs.has(input.name)).map(input => field(input))}<div className="cad-plugin-help-row">Maximum curve deviation · mm<CadContextHelp label="Curve representation" onOpenChange={open => helpSelection('tolerance', open)}><p>Involute tooth flanks and rack-generated root transitions are mathematical curves, not circular arcs. This app represents them with short straight chords whose maximum deviation stays within the applied accuracy.</p><p>Root-circle and tip-circle arcs remain exact. A smaller accuracy value adds chords as needed; it does not set a fixed segment count. The same profile geometry feeds solids and DXF export.</p><p>Automatic accuracy uses min(0.005 mm, module / 200). Custom accuracy is preserved while Automatic is selected.</p></CadContextHelp></div></details>}
    {profile.package.apiVersion === 2 && profile.package.rules.derived.length > 0 && <details className="cad-plugin-disclosure"><summary>Calculated dimensions</summary><dl className="cad-plugin-derived">{profile.package.rules.derived.filter(value => !isGear || gearDimensions.has(value.name) && !['pitchDiameter', 'tipDiameter', 'cutterTipRadius'].includes(value.name)).map(value => <div key={value.name}><dt>{value.label}<CadContextHelp label={value.label} onOpenChange={open => helpSelection(value.name, open)}>{isGear ? explanation(value.name, value.label, value.unit) : <><p>Calculated from the plugin's declared relation. Edit its inputs or linked document parameters to change it.</p><p><code>{value.name} = {value.expression}</code></p></>}</CadContextHelp></dt><dd><output aria-label={value.label} title="Calculated from profile inputs">{displayValue(inspected.values[value.name])}</output>{value.unit && <small>{value.unit}</small>}</dd></div>)}</dl></details>}
    {isGear && <details className="cad-plugin-disclosure"><summary>Module cutter guide</summary>
      <label className="cad-plugin-field"><span>Numbering</span><select aria-label="Cutter numbering" value={numbering} onChange={event => setNumbering(event.target.value)}><option value="">Choose the set convention</option><option value="ascending">No. 1 = 12–13 teeth</option><option value="descending">No. 8 = 12–13 teeth</option></select></label>
      <label className="cad-plugin-field"><span>Cutter</span><select aria-label="Cutter preset" disabled={!numbering || typeof profile.inputs.teeth === 'string' && !Number.isFinite(Number(profile.inputs.teeth)) && !(teethAlias && onChangeParameter)} value="" onChange={event => { if (teethAlias && onChangeParameter) onChangeParameter(teethAlias, event.target.value); else change('teeth', Number(event.target.value)); }}><option value="">Choose tooth range</option>{CAD_GEAR_CUTTER_RANGES.map((range, index) => <option key={range.low} value={Math.max(18, range.low) <= range.high ? Math.max(18, range.low) : range.low}>No. {numbering === 'ascending' ? index + 1 : 8 - index} · {range.low}–{range.high} teeth</option>)}</select></label>
      <div className="cad-plugin-help-row">Cutter numbers and tooth ranges<CadContextHelp label="Module cutter guide" onOpenChange={open => helpSelection('teeth', open)}><p>Check the tooth range stamped on your cutter. Eight-cutter sets use opposing numbering conventions, so the number alone does not determine the gear.</p><p>Selecting a range sets a starting tooth count, preserving any linked document parameter. Enter the exact count in Teeth. Compound expressions are edited through fx.</p><p>This rack-generated nominal profile does not reproduce an individual form cutter's manufacturing geometry.</p></CadContextHelp></div>
    </details>}
    <div className="cad-plugin-help-row">{profile.package.name} · v{profile.package.version}<CadContextHelp label="Profile details"><p>{profile.package.description}</p>{profile.package.notes && <p>{profile.package.notes}</p>}</CadContextHelp></div>
  </div>;
}
