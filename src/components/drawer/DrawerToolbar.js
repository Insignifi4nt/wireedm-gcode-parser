/**
 * DrawerToolbar
 * Renders header and context toolbar for GCodeDrawer and exposes state updates.
 */

export class DrawerToolbar {
  constructor(container, handlers = {}) {
    this.container = container;
    this.handlers = handlers;

    this.headerEl = null;
    this.contextToolbarEl = null;

    this._render();
    this._bindEvents();
  }

  _render() {
    // Header
    const header = document.createElement('div');
    header.className = 'gcode-drawer-header';
    header.innerHTML = `
      <div class="gcode-drawer-title">
        <strong>G-Code</strong>
        <span class="gcode-line-count">0 lines</span>
      </div>
      <div class="gcode-drawer-actions">
        <button class="gcode-action-btn" data-action="undo" title="Undo (Ctrl+Z)" disabled>↶</button>
        <button class="gcode-action-btn" data-action="redo" title="Redo (Ctrl+Y)" disabled>↷</button>
        <button class="gcode-action-btn" data-action="close" title="Close drawer">×</button>
      </div>
    `;

    // Context toolbar
    const ctx = document.createElement('div');
    ctx.className = 'gcode-context-toolbar';
    ctx.style.display = 'none';
    ctx.innerHTML = `
      <div class="gcode-selection-info">
        <span class="gcode-selection-counter"></span>
      </div>
      <div class="gcode-selection-actions">
        <button class="gcode-toolbar-btn" data-action="move-up" title="Move selected lines up" disabled>↑</button>
        <button class="gcode-toolbar-btn" data-action="move-down" title="Move selected lines down" disabled>↓</button>
        <button class="gcode-toolbar-btn" data-action="insert-points" title="Insert clicked points">+ Points</button>
        <button class="gcode-toolbar-btn" data-action="delete-selected" title="Delete selected lines">🗑</button>
      </div>
    `;

    // Insert at top of container
    this.container.prepend(ctx);
    this.container.prepend(header);

    this.headerEl = header;
    this.contextToolbarEl = ctx;
  }

  _bindEvents() {
    const on = (sel, type, cb) => {
      const el = this.container.querySelector(sel);
      if (el && cb) el.addEventListener(type, cb);
    };

    on('[data-action="close"]', 'click', () => this.handlers.onClose?.());
    on('[data-action="undo"]', 'click', () => this.handlers.onUndo?.());
    on('[data-action="redo"]', 'click', () => this.handlers.onRedo?.());
    on('[data-action="move-up"]', 'click', () => this.handlers.onMoveUp?.());
    on('[data-action="move-down"]', 'click', () => this.handlers.onMoveDown?.());
    on('[data-action="insert-points"]', 'click', () => this.handlers.onInsertPoints?.());
    on('[data-action="delete-selected"]', 'click', () => this.handlers.onDeleteSelected?.());
  }

  updateLineCount(count) {
    const lineCountEl = this.container.querySelector('.gcode-line-count');
    if (lineCountEl) {
      lineCountEl.textContent = `${count} line${count !== 1 ? 's' : ''}`;
    }
  }

  setUndoRedoState(undoCount, redoCount) {
    const undoBtn = this.container.querySelector('[data-action="undo"]');
    const redoBtn = this.container.querySelector('[data-action="redo"]');
    if (undoBtn) {
      undoBtn.disabled = !(undoCount > 0);
      undoBtn.title = undoCount > 0
        ? `Undo (Ctrl+Z) - ${undoCount} action${undoCount !== 1 ? 's' : ''}`
        : 'Undo (Ctrl+Z)';
    }
    if (redoBtn) {
      redoBtn.disabled = !(redoCount > 0);
      redoBtn.title = redoCount > 0
        ? `Redo (Ctrl+Y) - ${redoCount} action${redoCount !== 1 ? 's' : ''}`
        : 'Redo (Ctrl+Y)';
    }
  }

  updateSelectionUI(hasSelection, count) {
    const ctx = this.container.querySelector('.gcode-context-toolbar');
    if (ctx) ctx.style.display = hasSelection ? 'flex' : 'none';

    const selectionCounter = this.container.querySelector('.gcode-selection-counter');
    if (selectionCounter && hasSelection) {
      selectionCounter.textContent = `${count} line${count !== 1 ? 's' : ''} selected`;
    }

    const moveUpBtn = this.container.querySelector('[data-action="move-up"]');
    const moveDownBtn = this.container.querySelector('[data-action="move-down"]');
    const deleteBtn = this.container.querySelector('[data-action="delete-selected"]');
    const insertBtn = this.container.querySelector('[data-action="insert-points"]');

    if (moveUpBtn) moveUpBtn.disabled = !hasSelection;
    if (moveDownBtn) moveDownBtn.disabled = !hasSelection;
    if (deleteBtn) deleteBtn.disabled = !hasSelection;
    if (insertBtn) insertBtn.disabled = !hasSelection;
  }
}

export default DrawerToolbar;

