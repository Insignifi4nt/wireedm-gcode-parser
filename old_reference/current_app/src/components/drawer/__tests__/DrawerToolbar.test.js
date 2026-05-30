import { describe, it, expect, vi } from 'vitest';
import { DrawerToolbar } from '../DrawerToolbar.js';

describe('DrawerToolbar', () => {
  it('clears selection when the selected-line counter is clicked', () => {
    const container = document.createElement('div');
    const onClearSelection = vi.fn();
    const toolbar = new DrawerToolbar(container, { onClearSelection });

    toolbar.updateSelectionUI(true, 3);
    container.querySelector('[data-action="clear-selection"]').click();

    expect(onClearSelection).toHaveBeenCalledOnce();
  });

  it('shows the clear-pins action only while pins exist', () => {
    const container = document.createElement('div');
    const onClearPins = vi.fn();
    const toolbar = new DrawerToolbar(container, { onClearPins });
    const clearPinsButton = container.querySelector('[data-action="clear-pins"]');

    expect(clearPinsButton.hidden).toBe(true);

    toolbar.updatePinnedUI(2);
    expect(clearPinsButton.hidden).toBe(false);
    expect(clearPinsButton.title).toBe('Clear 2 pinned canvas highlights');

    clearPinsButton.click();
    expect(onClearPins).toHaveBeenCalledOnce();

    toolbar.updatePinnedUI(0);
    expect(clearPinsButton.hidden).toBe(true);
  });
});
