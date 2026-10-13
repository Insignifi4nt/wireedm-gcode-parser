import { describe, expect, it } from 'vitest';
import { CAD_PANEL_LIMITS, DEFAULT_CAD_PANEL_PREFERENCES, cadPanelLayout, changeCadPanelPreference, type CadPanelPreferences } from './cadPanelLayout';

describe('CAD responsive panel widths', () => {
  it('keeps preferred widths through collapse and responsive clamps without consuming the canvas', () => {
    const preferences: CadPanelPreferences = { tree: 420, properties: 520, priority: 'properties' };
    expect(cadPanelLayout(1440, preferences, true)).toMatchObject({ treeWidth: 420, propertiesWidth: 520 });
    expect(cadPanelLayout(1024, preferences, true)).toMatchObject({ treeWidth: 180, propertiesWidth: 356 });
    expect(cadPanelLayout(1024, preferences, false)).toMatchObject({ treeWidth: 420 });
    expect(cadPanelLayout(1440, preferences, true)).toMatchObject({ treeWidth: 420, propertiesWidth: 520 });
    expect(preferences).toEqual({ tree: 420, properties: 520, priority: 'properties' });
  });
  it('prioritizes the rail explicitly resized without rewriting the other preference', () => {
    const preferences = changeCadPanelPreference({ tree: 420, properties: 520, priority: 'properties' }, 'tree', 190);
    expect(preferences).toEqual({ tree: 190, properties: 520, priority: 'tree' });
    expect(cadPanelLayout(1024, preferences, true)).toMatchObject({ treeWidth: 190, propertiesWidth: 346 });
    expect(cadPanelLayout(1440, preferences, true)).toMatchObject({ treeWidth: 190, propertiesWidth: 520 });
    expect(changeCadPanelPreference(preferences, 'properties', 999)).toEqual({ tree: 190, properties: 520, priority: 'properties' });
  });
  it('bounds both separator ranges and reserves usable canvas across desktop sizes and priorities', () => {
    for (const workspace of [1024, 1050, 1100, 1280, 1440, 1920]) for (const tree of [180, 220, 420]) for (const properties of [240, 272, 520])
      for (const priority of ['tree', 'properties'] satisfies CadPanelPreferences['priority'][]) for (const visible of [false, true]) {
        const layout = cadPanelLayout(workspace, { tree, properties, priority }, visible);
        if (layout.kind !== 'resizable') throw new Error('Desktop layout expected');
        const occupied = layout.treeWidth + (visible ? layout.propertiesWidth : 0) + CAD_PANEL_LIMITS.separatorWidth * (visible ? 2 : 1);
        expect(workspace - occupied).toBeGreaterThanOrEqual(CAD_PANEL_LIMITS.canvasMinimum);
        expect(layout.treeWidth).toBeGreaterThanOrEqual(CAD_PANEL_LIMITS.tree.minimum); expect(layout.treeWidth).toBeLessThanOrEqual(layout.treeMaximum);
        if (visible) { expect(layout.propertiesWidth).toBeGreaterThanOrEqual(CAD_PANEL_LIMITS.properties.minimum); expect(layout.propertiesWidth).toBeLessThanOrEqual(layout.propertiesMaximum); }
        expect(layout.treeMaximum).toBeLessThanOrEqual(CAD_PANEL_LIMITS.tree.maximum); expect(layout.propertiesMaximum).toBeLessThanOrEqual(CAD_PANEL_LIMITS.properties.maximum);
      }
  });
  it('leaves compact widths to responsive CSS and rejects invalid measurements/preferences', () => {
    for (const width of [0, 767, 820, 1023, NaN, Infinity]) expect(cadPanelLayout(width, DEFAULT_CAD_PANEL_PREFERENCES, true)).toEqual({ kind: 'fixed' });
    expect(changeCadPanelPreference(DEFAULT_CAD_PANEL_PREFERENCES, 'tree', NaN).tree).toBe(220);
    expect(changeCadPanelPreference(DEFAULT_CAD_PANEL_PREFERENCES, 'properties', -100).properties).toBe(240);
  });
});
