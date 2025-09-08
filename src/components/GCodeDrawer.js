/**
 * GCodeDrawer Component
 * Collapsible panel that shows raw G-code, supports hover/click highlight,
 * and inserts measurement points at a chosen line.
 */

import { EventBus, EVENT_TYPES } from '../core/EventManager.js';
import { sanitizeText } from '../utils/Sanitize.js';
import { rotateStartAtLine } from '../utils/GCodeRewriter.js';
import { UndoRedoSystem } from './drawer/UndoRedoSystem.js';
import { MultiSelectHandler } from './drawer/MultiSelectHandler.js';
import { DrawerToolbar } from './drawer/DrawerToolbar.js';
import { GCodeEditor } from './drawer/GCodeEditor.js';

export class GCodeDrawer {
  constructor(mountTarget = document.body, options = {}) {
    this.eventBus = EventBus.getInstance();
    this.options = { anchor: 'right', debug: false, ...options };
    this.container = document.createElement('div');
    this.container.className = 'gcode-drawer';
    this.headerEl = null;
    this.bodyEl = null;
    this.footerEl = null;
    this.toolbar = null;
    this.editor = null;
    this.lines = []; // [{num, text, indexMapping}]
    this.lineIndexToPathIndex = new Map(); // source line -> path index
    this.pathIndexToLineIndex = new Map(); // path index -> source line
    this.selectedLines = new Set(); // Set of selected line numbers (mirrors selection handler)
    this.selection = new MultiSelectHandler();
    this.lastClickedLine = null; // For shift-click range selection
    this._debounceTimer = null;
    // Editing state is managed by GCodeEditor
    this.maxHistorySize = 50; // Limit history size
    this.undoSystem = new UndoRedoSystem({ max: this.maxHistorySize, onChange: () => this._updateUndoRedoButtons() });
    // Mode toggle: false = Select mode (default, safer), true = Edit mode
    this.editMode = localStorage.getItem('gcodeDrawerMode') === 'edit' || false;
    // Preserve selection across content refreshes triggered by edits
    this._pendingSelectionRestore = null;
    mountTarget.appendChild(this.container);
    this._applyAnchorClass();
    this._render();
    this._bindGlobalEvents();
  }

  _applyAnchorClass() {
    const anchor = (this.options.anchor === 'left') ? 'left' : 'right';
    this.container.classList.remove('gcode-drawer--left', 'gcode-drawer--right');
    this.container.classList.add(`gcode-drawer--${anchor}`);
  }

  _debug(...args) {
    if (this.options.debug) {
      console.log('[GCodeDrawer]', ...args);
    }
  }

