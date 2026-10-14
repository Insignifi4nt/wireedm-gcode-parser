import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { CadSketchProfile } from '@/domain/cad/cadDocument';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { CadProfileEditor } from './CadFeatureEditor';

it('retains dimension intent when an exact definition edit opts into automatic nesting', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const profile: CadSketchProfile = { id: 'profile', name: 'Outline', construction: false, role: 'outer', constraints: [{ id: 'width', kind: 'dimension', quantity: 'width' }], geometry: { kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 0 } };
  const apply = vi.fn();
  try {
    await act(async () => root.render(<CadProfileEditor profile={profile} document={createCadDocument()} onApply={apply} onCancel={vi.fn()} onPendingChange={vi.fn()} />));
    const field = [...host.querySelectorAll('label')].find(entry => entry.querySelector('span')?.textContent?.startsWith('Width'))?.querySelector('input');
    if (!field) throw new Error('Missing exact width editor');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; if (!setter) throw new Error('Missing native setter');
    await act(async () => { setter.call(field, '30'); field.dispatchEvent(new Event('input', { bubbles: true })); });
    const button = [...host.querySelectorAll('button')].find(entry => entry.textContent?.trim() === 'Apply'); if (!button) throw new Error('Missing Apply');
    await act(async () => button.click());
    const { role: _legacyRole, ...expected } = profile;
    expect(apply).toHaveBeenCalledWith({ ...expected, geometry: { ...profile.geometry, width: '30' } }, {});
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
