#!/usr/bin/env node
/**
 * Reconcile a read-only CAD icon-inventory audit into the current icon catalog.
 *
 * Usage:
 *   node scripts/reconcile-icon-inventory.mjs --inventory <audit.json> [--markdown <inventory.md>]
 *   [--output-json <path>] [--output-markdown <path>]
 *
 * The supplied snapshot is read-only. Outputs default to docs/design/final-inventory-crosswalk.*.
 * Markdown contributes the expanded shared-renderer variant rows and renderer routes that are
 * intentionally not duplicated in the machine-readable audit JSON.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { iconSource } from './icon-source.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function args(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    if (key === '--help') { result.help = true; continue; }
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Missing value for ${key}`);
    result[key.slice(2)] = argv[++i];
  }
  return result;
}
const options = args(process.argv.slice(2));
if (options.help) {
  console.log('Usage: node scripts/reconcile-icon-inventory.mjs --inventory <audit.json> [--markdown <inventory.md>] [--output-json <path>] [--output-markdown <path>]');
  process.exit(0);
}
if (!options.inventory) throw new Error('--inventory <external audit.json> is required');
const inventoryPath = path.resolve(options.inventory);
const markdownPath = options.markdown ? path.resolve(options.markdown) : null;
const jsonOut = path.resolve(options['output-json'] || path.join(root, 'docs/design/final-inventory-crosswalk.json'));
const mdOut = path.resolve(options['output-markdown'] || path.join(root, 'docs/design/final-inventory-crosswalk.md'));
const currentIntegrationPath = options['current-integration']
  ? path.resolve(options['current-integration'])
  : path.join(root, 'docs/design/current-integration-audit.json');
const auditBytes = fs.readFileSync(inventoryPath);
const audit = JSON.parse(auditBytes.toString('utf8'));
const inventoryMarkdown = markdownPath ? fs.readFileSync(markdownPath, 'utf8') : '';
const priorPath = jsonOut;
const prior = fs.existsSync(priorPath) ? JSON.parse(fs.readFileSync(priorPath, 'utf8')) : null;
const currentIntegration = fs.existsSync(currentIntegrationPath)
  ? JSON.parse(fs.readFileSync(currentIntegrationPath, 'utf8')) : null;

const catalogIds = new Set(iconSource.map((x) => x.id));
const aliasIndex = new Map();
for (const entry of iconSource) for (const alias of entry.aliases || []) {
  const ids = aliasIndex.get(alias) || new Set(); ids.add(entry.id); aliasIndex.set(alias, ids);
}
function idsForAlias(alias) { return [...(aliasIndex.get(alias) || [])].sort(); }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function cleanText(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function contextOf(r) { return cleanText([r.expression, r.visibleText, r.containerText, r.declaration, r.renderer, r.arguments, r.callName].filter(Boolean).join(' | ')); }
function fromPrior(channel, id) { return prior?.rows?.find((r) => r.channel === channel && r.sourceId === id); }
function baseRow(channel, r, index) {
  const sourceId = r.id || `${channel}.${hash(`${r.file || ''}:${r.line || ''}:${r.column || ''}:${r.expression || r.selector || r.value || index}`).slice(0, 12)}`;
  const old = fromPrior(channel, sourceId);
  return {
    sourceId, channel, file: r.file || null, line: r.line ?? null, column: r.column ?? null,
    component: r.component || null, sourceKind: r.kind || (channel === 'imports' ? 'icon-import' : null),
    expression: r.expression || r.value || r.selector || r.declaration || null,
    context: contextOf(r), sourceAlias: r.alias || r.imported || old?.sourceAlias || null,
    sourceCanonical: r.canonical || old?.sourceCanonical || null,
    imported: r.imported || null, catalogIds: old?.catalogIds || (old?.catalogId ? [old.catalogId] : []),
    disposition: old?.disposition || null, reason: old?.reason || null,
    source: r,
  };
}
function setIncluded(row, ids, disposition, reason) {
  const unique = [...new Set(ids)].filter((id) => catalogIds.has(id));
  row.catalogIds = unique; row.disposition = disposition; row.reason = reason;
  if (unique.length === 1) row.catalogId = unique[0];
  return row;
}
function setExcluded(row, disposition, reason) {
  row.catalogIds = []; delete row.catalogId; row.disposition = disposition; row.reason = reason; return row;
}
function inferSemantic(r, channel, row) {
  const old = fromPrior(channel, row.sourceId);
  if (old?.catalogId) return setIncluded(row, [old.catalogId], old.disposition || 'mapped', old.reason || 'Reused exact stable-ID semantic mapping from the preceding immutable audit crosswalk.');
  if (old?.catalogIds?.length) return setIncluded(row, old.catalogIds, old.disposition || 'dynamic-variants', old.reason || 'Reused exact stable-ID variant mapping from the preceding immutable audit crosswalk.');
  const alias = r.alias || r.imported || null;
  const direct = idsForAlias(alias);
  if (direct.length) return setIncluded(row, direct, direct.length > 1 ? 'alias-candidates' : 'mapped', `Current catalog alias ${alias} resolves to ${direct.join(', ')}.`);
  return null;
}
function contextualSemantic(r) {
  const file = r.file || '';
  const ctx = `${r.expression || ''} ${r.visibleText || ''} ${r.containerText || ''} ${JSON.stringify(r.callArguments || [])} ${JSON.stringify(r.jsxParents || [])}`;
  const mapProperty = typeof r.mapProperty === 'string' ? r.mapProperty.replace(/^['"`]|['"`]$/g, '') : '';
  if (file.endsWith('EditorInspectorPanel.tsx') && r.alias === 'ArrowRightFromLine') return 'insert-points';
  if (file.endsWith('EditorProgramLinesPanel.tsx') && r.alias === 'ArrowRightFromLine') return 'start-point';
  if (file.endsWith('EditorGuideDialog.tsx') && r.alias === 'Crosshair') return 'locate';
  if (file.endsWith('AppShell.tsx') && r.alias === 'HardDrive') return 'wire-edm-mark';
  if (file.endsWith('CadFeatureTree.tsx') && mapProperty && mappings.feature[mapProperty]) return mappings.feature[mapProperty];
  if (file.endsWith('CadWorkbench.tsx') && r.callName === 'toolButton') {
    const label = String(r.callArguments?.[0] || '').replace(/^['"`]|['"`]$/g, '');
    const key = Object.keys(mappings.tools).find((candidate) => candidate.toLowerCase() === label.toLowerCase());
    if (key) return mappings.tools[key];
  }
  if (file.endsWith('CadPatternCommand.tsx')) {
    if (r.alias === 'Copy' && r.visibleText === 'Linear pattern') return 'linear-pattern';
    if (r.alias === 'RotateCw' && r.visibleText === 'Circular pattern') return 'circular-pattern';
    if (r.alias === 'Copy' && r.visibleText === 'Pattern') return 'pattern';
  }
  if (file.endsWith('SimulationViewport.tsx')) {
    if (/Simulation top view|title="Top view"/.test(ctx)) return 'view-top';
    if (/Fit machine and stock|Fit machine model/.test(ctx)) return 'fit-view';
    if (/Preparing the 3D workspace|Loading the renderer locally/.test(ctx)) return 'simulation';
  }
  if (file.endsWith('SimulationPanel.tsx') && r.alias === 'FileBox' && /Machine model settings/.test(ctx)) return 'machine-setup';
  if (file.endsWith('EditorPage.tsx') && r.alias === 'Box' && /label: 'Simulation', icon: <Box/.test(ctx)) return 'simulation';
  if (file.endsWith('EditorPathNavigatorPanel.tsx') && r.alias === 'Info' && /Contour Tree help/.test(ctx)) return 'help';
  if (['EditorInspectorPanel.tsx','EditorPreview.tsx'].some((name)=>file.endsWith(name)) && r.alias === 'Magnet') {
    if (r.controlAttributes?.['aria-label'] === '"Place measurement points on canvas"') return 'circle-center';
    if (r.controlAttributes?.['aria-label'] === '"Toggle preview grid snap"') return 'snap';
  }
  if (file.endsWith('CadContextHelp.tsx') && r.alias === 'Info') return 'help';
  if (file.endsWith('CadFeatureTree.tsx') && r.alias === 'Square' && (r.visibleText === 'Reference' || r.visibleText === 'plane')) return 'datum-plane';
  if (file.endsWith('CadViewport.tsx') && r.alias === 'Maximize2' && /Fit model/.test(r.containerText || '')) return 'fit-view';
  if (file.endsWith('CadViewport.tsx') && r.alias === 'Grid2X2' && /Toggle grid/.test(r.containerText || '')) return 'grid';
  if (file.endsWith('CadViewport.tsx') && r.alias === 'Box' && r.jsxParents?.some((p)=>p.tag==='CadViewTools')) return 'view';
  if (file.endsWith('CadWorkbench.tsx') && r.visibleText === 'Section for CAM') return 'section-cam';
  if (file.endsWith('CadWorkbench.tsx') && r.visibleText === 'Send sketch to CAM') return 'send-cam';
  if (file.endsWith('CadEdgeTreatmentCommand.tsx') && r.alias === 'CircleDot' && /Fillet/.test(r.visibleText || '')) return 'fillet';
  if (file.endsWith('CadEdgeTreatmentCommand.tsx') && r.alias === 'Scissors' && r.visibleText === 'Chamfer') return 'chamfer';
  if (file.endsWith('CadSketchProfilePanel.tsx') && r.alias === 'CircleDot' && r.visibleText === 'Fillet') return 'fillet';
  if (file.endsWith('CadWorkbench.tsx')) {
    if (r.visibleText === 'Capture view PNG') return 'camera-capture';
    if (r.visibleText === 'Rebuild model') return 'refresh';
  }
  return null;
}

const mappings = {
  feature: { 'datum-plane':'datum-plane', sketch:'sketch', curve:'curve', imported:'imported-body', extrude:'pad', pocket:'pocket', revolve:'revolve', loft:'loft', sweep:'sweep', fillet:'fillet', chamfer:'chamfer', shell:'shell', boolean:'boolean', transform:'move-3d', 'linear-pattern':'linear-pattern', 'circular-pattern':'circular-pattern', mirror:'mirror' },
  tools: { sketch:'sketch', plane:'datum-plane', curve:'curve', plugins:'add', select:'select', rectangle:'rectangle', circle:'circle', slot:'slot', polyline:'polyline', path:'closed-path', dimension:'measure', move:'move-3d', 'move profile':'move', 'pad / pocket':'pad-pocket', revolve:'revolve', loft:'loft', sweep:'sweep', fillet:'fillet', 'fillet / chamfer':'chamfer', chamfer:'chamfer', shell:'shell', boolean:'boolean', mirror:'mirror' },
};
const semanticOverrides = new Map([
  ['SettingsIcon','settings'], ['FileCode2','file-code'], ['GeometryIcon','geometry'],
  ['SimulationScanTop','view-top'], ['ScanLineFitmachine','fit-view'], ['CADviewselector','view'],
  ['CameraCapture','camera-capture'], ['CaptureCamera','camera-capture'], ['Rebuild','refresh'],
  ['CombinedPattern','pattern'], ['SimulationTab','simulation'], ['SimulationLoading','simulation'],
  ['MachineSetupFileBox','machine-setup'], ['WireEDMFavicon','wire-edm-mark'],
]);
const textGlyphs = new Map();
if (inventoryMarkdown) for (const line of inventoryMarkdown.split(/\r?\n/)) {
  const m = line.match(/^\| `(use\.[0-9a-f]{12})` \|.*?\| `([^`]+)` \| icon\.text\.([a-z-]+): ([^|]+)\|/);
  if (m) textGlyphs.set(m[1], { value:m[2], semantic:m[3], description:cleanText(m[4]) });
}

function rowsFor(channel, records, mapper) {
  return records.map((r, i) => mapper(baseRow(channel, r, i), r, i));
}
const channels = {};
channels.importBindings = rowsFor('importBindings', audit.imports || [], (row, r) => {
  const alias = r.alias || r.imported;
  const forced = semanticOverrides.get(alias);
  const ids = forced ? [forced] : idsForAlias(alias);
  if (!ids.length) return setExcluded(row, 'gap', `Imported alias ${alias} has no current catalog mapping.`);
  return setIncluded(row, ids, 'alias-candidates', `Imported ${r.alias || r.imported} from ${r.source}; catalog alias candidates: ${ids.join(', ') || '(none)'}.`);
});
channels.occurrences = rowsFor('occurrences', audit.occurrences || [], (row, r) => {
  if (r.file?.endsWith('EditorPathNavigatorPanel.tsx') && r.alias === 'Flag') {
    return setIncluded(row, ['lead-in', 'lead-out'], 'dynamic-variants', 'Lead tree rows select the matching interior lead direction icon from travelRole. The legacy flag did not distinguish entry from exit.');
  }
  const contextual = contextualSemantic(r);
  if (contextual && catalogIds.has(contextual)) return setIncluded(row, [contextual], 'semantic-override', `Contextual action/visual meaning in ${r.file}:${r.line} resolves to ${contextual}, overriding the generic imported glyph alias.`);
  const semantic = semanticOverrides.get(r.alias || '') || semanticOverrides.get(r.component || '');
  if (semantic && catalogIds.has(semantic)) return setIncluded(row, [semantic], 'semantic-override', `Semantic use in ${r.component || r.file} resolves to ${semantic}; this overrides generic source glyph identity.`);
  const reused = inferSemantic(r, 'occurrences', row); if (reused) return reused;
  const ids = idsForAlias(r.alias);
  if (ids.length) return setIncluded(row, ids, ids.length > 1 ? 'alias-candidates' : 'mapped', `Current catalog alias ${r.alias} resolves to ${ids.join(', ')}.`);
  return setExcluded(row, 'gap', 'No current catalog semantic mapping found; requires review.');
});
channels.dynamicSlots = rowsFor('dynamicSlots', audit.dynamicSlots || [], (row, r) => {
  const priorRow = fromPrior('dynamicSlots', row.sourceId);
  const slotVariants = {
    'use.ff7ede67da54':['browser-cache','adjust','body'],
    'use.560ea95b7eba':['cam-editor','simulation'],
    'use.526981a64633':['info','link','close','help'],
    'use.575772b2f782':Object.values(mappings.feature),
    'use.ca1d7d33f3d0':['sketch','datum-plane','curve','add','select','rectangle','circle','slot','polyline','closed-path','measure','move','pad-pocket','revolve','loft','sweep','fillet','chamfer','shell','boolean','move-3d','mirror','linear-pattern','circular-pattern','pattern'],
    'use.1e307a885857':['expand-right','expand-down'],
    'use.29a204b4a6e6':['expand-right','expand-down'],
    'use.73945173632f':['panel-right-open'],
  };
  if (slotVariants[row.sourceId]) return setIncluded(row, slotVariants[row.sourceId], 'dynamic-variants', `Dynamic slot targets: ${slotVariants[row.sourceId].join(', ')}. Concrete uses are linked through occurrence and renderer-route rows.`);
  if (priorRow?.catalogIds?.length) return setIncluded(row, priorRow.catalogIds, 'dynamic-variants', priorRow.reason);
  if (/icons\[feature\.kind\]/.test(r.declaration || r.expression || '') || /feature\.kind/.test(r.declaration || '')) return setIncluded(row, Object.values(mappings.feature), 'dynamic-variants', `Feature-kind dispatch maps all 17 known persisted kinds: ${Object.entries(mappings.feature).map(([k,v])=>`${k}→${v}`).join(', ')}.`);
  if (/toastIcon|toast\.type|notification\.type/.test(contextOf(r))) return setIncluded(row, ['success','error','warning','info'], 'dynamic-variants', 'Status renderer selects the success, error, warning, and info catalog glyphs.');
  const name = `${r.component || ''} ${r.declaration || ''} ${r.expression || ''}`;
  if (/SectionButton|icon\s*\}/.test(name)) return setIncluded(row, ['browser-cache','adjust','body','machine-setup','save','settings'], 'dynamic-slot', 'Reusable section icon prop; concrete call sites are mapped separately in sharedGraphicCalls.');
  if (/triggerContent/.test(name) && /<Info/.test(name)) return setIncluded(row, ['info'], 'dynamic-variants', 'Fallback trigger renders Info only when caller-supplied triggerContent is absent; plugin relation content is inventoried at its source call sites.');
  const reused = inferSemantic(r, 'dynamicSlots', row); if (reused) return reused;
  return setExcluded(row, 'excluded-dynamic-state', 'Dynamic slot carries non-pictogram state or its concrete variants are separately inventoried.');
});
channels.renderCalls = rowsFor('renderCalls', audit.renderCalls || [], (row, r) => {
  const reused = inferSemantic(r, 'renderCalls', row); if (reused) return reused;
  if (/toastIcon|status.*icon/i.test(contextOf(r))) return setIncluded(row, ['success','error','warning','info'], 'dynamic-variants', 'Status renderer chooses one of the four explicitly inventoried severity glyphs.');
  return setExcluded(row, 'excluded-control-renderer', 'Shared renderer defines layout, formatting, or interaction; icon-bearing call-site variants are inventoried in occurrences/routes.');
});
channels.sharedGraphicCalls = rowsFor('sharedGraphicCalls', audit.sharedGraphicCalls || [], (row, r) => {
  const reused = inferSemantic(r, 'sharedGraphicCalls', row); if (reused) return reused;
  const expression = contextOf(r);
  const named = /icon=\{\s*<([A-Z][A-Za-z0-9]*)/.exec(expression)?.[1];
  if (named) { const ids = idsForAlias(named); if (ids.length) return setIncluded(row, ids, 'shared-control-variant', `Call-site icon prop ${named} resolves to ${ids.join(', ')}.`); }
  return setExcluded(row, 'excluded-control-call', 'Shared form/help/control call has no independent icon prop; its concrete icon children are separately inventoried.');
});
channels.graphics = rowsFor('graphics', audit.graphics || [], (row, r) => {
  const old = fromPrior('graphics', row.sourceId);
  if (old?.catalogId) return setIncluded(row, [old.catalogId], old.disposition, old.reason);
  if (/favicon|index\.html/i.test(`${r.file} ${r.expression}`)) return setIncluded(row, ['wire-edm-mark'], 'mapped-brand-asset', 'Inline app favicon uses the existing Wire EDM brand mark catalog entry.');
  return setExcluded(row, /logo|poster|onboarding/i.test(`${r.file} ${r.expression}`) ? 'excluded-illustration' : 'excluded-geometry-visualization', 'Graphic is a content illustration, state decoration, or exact model/sketch visualization rather than a reusable control pictogram.');
});
channels.primitives = rowsFor('primitives', audit.primitives || [], (row) => setExcluded(row, 'excluded-svg-primitive', 'SVG primitive is geometry, measurement, diagram, or scene drawing rather than an independent reusable icon.'));
channels.programmaticGraphics = rowsFor('programmaticGraphics', audit.programmaticGraphics || [], (row) => setExcluded(row, 'excluded-scene-graphic', 'Programmatic Three.js scene, grid, axis, model, or renderer helper is viewport geometry, not a UI pictogram.'));
channels.cursorLocations = rowsFor('cursorLocations', audit.cursorLocations || [], (row) => setExcluded(row, 'excluded-interaction-cursor', 'Browser cursor class communicates pointer/drag/resize interaction through native cursor affordance; it is not an icon glyph.'));
channels.cssVisuals = rowsFor('cssVisuals', audit.cssVisuals || [], (row, r) => setExcluded(row, /cursor/i.test(`${r.selector} ${r.declarations}`) ? 'excluded-interaction-cursor' : 'excluded-css-decoration', 'CSS selector/declaration changes styling, cursor behavior, transition, or status decoration; no standalone catalog glyph is rendered.'));
channels.nativeControls = rowsFor('nativeControls', audit.nativeControls || [], (row) => setExcluded(row, 'excluded-native-control', 'Native HTML control or control affordance; represented by browser semantics and not a custom icon definition.'));
channels.glyphCandidates = rowsFor('glyphCandidates', audit.glyphCandidates || [], (row, r) => {
  const textGlyph = textGlyphs.get(row.sourceId);
  if (textGlyph) {
    const value = textGlyph.value;
    const id = textGlyph.semantic === 'warning' ? 'warning'
      : textGlyph.semantic === 'pagination' ? (value.includes('‹') ? 'navigate-back' : 'navigate-forward')
      : textGlyph.semantic === 'expression' ? 'link'
      : textGlyph.semantic === 'disclosure' ? (value.includes('▾') ? 'expand-down' : 'expand-right')
      : textGlyph.semantic === 'tree-toggle' ? (value.includes('−') ? 'expand-down' : 'expand-right')
      : textGlyph.semantic === 'rail-chevron' ? (value.includes('›') ? 'panel-left-open' : 'panel-left-close')
      : textGlyph.semantic === 'lens-letter' ? (value === 'P' ? 'file-code' : 'geometry')
      : textGlyph.semantic === 'menu-back' ? 'navigate-back' : null;
    if (id && catalogIds.has(id)) return setIncluded(row, [id], 'mapped-text-icon', `External classification ${textGlyph.semantic}: ${textGlyph.description}; maps the actionable symbol to ${id}.`);
    return setExcluded(row, 'excluded-text-state', `External classification ${textGlyph.semantic}: ${textGlyph.description}; scene/state marker is not a standalone catalog icon.`);
  }
  const reused = inferSemantic(r, 'glyphCandidates', row); if (reused) return reused;
  return setExcluded(row, 'excluded-text-notation', 'Text/math/parser/status copy; punctuation, units, coordinates, or wording is not a pictogram.');
});
channels.assets = rowsFor('assets', audit.assets || [], (row, r) => setExcluded(row, 'excluded-content-asset', `Raster content asset (${r.bytes} bytes, sha256 ${r.sha256}); retained as content artwork rather than converted into a UI icon.`));

function markdownTableRows(markdown, headingRegex, rowRegex) {
  const start = markdown.search(headingRegex);
  if (start < 0) return [];
  const tail = markdown.slice(start);
  const sectionEnd = tail.search(/\n##?\s/);
  const section = sectionEnd >= 0 ? tail.slice(0, sectionEnd) : tail;
  return section.split(/\r?\n/).map((line) => lineRegex.exec(line)).filter(Boolean);
}
const expanded = [];
if (inventoryMarkdown) {
  for (const match of inventoryMarkdown.matchAll(/^\| `(use\.[0-9a-f]{12}\.([^`]+))` \|(.+)$/gm)) {
    const sourceId = match[1], variant = match[2], raw = match[3].split('|').map((x) => x.trim());
    const variantMap = {
      'chevron-down':'expand-down', 'chevron-right':'expand-right', 'panel-right-open':'panel-right-open',
      success:'success', error:'error', warning:'warning', info:'info', 'help-close':'close', 'help-info':'help',
      'scalar-help':'help', 'scalar-help-close':'close', imported:'imported-body', extrude:'pad', transform:'move-3d',
      sketch:'sketch', curve:'curve', 'datum-plane':'datum-plane', pocket:'pocket', revolve:'revolve', loft:'loft', sweep:'sweep',
      fillet:'fillet', chamfer:'chamfer', shell:'shell', boolean:'boolean', 'linear-pattern':'linear-pattern', 'circular-pattern':'circular-pattern', mirror:'mirror',
    };
    const id = variantMap[variant] || null;
    expanded.push({
      sourceId, channel:'expandedVariants', parentSourceId:sourceId.slice(0, 16), variant,
      file:(raw[0].match(/\[([^:\]]+):\d+(?::\d+)?\]/) || [])[1] || null,
      context: raw.slice(1,4).join(' | '), semantic: raw[4] || '', sourceRow: raw,
      catalogIds: id ? [id] : [], disposition: id ? 'mapped-variant' : 'gap',
      reason: id ? `Expanded renderer variant ${variant} maps to ${id}.` : `No explicit semantic mapping for expanded renderer variant ${variant}.`,
    });
  }
}

const routeRows = [];
if (inventoryMarkdown) {
  const sectionAt = inventoryMarkdown.indexOf('Variant routes:');
  const tableAt = inventoryMarkdown.indexOf('| Renderer call | Location / context | Arguments / action | Accessible route |', sectionAt);
  if (tableAt >= 0) {
    const sectionEnd = inventoryMarkdown.indexOf('\n## ', tableAt);
    const block = inventoryMarkdown.slice(tableAt, sectionEnd >= 0 ? sectionEnd : undefined);
    for (const line of block.split(/\r?\n/).filter((x) => /^\| `use\.[^`]+` \|/.test(x))) {
      const cols = line.slice(1,-1).split('|').map((x) => x.trim());
      const sid = cols[0].replaceAll('`','');
      const routeId = sid.match(/^use\.[0-9a-f]{12}(?:\.([a-z0-9-]+))?$/)?.[1];
      const mapped = routeId ? expanded.find((x) => x.sourceId === sid)?.catalogIds : [];
      const priorOcc = prior?.rows?.find((r) => r.sourceId === sid && r.catalogId)?.catalogId;
      const sourceRows = Object.values(channels).flat().filter((r) => r.sourceId === sid);
      const targets = mapped?.length ? mapped : sourceRows.flatMap((r) => r.catalogIds || []);
      const useTargets = targets.length ? targets : priorOcc ? [priorOcc] : [];
      const sourceReason = sourceRows.find((r)=>r.reason)?.reason;
      routeRows.push({ sourceId:sid, channel:'rendererRoutes', route:cols[1], context:cols[2], arguments:cols[3], accessibleRoute:cols[4], catalogIds:[...new Set(useTargets)], disposition:useTargets.length?'routed':'excluded-route', reason:useTargets.length?'Route points to an inventoried catalog semantic.':sourceReason || 'Renderer route is informational/helper behavior; no independent pictogram is introduced.' });
    }
  }
}
const variantRoutesText = inventoryMarkdown.match(/Variant routes:\s*\n([\s\S]*?)\n\| Renderer call \|/)?.[1] || '';
const routeGuidance = variantRoutesText.split(/\r?\n/).filter((x) => /^- /.test(x)).map((x) => x.slice(2).trim());

const expandedCounts = {
  expandedVariants: expanded.length,
  rendererRoutes: routeRows.length,
  routeGuidance: routeGuidance.length,
};
const expectedExpanded = Number(inventoryMarkdown.match(/\|\s*Expanded shared-renderer variant rows, additional to direct bindings\s*\|\s*(\d+)/i)?.[1] || 0);
const expectedRoutes = (audit.renderCalls || []).length + (audit.sharedGraphicCalls || []).length;
const glyphCandidateIds = new Set((audit.glyphCandidates || []).map((r)=>r.id));
const missingTextClassificationIds = [...textGlyphs.keys()].filter((id)=>!glyphCandidateIds.has(id));
const occurrenceById = new Map(channels.occurrences.map((r)=>[r.sourceId,r]));
const featureBindingRows = (audit.occurrences || []).filter((r)=>r.file?.endsWith('CadFeatureTree.tsx') && r.mapProperty);
const featureMismatches = featureBindingRows.flatMap((r)=>{
  const key = String(r.mapProperty).replace(/^['"`]|['"`]$/g, '');
  const expected = mappings.feature[key];
  const actual = occurrenceById.get(r.id)?.catalogId;
  return expected && actual !== expected ? [{ sourceId:r.id, featureKind:key, expected, actual:actual || null }] : [];
});
const toolButtonRows = (audit.occurrences || []).filter((r)=>r.file?.endsWith('CadWorkbench.tsx') && r.callName === 'toolButton');
const toolButtonMismatches = toolButtonRows.flatMap((r)=>{
  const label = String(r.callArguments?.[0] || '').replace(/^['"`]|['"`]$/g, '');
  const key = Object.keys(mappings.tools).find((candidate)=>candidate.toLowerCase()===label.toLowerCase());
  const expected = key ? mappings.tools[key] : null;
  const actual = occurrenceById.get(r.id)?.catalogId;
  return expected && actual !== expected ? [{ sourceId:r.id, toolButton:label, expected, actual:actual || null }] : [];
});
const variantParentMismatches = expanded.flatMap((r)=>{
  const parent = [...(channels.dynamicSlots || []), ...(channels.renderCalls || [])].find((candidate)=>candidate.sourceId===r.parentSourceId);
  return parent?.catalogIds?.length && !parent.catalogIds.includes(r.catalogIds[0])
    ? [{ sourceId:r.sourceId, parentSourceId:r.parentSourceId, expectedOneOf:parent.catalogIds, actual:r.catalogIds[0] }] : [];
});
const exactSemanticExpectations = [
  ['use.0b1978b5a87b','fillet'], ['use.07e7fdc0245c','fillet'], ['use.f981c2c08004','chamfer'], ['use.fc42ade3967c','fillet'],
  ['use.1347774db40e','revolve'], ['use.6c84f5504736','loft'], ['use.3ffd3b024538','sweep'], ['use.9ce98e0beeb3','boolean'],
  ['use.1b4373040eb9','pattern'], ['use.c64fb6db37f0','linear-pattern'], ['use.ca37ba8f0761','circular-pattern'],
  ['use.3b585d03403a','camera-capture'], ['use.0cd36f04fccd','refresh'], ['use.e1e7cd9ccf49','fit-view'],
  ['use.31370f9c4b32','view-top'], ['use.872f3157397b','fit-view'], ['use.633c9f62767a','machine-setup'],
  ['use.ac4e2349bd2a','simulation'], ['use.2c9511b19310','locked'], ['use.cd64ca9e6fe7','link'],
  ['use.fd11477e899b','fit-view'], ['use.915c2834aa5d','grid'], ['use.ebfc71d9bb7f','datum-plane'],
  ['use.41090c5821df','datum-plane'], ['use.ece394eff765','section-cam'], ['use.1368999d2fba','send-cam'], ['use.28edd08da582','help'],
  ['use.aa22e4024d24','insert-points'], ['use.4dca56b9193d','start-point'], ['use.acb4ec7916e2','locate'], ['use.351faffd1991','wire-edm-mark'],
  ['use.040fa55fc9cc','help'],
  ['use.620dbb21888c','circle-center'], ['use.224e71e5aace','circle-center'],
  ['use.cbc57f4ad9fc','snap'],
  ['use.e3f18103db30','select'], ['use.dd2dd9712e41','close'], ['use.b4f8886ae6a6','close'],
  ['use.0d302f8f9511','confirm'], ['use.1de7a7ef0b1e','confirm'], ['use.21c4b349b376','confirm'],
];
const exactSemanticMismatches = exactSemanticExpectations.flatMap(([sourceId,expected])=>{
  const actual = occurrenceById.get(sourceId)?.catalogId;
  return actual === expected ? [] : [{ sourceId, expected, actual:actual || null }];
});
const dynamicLeadExpectation = { sourceId:'use.7bb20f269b9d', file:'src/features/editor/EditorPathNavigatorPanel.tsx', symbols:[['LeadInIcon','lead-in'],['LeadOutIcon','lead-out']] };
const dynamicLeadRow = occurrenceById.get(dynamicLeadExpectation.sourceId);
const currentDynamicLead = currentIntegration?.occurrences?.find((r)=>r.originFile===dynamicLeadExpectation.file && r.originalSymbol==='Flag');
const dynamicLeadActuals = [currentDynamicLead?.matchedCurrent, ...(currentIntegration?.unmatchedCurrent || []).filter((r)=>r.file===dynamicLeadExpectation.file && ['LeadInIcon','LeadOutIcon'].includes(r.symbol))]
  .filter(Boolean).map((r)=>[r.exportedSymbol || r.symbol, r.catalogId]);
const dynamicLeadMismatches = !dynamicLeadRow || dynamicLeadRow.disposition!=='dynamic-variants'
  || dynamicLeadExpectation.symbols.some(([symbol,id])=>!dynamicLeadRow.catalogIds?.includes(id) || !dynamicLeadActuals.some(([actualSymbol,actualId])=>actualSymbol===symbol && actualId===id))
  ? [{ sourceId:dynamicLeadExpectation.sourceId, expected:dynamicLeadExpectation.symbols, mapped:dynamicLeadRow?.catalogIds || [], current:dynamicLeadActuals }]
  : [];
const semanticChecks = {
  featureBindings:{ expected:17, actual:featureBindingRows.length, mismatches:featureMismatches },
  toolButtons:{ expected:toolButtonRows.length, actual:toolButtonRows.filter((r)=>Object.keys(mappings.tools).some((key)=>key.toLowerCase()===String(r.callArguments?.[0]||'').replace(/^['"`]|['"`]$/g,'').toLowerCase())).length, mismatches:toolButtonMismatches },
  expandedVariantParents:{ checked:expanded.filter((r)=>[...channels.dynamicSlots,...channels.renderCalls].some((p)=>p.sourceId===r.parentSourceId && p.catalogIds?.length)).length, mismatches:variantParentMismatches },
  targetedSemantics:{ expected:exactSemanticExpectations.length, mismatches:exactSemanticMismatches },
  dynamicLeadPair:{ expected:dynamicLeadExpectation.symbols, checkedSourceId:dynamicLeadExpectation.sourceId, current:dynamicLeadActuals, mismatches:dynamicLeadMismatches },
};
semanticChecks.complete = featureBindingRows.length === 17 && featureMismatches.length === 0 && semanticChecks.toolButtons.actual === semanticChecks.toolButtons.expected && toolButtonMismatches.length === 0 && variantParentMismatches.length === 0 && exactSemanticMismatches.length === 0 && dynamicLeadMismatches.length === 0;
const completenessChecks = {
  markdownSupplied:Boolean(markdownPath),
  expandedVariants:{ expected:expectedExpanded, actual:expanded.length, matches:expectedExpanded === expanded.length },
  rendererRoutes:{ expected:expectedRoutes, actual:routeRows.length, matches:expectedRoutes === routeRows.length },
  textClassifications:{ expected:textGlyphs.size, presentInGlyphChannel:textGlyphs.size-missingTextClassificationIds.length, missingIds:missingTextClassificationIds },
  semanticChecks,
};
completenessChecks.complete = Boolean(markdownPath) && completenessChecks.expandedVariants.matches && completenessChecks.rendererRoutes.matches && missingTextClassificationIds.length === 0 && semanticChecks.complete;
const allMain = Object.values(channels).flat();
const gapRows = [...allMain, ...expanded].filter((r) => r.disposition === 'gap' || !r.disposition || ((r.disposition.startsWith('mapped') || ['semantic-override','alias-candidates','dynamic-variants','dynamic-slot','shared-control-variant'].includes(r.disposition)) && !(r.catalogIds || []).length));
const missingIds = [...new Set([...allMain, ...expanded].flatMap((r) => r.catalogIds || []).filter((id) => !catalogIds.has(id)))];
const counts = Object.fromEntries(Object.entries(channels).map(([k, rows]) => [k, {
  total:rows.length, included:rows.filter((r) => (r.catalogIds || []).length > 0).length,
  excluded:rows.filter((r) => !(r.catalogIds || []).length && r.disposition !== 'gap').length,
  gap:rows.filter((r) => r.disposition === 'gap').length,
  dispositions:Object.fromEntries([...new Set(rows.map((r) => r.disposition))].sort().map((d) => [d, rows.filter((r) => r.disposition === d).length])),
}]));
counts.expandedVariants = {
  total:expanded.length, included:expanded.filter((r)=>(r.catalogIds||[]).length).length,
  excluded:expanded.filter((r)=>!(r.catalogIds||[]).length && r.disposition!=='gap').length,
  gap:expanded.filter((r)=>r.disposition==='gap').length,
  dispositions:Object.fromEntries([...new Set(expanded.map((r)=>r.disposition))].sort().map((d)=>[d,expanded.filter((r)=>r.disposition===d).length])),
};
counts.rendererRoutes = {
  total:routeRows.length, included:routeRows.filter((r)=>(r.catalogIds||[]).length).length,
  excluded:routeRows.filter((r)=>!(r.catalogIds||[]).length && r.disposition!=='gap').length,
  gap:routeRows.filter((r)=>r.disposition==='gap').length,
  dispositions:Object.fromEntries([...new Set(routeRows.map((r)=>r.disposition))].sort().map((d)=>[d,routeRows.filter((r)=>r.disposition===d).length])),
};
const sourceHashManifest = audit.sourceHashes || {};
const sourceHashDigest = hash(JSON.stringify(Object.fromEntries(Object.entries(sourceHashManifest).sort(([a],[b])=>a.localeCompare(b)))));
const priorHashManifest = prior?.externalInventory?.sourceHashes || null;
const sourceHashDelta = priorHashManifest ? {
  baselineInventorySha256:prior?.externalInventory?.auditSha256 || null,
  sameInventorySnapshot:prior?.externalInventory?.auditSha256 === hash(auditBytes),
  baselineDigest:hash(JSON.stringify(Object.fromEntries(Object.entries(priorHashManifest).sort(([a],[b])=>a.localeCompare(b))))),
  added:Object.keys(sourceHashManifest).filter((p)=>!(p in priorHashManifest)).sort(),
  removed:Object.keys(priorHashManifest).filter((p)=>!(p in sourceHashManifest)).sort(),
  changed:Object.keys(sourceHashManifest).filter((p)=>p in priorHashManifest && sourceHashManifest[p]!==priorHashManifest[p]).sort(),
} : { baselineInventorySha256:null, sameInventorySnapshot:false, baselineDigest:null, added:null, removed:null, changed:null, note:'Prior crosswalk did not retain a sourceHashes manifest; first complete-manifest comparison will occur on the next reconciliation.' };
const catalogAliases = iconSource.reduce((n, x) => n + (x.aliases || []).length, 0);
const inventorySha256 = hash(auditBytes);
const markdownSha256 = markdownPath ? hash(fs.readFileSync(markdownPath)) : null;
const includedRows = [...allMain, ...expanded].filter((r) => (r.catalogIds || []).length);
const summary = {
  mainRows:allMain.length, expandedVariants:expanded.length, auditedRows:allMain.length + expanded.length,
  routeRows:routeRows.length, routeGuidance:routeGuidance.length,
  includedRows:includedRows.length, excludedRows:allMain.length + expanded.length - includedRows.length - gapRows.length,
  gapRows:gapRows.length, importAliasGaps:channels.importBindings.filter((r)=>(r.catalogIds||[]).length===0).length,
  missingCatalogIds:missingIds, actualGapRows:gapRows.length,
  completenessChecks,
  currentCatalogEntries:iconSource.length, currentCatalogAliases:catalogAliases,
  sourceHashCount:Object.keys(sourceHashManifest).length, sourceHashDigest,
  channelCoverage:counts,
};
const out = {
  schemaVersion:2, generatedAt:new Date().toISOString(),
  externalInventory:{ path:inventoryPath, generatedAt:audit.generatedAt, revision:audit.revision, dirtyStateCount:(audit.dirtyState||[]).length, productionFileCount:audit.productionFileCount, parsedCodeFileCount:audit.parsedCodeFileCount, fixtureFileCount:audit.fixtureFileCount, canonicalLibraryDrawings:(audit.packageDefinitions||[]).length, distinctImportedExportNames:new Set((audit.imports||[]).map((r)=>r.imported)).size, resolvedIconReferences:(audit.occurrences||[]).length, expandedVariants:expanded.length, sourceHashCount:Object.keys(sourceHashManifest).length, sourceHashDigest, sourceHashes:sourceHashManifest, auditSha256:inventorySha256, markdownPath, markdownSha256 },
  currentCatalog:{ source:'scripts/icon-source.mjs', entries:iconSource.length, aliasCount:catalogAliases, ids:iconSource.map((x)=>x.id) },
  channelCounts:counts, supplementalCounts:expandedCounts, summary, channels,
  expandedVariants:expanded, rendererRoutes:routeRows, routeGuidance,
  currentCheckoutIntegration:currentIntegration ? {
    source:currentIntegrationPath, generatedAt:currentIntegration.generatedAt,
    currentSource:currentIntegration.currentSource, reconciliation:currentIntegration.reconciliation,
    occurrences:currentIntegration.occurrences, unmatchedCurrent:currentIntegration.unmatchedCurrent,
    note:'Separate current-checkout audit. These resolved occurrences do not alter external snapshot totals and do not mean unintegrated source changes were copied into this checkout.',
  } : { source:null, note:'No current-checkout integration audit supplied; this is independent of external snapshot reconciliation.' },
  sourceHashDelta,
  provenanceNote:'This crosswalk reconciles an immutable external CAD inventory snapshot against the current catalog. It is merge-forward mapping guidance, not proof that external CAD changes are integrated. Current-checkout integration remains separately audited.',
};
fs.mkdirSync(path.dirname(jsonOut), { recursive:true });
fs.writeFileSync(jsonOut, JSON.stringify(out, null, 2) + '\n');

const lines = [
  '# Final external inventory crosswalk', '',
  `Generated ${out.generatedAt}. External snapshot ${audit.generatedAt}; revision \`${audit.revision}\`; audit SHA-256 \`${inventorySha256}\`; source-hash manifest ${Object.keys(sourceHashManifest).length} files / digest \`${sourceHashDigest}\`.`,
  `The source checkout is read-only for this task and the inventory snapshot is immutable. Current catalog: ${iconSource.length} IDs and ${catalogAliases} aliases. This is merge-forward guidance; current checkout integration is reported separately.`, '',
  `The crosswalk covers ${summary.mainRows} structured audit rows plus ${expanded.length} additional expanded variants (${summary.auditedRows} rows total), and ${routeRows.length} renderer route relations (${routeGuidance.length} route summaries). Gaps: ${summary.gapRows}; import alias gaps: ${summary.importAliasGaps}; missing catalog IDs: ${missingIds.length}.`, '',
  `Coverage completeness: ${completenessChecks.complete ? 'complete' : 'PARTIAL'}; expected/actual expanded variants ${expectedExpanded}/${expanded.length}; expected/actual route relations ${expectedRoutes}/${routeRows.length}; missing text-classification rows ${missingTextClassificationIds.length}.`, '',
  '## Coverage by inventory channel', '',
  '| Channel | Total | Included | Excluded | Gaps | Dispositions |', '|---|---:|---:|---:|---:|---|',
  ...Object.entries(counts).map(([name,c])=>`| ${name} | ${c.total} | ${c.included} | ${c.excluded} | ${c.gap} | ${Object.entries(c.dispositions).map(([d,n])=>`${d}: ${n}`).join('; ')} |`), '',
  '## Supplemental expanded variants and routes', '',
  `Expanded variants: ${expanded.length}; renderer routes: ${routeRows.length}; prose route summaries: ${routeGuidance.length}.`,
  `Unmapped expanded variants: ${expanded.filter((x)=>x.disposition==='gap').length}.`, '',
  '## CAD dynamic feature map', '',
  '| Feature kind | Catalog ID |', '|---|---|',
  ...Object.entries(mappings.feature).map(([k,v])=>`| ${k} | ${v} |`), '',
  '## Snapshot provenance and refresh', '',
  `- Audit JSON: \`${inventoryPath}\``,
  ...(markdownPath ? [`- Inventory Markdown: \`${markdownPath}\``] : ['- Inventory Markdown was not supplied; expanded variants and renderer routes are unavailable in this run.']),
  '- The `sourceHashes` manifest is retained verbatim. Compare `sourceHashDigest` across snapshots to identify source-set/hash changes.',
  `- Source hash delta: ${sourceHashDelta.note || `${sourceHashDelta.sameInventorySnapshot ? 'same audit snapshot as prior reconciliation' : `baseline audit SHA ${sourceHashDelta.baselineInventorySha256}`}; ${sourceHashDelta.added.length} added, ${sourceHashDelta.removed.length} removed, ${sourceHashDelta.changed.length} changed. Future runs compare against the stored sourceHashes manifest.`}`,
  '- Reproduce with `node scripts/reconcile-icon-inventory.mjs --inventory <audit.json> --markdown <inventory.md>`.',
  ...(currentIntegration ? [`- Current-checkout integration audit ${currentIntegration.generatedAt}: ${currentIntegration.reconciliation.resolvedOriginOccurrences} resolved origin references; ${currentIntegration.reconciliation.unmatchedCurrentReferences} current references remain unmatched. Its rows are stored separately in JSON.`] : []),
  '- The immutable external snapshot does not assert that newer CAD source changes are integrated on this branch.', '',
  '## Route guidance', '', ...routeGuidance.map((x)=>`- ${x}`), '',
];
fs.mkdirSync(path.dirname(mdOut), { recursive:true });
const esc = (value) => cleanText(value).replaceAll('|', '\\|').replaceAll('\n', ' ').slice(0, 320);
const detailTable = (title, rows, getLocation) => [
  `## ${title}`, '', '| Stable ID | Location | Context / semantic | Catalog ID or exclusion | Rationale |', '|---|---|---|---|---|',
  ...rows.map((r)=>`| \`${r.sourceId}\` | ${esc(getLocation(r))} | ${esc(r.context || r.expression || r.variant || r.channel)} | ${r.catalogIds?.length ? r.catalogIds.join(', ') : `EXCLUDED — ${r.disposition}`} | ${esc(r.reason)} |`), '',
];
const fullDetails = [];
for (const [channel, rows] of Object.entries(channels)) fullDetails.push(...detailTable(channel, rows, (r)=>`${r.file || '—'}${r.line == null ? '' : `:${r.line}`}`));
fullDetails.push(...detailTable('Expanded renderer variants', expanded, (r)=>`${r.file || 'see linked Markdown source row'} (${r.variant})`));
fullDetails.push(...detailTable('Renderer routes (supplemental relationships)', routeRows, (r)=>r.route));
fs.writeFileSync(mdOut, [...lines, '## Full row-by-row crosswalk', '', 'The following tables give each structured audit row, each additional variant row, and each supplemental renderer-route relationship a catalog mapping or an explicit exclusion rationale.', '', ...fullDetails].join('\n'));
console.log(JSON.stringify({ jsonOut, mdOut, summary }, null, 2));
if (summary.gapRows || missingIds.length || !completenessChecks.complete) process.exitCode = 2;
