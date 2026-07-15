import { beforeEach, describe, expect, it } from 'vitest';

import {
  EDITOR_WORKSPACE_LAYOUT_STORAGE_KEY,
  normalizeEditorWorkspaceLayout,
  readEditorWorkspaceRenderedPlacement,
  readEditorWorkspaceLayout,
  writeEditorWorkspaceLayout,
  type EditorWorkspaceLayoutV1
} from './editorWorkspaceLayout';

const defaults: EditorWorkspaceLayoutV1 = {
  schemaVersion: 1,
  placements: {
    'contour-tree': 'docked-left',
    'contour-setup': 'docked-right',
    measurement: 'hidden'
  },
  dockOrders: { left: ['contour-tree'], right: ['contour-setup'] },
  floatingGeometries: {
    'contour-tree': { x: 20, y: 50, width: 380, height: 560 },
    'contour-setup': { x: 440, y: 50, width: 320, height: 430 },
    measurement: { x: 200, y: 100, width: 340, height: 420 }
  },
  dockWidths: { left: 360, right: 420 }
};

describe('editor workspace layout persistence', () => {
  beforeEach(() => localStorage.clear());

  it('falls back safely when stored JSON is invalid', () => {
    localStorage.setItem(EDITOR_WORKSPACE_LAYOUT_STORAGE_KEY, '{bad');

    expect(readEditorWorkspaceLayout(defaults, viewport())).toEqual(defaults);
  });

  it('removes obsolete panels and de-duplicates dock order', () => {
    const normalized = normalizeEditorWorkspaceLayout(
      {
        schemaVersion: 1,
        placements: {
          'contour-tree': 'docked-left',
          obsolete: 'docked-left'
        },
        dockOrders: {
          left: ['obsolete', 'contour-tree', 'contour-tree'],
          right: ['contour-tree']
        },
        floatingGeometries: {},
        dockWidths: { left: 360, right: 420 }
      },
      defaults,
      viewport()
    );

    expect(normalized.placements).not.toHaveProperty('obsolete');
    expect(normalized.dockOrders).toEqual({ left: ['contour-tree'], right: [] });
  });

  it('clamps floating geometry and dock widths to readable bounds', () => {
    const normalized = normalizeEditorWorkspaceLayout(
      {
        ...defaults,
        placements: { ...defaults.placements, measurement: 'floating' },
        floatingGeometries: {
          ...defaults.floatingGeometries,
          measurement: { x: 4000, y: -200, width: 20, height: 9000 }
        },
        dockWidths: { left: 10, right: 5000 }
      },
      defaults,
      viewport()
    );

    expect(normalized.floatingGeometries.measurement).toEqual({
      x: 732,
      y: 42,
      width: 260,
      height: 750
    });
    expect(normalized.dockWidths).toEqual({ left: 240, right: 800 });
  });

  it('round-trips a normalized layout', () => {
    const layout: EditorWorkspaceLayoutV1 = {
      ...defaults,
      placements: { ...defaults.placements, measurement: 'floating' }
    };

    writeEditorWorkspaceLayout(layout);

    expect(readEditorWorkspaceLayout(defaults, viewport())).toEqual(layout);
  });

  it('keeps remembered placements while rendering only the active workflow panel', () => {
    expect(readEditorWorkspaceRenderedPlacement(defaults.placements, 'contour-tree', null))
      .toBe('hidden');
    expect(readEditorWorkspaceRenderedPlacement(defaults.placements, 'contour-tree', 'contour-tree'))
      .toBe('docked-left');
    expect(readEditorWorkspaceRenderedPlacement(defaults.placements, 'contour-setup', 'contour-tree'))
      .toBe('hidden');
    expect(defaults.placements).toMatchObject({
      'contour-tree': 'docked-left',
      'contour-setup': 'docked-right'
    });
  });

  it('floats an active panel whose remembered placement is hidden', () => {
    expect(readEditorWorkspaceRenderedPlacement(defaults.placements, 'measurement', 'measurement'))
      .toBe('floating');
  });
});

function viewport() {
  return { width: 1000, height: 800 };
}