  _render() {
    this.container.innerHTML = `
      <div class="gcode-drawer-body" tabindex="0"></div>
      <div class="gcode-drawer-footer">
        <div class="gcode-help-text">Hover to preview • Click to select • Ctrl+click for multi-select</div>
      </div>
    `;
    // Render toolbars via DrawerToolbar
    this.toolbar = new DrawerToolbar(this.container, {
      onClose: () => this.toggle(false),
      onUndo: () => this._undo(),
      onRedo: () => this._redo(),
      onSetStartHere: () => this._setSelectedAsStart(),
      onMoveUp: () => this._moveSelectedLines(-1),
      onMoveDown: () => this._moveSelectedLines(1),
      onInsertPoints: async () => {
        try {
          const firstSelected = this.selectedLines.size > 0 ? Math.min(...this.selectedLines) : null;
          const atIndex = firstSelected != null ? (this.lineIndexToPathIndex.get(firstSelected) ?? null) : null;
          const points = await this._getClickedPointsFromApp();
          this.eventBus.emit('drawer:insert:points', { atIndex, points }, { skipValidation: true });
        } catch (error) {
          console.error('Error inserting points:', error);
        }
      },
      onDeleteSelected: () => this._onBulkDelete(),
      onModeToggle: (mode) => this._onModeToggle(mode)
    });
    this.headerEl = this.container.querySelector('.gcode-drawer-header');
    this.bodyEl = this.container.querySelector('.gcode-drawer-body');
    this.footerEl = this.container.querySelector('.gcode-drawer-footer');
    
    // Add keyboard event handling
    this.bodyEl.addEventListener('keydown', (e) => this._onKeyDown(e));

    // Initialize editor for line DOM and editing behaviors
    this.editor = new GCodeEditor(this.bodyEl, {
      undoSystem: this.undoSystem,
      editMode: this.editMode,
      onLineEdited: (force) => this._onLineEdited(force),
      onHover: (lineNum) => this._onHover(lineNum),
      onLeave: (lineNum) => this._onLeave(lineNum),
      onClick: (lineNum, element, event) => this._onClick(lineNum, element, event),
      onDeleteLine: (lineNum) => this._onDelete(lineNum),
      onBulkDelete: () => this._onBulkDelete(),
      getSelection: () => this.selectedLines,
      applySelection: (sel) => {
        const next = sel instanceof Set ? sel : new Set(sel || []);
        this.selection.setSelection(next);
        this.selectedLines = this.selection.getSelection();
        this._updateSelectionVisuals();
      },
      updateLineCount: () => this._updateLineCount()
    });

    // Initialize toolbar mode UI
    this.toolbar?.updateModeUI(this.editMode);

    // Apply initial mode class and help text
    this._applyModeClass();
    this._updateHelpText();
  }

  _bindGlobalEvents() {
    // Toggle
    this.eventBus.on('drawer:toggle', () => this.toggle());
  }

  _applyModeClass() {
    // Toggle container classes for mode-specific styling
    this.container.classList.toggle('gcode-drawer--mode-edit', !!this.editMode);
    this.container.classList.toggle('gcode-drawer--mode-select', !this.editMode);
  }

  _updateHelpText() {
    const helpEl = this.container.querySelector('.gcode-help-text');
    if (!helpEl) return;
    if (this.editMode) {
      helpEl.textContent = 'Edit mode: Click text to edit • Blur commits change • Undo/Redo while typing uses browser shortcuts';
    } else {
      helpEl.textContent = 'Select mode: Hover to preview • Click to select • Ctrl/Cmd+click for multi-select • Shift+click for range';
    }
  }

  toggle(force) {
    const isOpen = this.container.classList.contains('open');
    const next = typeof force === 'boolean' ? force : !isOpen;
    this.container.classList.toggle('open', next);
  }

  setContent({ text, mapping, preserveHistory = false }) {
    // mapping: [{index, line, point}]
    this.bodyEl.innerHTML = '';
    this.lines = [];
    this.lineIndexToPathIndex.clear();
    this.pathIndexToLineIndex.clear();
    this.selection.clear();
    this.selectedLines = this.selection.getSelection();
    this.lastClickedLine = null;
    // Editor manages its own editing state
    
    // Only clear undo/redo history if preserveHistory is false
    if (!preserveHistory) {
      console.log('GCodeDrawer: Clearing undo/redo history');
      this.undoSystem.clear();
    } else {
      console.log('GCodeDrawer: Preserving undo/redo history, stack sizes:', this.undoSystem.getUndoCount(), this.undoSystem.getRedoCount());
    }
    const rawLines = (text || '').split(/\r?\n/);
    this.editor.setLines(rawLines);
    this.lines = rawLines.map((t, i) => ({ num: i + 1, text: t }));
    // Build line->path index map (use first point with matching line)
    mapping?.forEach(m => {
      if (typeof m?.line === 'number' && typeof m?.index === 'number') {
        if (!this.lineIndexToPathIndex.has(m.line)) {
          this.lineIndexToPathIndex.set(m.line, m.index);
        }
        if (!this.pathIndexToLineIndex.has(m.index)) {
          this.pathIndexToLineIndex.set(m.index, m.line);
        }
      }
    });
    
    // Update line count display
    this._updateLineCount();
    
    // Initialize undo/redo buttons
    this._updateUndoRedoButtons();

    // Restore selection if an edit-triggered refresh requested it
    if (this._pendingSelectionRestore && (this._pendingSelectionRestore.size || this._pendingSelectionRestore.length)) {
      const toRestore = Array.from(this._pendingSelectionRestore);
      this._pendingSelectionRestore = null;
      this._restoreSelection(toRestore);
    }
  }

