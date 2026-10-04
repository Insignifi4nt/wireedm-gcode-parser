import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GCodeInspectionDialog } from '../GCodeInspectionDialog';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('read-only G-code inspection', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement('div'); document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  function button(name: string) {
    const found = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((element) => element.getAttribute('aria-label') === name || element.textContent === name);
    if (!found) throw new Error(`Missing button ${name}`);
    return found;
  }
  function click(name: string) { act(() => button(name).click()); }
  function input(label: string, value: string) {
    const element = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it('keeps exact source order and links command occurrences, modal state and preview selection', () => {
    const source = '%\r\nN10 G21 G90\r\nN20 G0 X0 Y0\r\nN30 G1 X10 Y0\r\nN40 G39\r\nN50 M02\r\n%\r\n';
    const download = vi.fn();
    act(() => root.render(<GCodeInspectionDialog text={source} fileName="external.nc" onClose={vi.fn()} onDownload={download} />));
    const rows = [...document.querySelectorAll<HTMLElement>('[data-inspection-line]')];
    expect(rows.map((row) => row.querySelector('code')!.textContent)).toEqual(source.split('\r\n').map((line) => line || ' '));
    act(() => rows[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(document.querySelector('[data-inspection-line="2"]'));
    click('Commands (6)');
    click('Inspect G39 occurrences');
    expect(document.querySelectorAll('[data-inspection-line]')).toHaveLength(1);
    expect(document.querySelector('[data-inspection-line]')?.getAttribute('data-inspection-line')).toBe('5');
    input('Go to source line', '4'); click('Go');
    click('Line 4');
    expect(document.querySelector('[aria-label="Modal state at line 4"]')?.textContent).toContain('G1');
    click('Preview');
    const path = document.querySelector<SVGElement>('path[data-line="3"]');
    // Geometry remains selectable without a stored project or geometry authoring handlers.
    expect(path).not.toBeNull();
    act(() => path!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(document.querySelector('[data-inspection-line="3"]')?.getAttribute('aria-pressed')).toBe('true');
    click('Download exact file'); expect(download).toHaveBeenCalledOnce();
    expect(source).toContain('N40 G39\r\nN50 M02');
  });

  it('reveals lines on another page, rejects invalid navigation, and exposes diagnostics without rewriting source', () => {
    const source = ['G21 G90', ...Array.from({ length: 160 }, (_, index) => `G1 X${index}`), 'G999 X500'].join('\n');
    act(() => root.render(<GCodeInspectionDialog text={source} onClose={vi.fn()} />));
    expect(document.querySelectorAll('[data-inspection-line]')).toHaveLength(150);
    click('Next');
    const nextPageRow = document.querySelector<HTMLButtonElement>('[data-inspection-line="151"]')!;
    act(() => { nextPageRow.focus(); nextPageRow.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(document.querySelector('[data-inspection-line="1"]'));
    input('Go to source line', '162'); click('Go');
    expect(document.querySelector('[data-inspection-line="162"]')?.getAttribute('aria-pressed')).toBe('true');
    input('Go to source line', '0'); click('Go');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('1 to 162');
    input('Search G-code source', 'G999');
    expect(document.querySelectorAll('[data-inspection-line]')).toHaveLength(1);
    click('Line 162');
    expect(document.querySelector('[aria-label="G-code inspection details"]')?.textContent).toContain('G999');
  });

  it('retains pinned context and refuses oversized interactive previews while allowing exact download', () => {
    const download = vi.fn();
    act(() => root.render(<GCodeInspectionDialog text={'G1 X1\n'.repeat(50_001)} onClose={vi.fn()} onDownload={download} />));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('50,000');
    click('Download exact file'); expect(download).toHaveBeenCalledOnce();
    act(() => root.render(<GCodeInspectionDialog text="G39" onClose={vi.fn()}
      options={{ lineContexts: [{ line: 1, commands: [{ code: 'G39', meaning: 'Pinned cancellation', scope: 'Post A' }] }] }}
      provenance={[{ label: 'Revision', value: 'revision-exact' }]} />));
    click('Context');
    expect(document.querySelector<HTMLSelectElement>('[aria-label="Inspection source interpreter"]')?.disabled).toBe(true);
    expect(document.body.textContent).toContain('revision-exact');
  });

  it('keeps the exact inspected artifact available after a download failure', async () => {
    const download = vi.fn().mockRejectedValueOnce(new Error('Browser rejected download')).mockResolvedValue(undefined);
    act(() => root.render(<GCodeInspectionDialog text={'N10 G21\r\nN20 M02\r\n'} onClose={vi.fn()} onDownload={download} />));
    await act(async () => button('Download exact file').click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('artifact is retained');
    await act(async () => button('Download exact file').click());
    expect(download).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector('[data-inspection-line="2"] code')?.textContent).toBe('N20 M02');
  });

  it('keeps settings in Context and reveals source when compact companion navigation selects a command or issue', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    act(() => root.render(<GCodeInspectionDialog text={['G21 G90', 'G1 X10 Y0', 'G999 X50', 'M2'].join('\n')} onClose={vi.fn()} />));
    const workspace = document.querySelector('[data-gcode-inspection-workspace]')!;
    expect(workspace.getAttribute('data-compact-active-pane')).toBe('code');
    expect(document.querySelector('[data-inspection-companion-pane]')?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('[aria-label="Inspection initial units"]')).toBeNull();
    const preview = document.querySelector('[data-inspection-preview-pane] svg');
    click('Context');
    expect(workspace.getAttribute('data-compact-active-pane')).toBe('context');
    expect(document.querySelector('[data-inspection-source-pane]')?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('[aria-label="Inspection initial units"]')).not.toBeNull();
    click('Commands (5)'); click('Inspect G999 occurrences');
    expect(workspace.getAttribute('data-compact-active-pane')).toBe('code');
    expect(document.activeElement).toBe(document.querySelector('[data-inspection-line="3"]'));
    const issues = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => /^Issues \(/.test(item.textContent ?? ''))!;
    act(() => issues.click());
    expect(workspace.getAttribute('data-compact-active-pane')).toBe('issues');
    const issue = [...document.querySelectorAll<HTMLButtonElement>('[aria-label="G-code inspection details"] button')]
      .find(item => item.textContent?.includes('Line 3'))!;
    act(() => issue.click());
    expect(workspace.getAttribute('data-compact-active-pane')).toBe('code');
    expect(document.querySelector('[data-inspection-line="3"]')?.getAttribute('aria-pressed')).toBe('true');
    click('Preview');
    expect(document.querySelector('[data-inspection-preview-pane] svg')).toBe(preview);
  });
});