  _onHover(lineNum) {
    const index = this.lineIndexToPathIndex.get(lineNum);
    if (index != null) {
      this.eventBus.emit('drawer:line:hover', { index }, { skipValidation: true });
    }
  }

  _onLeave(_lineNum) {
    this.eventBus.emit('drawer:line:leave', {}, { skipValidation: true });
  }

  _onClick(lineNum, element, event) {
    if (event.shiftKey && this.lastClickedLine != null) {
      // Range selection
      this._selectRange(Math.min(this.lastClickedLine, lineNum), Math.max(this.lastClickedLine, lineNum));
    } else if (event.ctrlKey || event.metaKey) {
      // Toggle selection
      this._toggleSelection(lineNum, element);
    } else {
      // Single selection
      this._selectSingle(lineNum, element);
    }
    
    this.lastClickedLine = lineNum;
    this._updateSelectionVisuals();
    
    // Emit click event for first selected line (maintain compatibility)
    const firstSelected = Math.min(...this.selectedLines);
    const index = this.lineIndexToPathIndex.get(firstSelected);
    if (index != null) {
      this.eventBus.emit('drawer:line:click', { index }, { skipValidation: true });
    }
  }

  _selectSingle(lineNum, element) {
    this.selection.selectSingle(lineNum);
    this.selectedLines = this.selection.getSelection();
  }

  _toggleSelection(lineNum, element) {
    this.selection.setSelection(this.selectedLines).toggle(lineNum);
    this.selectedLines = this.selection.getSelection();
  }

  _selectRange(startLine, endLine) {
    this.selection.selectRange(startLine, endLine);
    this.selectedLines = this.selection.getSelection();
  }

  _updateSelectionVisuals() {
    if (this.editor) this.editor.updateSelectionClasses(this.selectedLines);
    const count = this.selectedLines.size;
    const hasSelection = count > 0;
    if (this.toolbar) this.toolbar.updateSelectionUI(hasSelection, count);
  }
  
  _restoreSelection(lineNumbers) {
    // Helper method to restore selection to specific line numbers
    console.log('GCodeDrawer: Restoring selection to lines:', lineNumbers);
    const valid = [];
    lineNumbers.forEach(lineNum => {
      const lineEl = this.bodyEl.querySelector(`.gcode-line[data-line="${lineNum}"]`);
      if (lineEl) valid.push(lineNum);
    });
    this.selection.setSelection(valid);
    this.selectedLines = this.selection.getSelection();
    this._updateSelectionVisuals();
  }
  
  _updateLineCount() {
    const count = this.bodyEl ? this.bodyEl.querySelectorAll('.gcode-line').length : this.lines.length;
    if (this.toolbar) this.toolbar.updateLineCount(count);
  }
  
  // Editing state visuals are handled by GCodeEditor
  
  // Undo/Redo functionality
  _undo() {
    if (!this.undoSystem.canUndo()) return;
    // Cancel any pending debounced content change to avoid racing updates
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }

    const command = this.undoSystem.undo();
    if (!command) return;
    this._debug('Executed undo for command:', command.type);
    
    // For move commands, preserve selection after content change
    if (command.type === 'move') {
      const movedSelection = Array.from(this.selectedLines);
      this._emitContentChanged(this.getText());
      setTimeout(() => {
        this._restoreSelection(movedSelection);
      }, 0);
    } else {
      // Preserve selection across content refresh for non-move operations (e.g., edit)
      this._pendingSelectionRestore = new Set(this.selectedLines);
      this._emitContentChanged(this.getText());
    }
  }
  
  _redo() {
    if (!this.undoSystem.canRedo()) return;
    // Cancel any pending debounced content change to avoid racing updates
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }

    const command = this.undoSystem.redo();
    if (!command) return;
    this._debug('Executed redo for command:', command.type);
    
    // For move commands, preserve selection after content change
    if (command.type === 'move') {
      const movedSelection = Array.from(this.selectedLines);
      this._emitContentChanged(this.getText());
      setTimeout(() => {
        this._restoreSelection(movedSelection);
      }, 0);
    } else {
      // Preserve selection across content refresh for non-move operations (e.g., edit)
      this._pendingSelectionRestore = new Set(this.selectedLines);
      this._emitContentChanged(this.getText());
    }
  }
  
  _updateUndoRedoButtons() {
    const undoCount = this.undoSystem.getUndoCount();
    const redoCount = this.undoSystem.getRedoCount();
    this._debug('Updating undo/redo buttons. Undo stack:', undoCount, 'Redo stack:', redoCount);
    if (this.toolbar) this.toolbar.setUndoRedoState(undoCount, redoCount);
  }
  

  insertPointsAt(atIndex, points) {
    // Insert generated G-code for points after a resolved line:
    // Priority: path index -> source line; fallback to first selected; fallback to line 1.
    if (!Array.isArray(points) || points.length === 0) return;

    const gcodeText = this.getText();
    let insertAfterLine = null;

    if (typeof atIndex === 'number' && this.pathIndexToLineIndex.has(atIndex)) {
      insertAfterLine = this.pathIndexToLineIndex.get(atIndex);
    }

    if (insertAfterLine == null) {
      insertAfterLine = this.selectedLines.size > 0 ? Math.min(...this.selectedLines) : 1;
    }

    const gcodeLines = points.flatMap((p, idx) => [
      `; inserted G0 P${idx + 1}`,
      `G0 X${p.x.toFixed(3)} Y${p.y.toFixed(3)}`
    ]);

    // Create and push undoable insert command
    const insertCommand = this.editor.createInsertCommand(insertAfterLine, gcodeLines);
    this.undoSystem.push(insertCommand);

    // Execute insertion immediately
    insertCommand.execute();

    // Emit updated content so main app can reparse, then restore selection
    const movedSelection = Array.from(this.selectedLines);
    this._emitContentChanged(this.getText());
    setTimeout(() => {
      this._restoreSelection(movedSelection);
    }, 0);
  }

  getText() {
    return this.editor ? this.editor.getText() : '';
  }

  async _getClickedPointsFromApp() {
    // Use event-based communication instead of global access
    return new Promise((resolve) => {
      // Set up one-time listener for the response
      const handleResponse = ({ points }) => {
        this.eventBus.off(EVENT_TYPES.POINT_CLICKED_RESPONSE, handleResponse);
        resolve(points || []);
      };
      
      this.eventBus.on(EVENT_TYPES.POINT_CLICKED_RESPONSE, handleResponse);
      
      // Request clicked points from main app
      this.eventBus.emit(EVENT_TYPES.POINT_GET_CLICKED, {}, { skipValidation: true });
      
      // Add timeout to prevent hanging
      setTimeout(() => {
        this.eventBus.off(EVENT_TYPES.POINT_CLICKED_RESPONSE, handleResponse);
        resolve([]);
      }, 1000);
    });
  }

  _onLineEdited(force = false) {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    const fire = () => this._emitContentChanged(this.getText());
    if (force) {
      // Preserve current selection across the imminent content refresh
      this._pendingSelectionRestore = new Set(this.selectedLines);
      fire();
    } else {
      // Increased debounce timeout to 3000ms to allow uninterrupted editing
      // Short debounce times (100ms) disrupt editing by constantly refreshing the drawer
      // Preserve selection for the upcoming debounced refresh
      this._pendingSelectionRestore = new Set(this.selectedLines);
      this._debounceTimer = setTimeout(fire, 3000);
    }
  }

  _onDelete(lineNum) {
    const lineEl = this.bodyEl.querySelector(`.gcode-line[data-line="${lineNum}"]`);
    if (!lineEl) return;
    
    // Cancel any pending debounced content change to avoid racing updates
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }

    // Capture state for undo
    const allLines = Array.from(this.bodyEl.querySelectorAll('.gcode-line'));
    const linesData = [{
      lineNum: lineNum,
      text: lineEl.querySelector('.gcode-line-text').textContent,
      originalIndex: allLines.indexOf(lineEl)
    }];
    
    // Create and push delete command
    const deleteCommand = this.editor.createDeleteCommand([lineNum], linesData);
    this.undoSystem.push(deleteCommand);
    
    // Execute delete
    deleteCommand.execute();
    
    // Update internal lines array
    this.lines = this.lines.filter(line => line.num !== lineNum);
    
    // Remove from selection if it was selected
    const nextSel = new Set(this.selectedLines);
    nextSel.delete(lineNum);
    this.selection.setSelection(nextSel);
    this.selectedLines = this.selection.getSelection();
    if (this.lastClickedLine === lineNum) {
      this.lastClickedLine = null;
    }
    
    this._emitContentChanged(this.getText());
  }

  _onKeyDown(e) {
    // If typing inside a line editor, let the browser handle undo/redo and edits
    if (e.target && (e.target.isContentEditable || e.target.closest?.('.gcode-line-text'))) {
      return;
    }

    // Handle keyboard shortcuts
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
      switch (e.key.toLowerCase()) {
        case 'z':
          e.preventDefault();
          this._undo();
          return;
        case 'y':
          e.preventDefault();
          this._redo();
          return;
      }
    }
    
    // Handle Ctrl+Shift+Z as alternative redo (common shortcut)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      this._redo();
      return;
    }
    
    // Handle delete actions
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.selectedLines.size > 0) {
        e.preventDefault();
        this._onBulkDelete();
      }
    }

    // Escape clears selection
    if (e.key === 'Escape') {
      if (this.selectedLines.size > 0) {
        this.selection.clear();
        this.selectedLines = this.selection.getSelection();
        this._updateSelectionVisuals();
      }
    }
  }

  _onBulkDelete() {
    if (this.selectedLines.size === 0) return;
    
    // Cancel any pending debounced content change to avoid racing updates
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }

    // Show confirmation for bulk delete (>3 lines)
    const count = this.selectedLines.size;
    if (count > 3) {
      const confirmed = confirm(`Delete ${count} selected lines? Use Ctrl+Z to undo if needed.`);
      if (!confirmed) return;
    }
    
    // Capture current state for undo
    const sortedLines = Array.from(this.selectedLines).sort((a, b) => a - b);
    const linesData = sortedLines.map(lineNum => {
      const lineEl = this.bodyEl.querySelector(`.gcode-line[data-line="${lineNum}"]`);
      const allLines = Array.from(this.bodyEl.querySelectorAll('.gcode-line'));
      return {
        lineNum: lineNum,
        text: lineEl ? lineEl.querySelector('.gcode-line-text').textContent : '',
        originalIndex: allLines.indexOf(lineEl)
      };
    });
    
    // Create and push delete command
    const deleteCommand = this.editor.createDeleteCommand(sortedLines, linesData);
    this.undoSystem.push(deleteCommand);
    
    // Execute delete
    deleteCommand.execute();
    this._emitContentChanged(this.getText());
  }

  // Line renumbering is handled by GCodeEditor

  _moveSelectedLines(direction) {
    if (this.selectedLines.size === 0) return;
    
    // Cancel any pending debounced content change to avoid racing updates
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }

    const sortedSelection = Array.from(this.selectedLines).sort((a, b) => a - b);
    
    // Create and push move command
    const moveCommand = this.editor.createMoveCommand(sortedSelection, direction);
    this.undoSystem.push(moveCommand);
    
    // Execute initial move (selection is already correct)
    this.editor._moveSelectedLinesInternal(direction);
    
    // Store the moved selection to restore after setContent clears it
    const movedSelection = Array.from(this.selectedLines);
    
    // Emit content change (this will trigger main app to call setContent)
    this._emitContentChanged(this.getText());
    
    // Restore selection after a brief delay (after setContent has been called)
    setTimeout(() => {
      this._restoreSelection(movedSelection);
    }, 0);
  }

  _setSelectedAsStart() {
    // Require exactly one selected line
    if (this.selectedLines.size !== 1) {
      this.eventBus.emit(EVENT_TYPES.STATUS_SHOW, {
        message: 'Select exactly one motion line in the body to set as start.',
        type: 'warning'
      });
      return;
    }
    // Only operate in Select mode for clarity
    if (this.editMode) {
      // No-op in Edit mode to avoid confusion
      return;
    }

    // Cancel any pending debounced content change to avoid racing updates
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }

    const firstSelected = Math.min(...this.selectedLines);

    // Validate that selection is a motion line and lies within the body (after first motion)
    const isMotionLine = (s) => {
      const noComment = (s || '').replace(/[;(].*$/g, '').trim();
      const noBlock = noComment.replace(/^N\d+\s+/i, '');
      const canon = (noBlock || '').toUpperCase().replace(/\bG0+([0-3])(?!\d)/g, 'G$1');
      return /^(G0|G1|G2|G3)\b/.test(canon);
    };
    // Determine header/body split
    let firstMotionIdx = -1;
    for (let i = 0; i < this.lines.length; i++) {
      if (isMotionLine(this.lines[i]?.text || '')) { firstMotionIdx = i; break; }
    }
    const selectedIdx0 = firstSelected - 1;
    const selectedText = this.lines[selectedIdx0]?.text || '';
    const validSelection = firstMotionIdx >= 0 && selectedIdx0 >= firstMotionIdx && isMotionLine(selectedText);
    if (!validSelection) {
      this.eventBus.emit(EVENT_TYPES.STATUS_SHOW, {
        message: 'Invalid selection: choose a motion line (G0/G1/G2/G3) within the body.',
        type: 'warning'
      });
      return;
    }
    const oldText = this.getText();
    const { text: rotatedText, newStartLine } = rotateStartAtLine(oldText, firstSelected, { ensureClosure: true });

    // If nothing changed, bail
    if (rotatedText === oldText) return;

    const oldLines = oldText.split(/\r?\n/);
    const newLines = rotatedText.split(/\r?\n/);

    // Create and push replace command
    const replaceCommand = {
      type: 'replace',
      execute: () => {
        this.editor.setLines(newLines);
        this._updateLineCount();
      },
      undo: () => {
        this.editor.setLines(oldLines);
        this._updateLineCount();
      }
    };
    this.undoSystem.push(replaceCommand);

    // Execute replacement immediately
    replaceCommand.execute();

    // Emit updated content so main app can reparse, then restore selection to new start
    this._emitContentChanged(this.getText());
    setTimeout(() => {
      this._restoreSelection([newStartLine]);
    }, 0);
  }
  
  _onModeToggle(mode) {
    this.editMode = (mode === 'edit');
    localStorage.setItem('gcodeDrawerMode', mode);
    
    // Update editor mode
    this.editor?.setEditMode(this.editMode);
    
    // Update toolbar UI
    this.toolbar?.updateModeUI(this.editMode);
    // In select mode, reflect selection toolbar based on current selection
    if (!this.editMode) {
      const count = this.selectedLines.size;
      this.toolbar?.updateSelectionUI(count > 0, count);
    }

    // Update container class and help text for mode-specific UX
    this._applyModeClass();
    this._updateHelpText();
    
    this._debug('Mode toggled to:', mode, 'editMode:', this.editMode);
  }

  _emitContentChanged(text) {
    // Sanitize the entire content before emitting
    const sanitized = sanitizeText(text);
    this.eventBus.emit('drawer:content:changed', { text: sanitized }, { skipValidation: true });
  }
}

export default GCodeDrawer;
